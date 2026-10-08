"""Jobs (analyse a new street) and the Colab worker protocol (CLAUDE.md §7-8).

A street click is resolved on the laptop by app/streetpick.py (a port of geo_cascadia.picker.click_to_street: analysed
areas answer from their own streets.json, Overpass with a 5 s budget (P7.1), disk caches, display names, overlap check).
The job stores the polygon (GeoJSON, lon/lat), OSM way ids and an output slug, so the worker can call run_area directly.
Jobs need the database: in offline data mode, creating/claiming jobs returns 503.
"""
import hmac
import json
import logging
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from shapely.geometry import mapping, shape
from shapely.ops import transform
from shapely.validation import explain_validity

from . import loader, mapdata, minimap, planest, streetpick, views
from .store import Data, OfflineError

log = logging.getLogger("geo_cascadia")

router = APIRouter()
# P6: the worker heartbeats every ~15 s, so a running job silent for 2 minutes lost its worker (Colab died, account
# switched). It shows as "interrupted, will resume" and the next worker that asks for work claims it again.
STALE_RUNNING = "2 minutes"
JOB_COLS = f"""j.id, j.kind, j.input, j.status, j.stage, j.done, j.total, j.message, a.slug, j.created_at, j.started_at,
              j.finished_at, j.heartbeat_at, j.worker_id, j.is_test,
              (j.status = 'running' and (j.heartbeat_at is null or j.heartbeat_at < now() - interval '{STALE_RUNNING}')),
              j.approved, j.estimate, j.device, j.cancel_requested, j.note"""
FAIL_CODES = {"NO_STREET_VIEW": "no_street_view", "NO_STREETS": "no_street_view", "NO_CAMERAS": "no_street_view",
              "AWS_TOKEN_EXPIRED": "expired_token", "EXPIRED_TOKEN": "expired_token", "NEEDS_APPROVAL": "needs_approval",
              "CANCELLED": "failed",
              # D40: Street View look-ups refused (key / quota / network) or no look-up made: an error, not "no imagery",
              # so the job is failed and retryable (the worker keeps its progress; Retry searches again)
              "GOOGLE_KEY": "failed", "GOOGLE_REQUEST": "failed", "GOOGLE_BROWSER_KEY": "failed", "BAD_AREA": "failed"}
# the worker's stages, in run order (run_area's own names); sub-steps the pipeline reports map onto them
STAGES = ["panoramas", "area", "plan", "detect", "geometry", "ocr", "vlm", "reference", "match", "export"]
SUB_STAGES = {"vlm_names": "vlm", "building_crops": "vlm", "vlm_buildings": "vlm", "places": "reference"}
# statuses a worker leaves open (the job is not finished): no finished_at
OPEN_STATUSES = ("expired_token", "needs_approval")
ACTIVE_SQL = "('queued', 'running', 'expired_token', 'needs_approval')"      # not finished: blocks a new street
ORIGINAL_AREAS = {"ward29", "trichy_bharathidasan_salai", "tiruppur_uthukuli_road"}   # never deletable
FILE_OK = re.compile(r"^[A-Za-z0-9_.-]{1,80}\.(json|geojson|csv)$")
MAX_FILE = 40 * 1024 * 1024
CANCELLED = "cancelled by user"
# "Clear test jobs" removes ONLY jobs that ended without a result and were either made by automated tests (is_test) or
# cancelled before any worker picked them up (nothing was analysed, so nothing is lost). Never done / queued / running.
# P6 round (F9): also test jobs that produced an area (fake-worker replays, automated tests): the job and its area go
# together. A test job still running (fresh heartbeat) is left alone. Real analysed areas and the originals: never.
TEST_JOB_SQL = f"""select j.id from jobs j where
                    (j.is_test and not (j.status = 'running' and j.heartbeat_at > now() - interval '{STALE_RUNNING}'))
                    or (j.area_id is null and j.status = 'failed' and j.message = '{CANCELLED}' and j.started_at is null)"""
# "Remove from list": jobs that ended without a result (failed, cancelled, no Street View)
REMOVABLE = ("failed", "no_street_view")


def get_data(request: Request) -> Data:
    return request.app.state.data


def _last_seen(w):
    return w["t"] if isinstance(w, dict) else w


def worker_online(app):
    win = app.state.settings.worker_online_s
    return any(time.monotonic() - _last_seen(w) < win for w in app.state.workers.values())


def worker_status(app):
    """The most recently seen worker: connected?, its device and the job it is on (no ids or secrets)."""
    win = app.state.settings.worker_online_s
    seen = [w for w in app.state.workers.values() if isinstance(w, dict)]
    if not seen:
        return {"connected": False, "device": None, "job": None, "seconds_ago": None}
    w = max(seen, key=lambda x: x["t"])
    ago = time.monotonic() - w["t"]
    return {"connected": ago < win, "device": w.get("device"), "job": w.get("job") if ago < win else None,
            "seconds_ago": round(ago)}


def display_status(status, message, stale, cancel_requested=False):
    """What people see: cancelled (stored as failed + "cancelled by user"), cancelling (running, cancel asked, the worker
    stops at its next heartbeat or stage) and interrupted (running, no heartbeat for STALE_RUNNING: the worker stopped;
    it resumes when a worker claims it again) are shown as their own states."""
    if status == "failed" and message == CANCELLED:
        return "cancelled"
    if status == "running" and cancel_requested:
        return "cancelling"
    if status == "running" and stale:
        return "interrupted"
    return status


def stage_info(status, stage, done, total):
    """D35 (F2): the stage's number out of the real total, and overall progress 0..1 (finished stages + the share of the
    current one). The same numbers everywhere: job card, Jobs page, top bar and the map sweep."""
    n = len(STAGES)
    if status == "done":
        return n, n, 1.0
    if stage not in STAGES:
        return None, n, 0.0
    i = STAGES.index(stage)
    within = min(1.0, max(0.0, (done or 0) / total)) if total else 0.0
    return i + 1, n, round((i + within) / n, 4)


def _job(r):
    inp = dict(r[2] or {})
    stage_no, stage_count, progress = stage_info(r[3], r[4], r[5], r[6])
    return {"id": str(r[0]), "kind": r[1], "input": inp, "street": streetpick.plain_name(inp.get("street") or inp.get("name")),
            "status": r[3], "display_status": display_status(r[3], r[7], r[15], r[19]), "is_test": bool(r[14]),
            "stage_no": stage_no, "stage_count": stage_count, "progress": progress,
            "cancel_requested": bool(r[19]), "note": r[20],
            "stage": r[4], "done": r[5], "total": r[6], "message": r[7], "area_slug": r[8],
            "created_at": r[9].isoformat() if r[9] else None, "started_at": r[10].isoformat() if r[10] else None,
            "finished_at": r[11].isoformat() if r[11] else None, "heartbeat_at": r[12].isoformat() if r[12] else None,
            "worker_id": r[13], "approved": bool(r[16]), "plan_estimate": r[17], "device": r[18],
            "retryable": r[3] == "failed" and r[7] != CANCELLED and not r[8]}


def _get_job(c, job_id):
    try:
        uuid.UUID(str(job_id))
    except ValueError:
        raise HTTPException(422, "job id must be a UUID") from None
    r = c.execute(f"select {JOB_COLS} from jobs j left join areas a on a.id = j.area_id where j.id = %s", (job_id,)).fetchone()
    if not r:
        raise HTTPException(404, f"job {job_id} not found")
    return _job(r)


def _slugify(text, job_id):
    base = re.sub(r"[^a-z0-9]+", "_", (text or "area").lower()).strip("_")[:40] or "area"
    return f"{base}_{job_id[:6]}"


def _area_km2(poly):
    c = poly.centroid
    kx, ky = 111.320 * math.cos(math.radians(c.y)), 110.540
    return transform(lambda x, y, z=None: ((x - c.x) * kx, (y - c.y) * ky), poly).area


def _bundles(D):
    try:
        res, _ = D.read(lambda s: [b for b in (s.bundle(x) for x in s.slugs()) if b])
        return res
    except Exception:
        return []


def pick_street(settings, D, lat, lon, pending_ok=False):
    """The street under a click (streetpick.pick): 422 when there is no road, 503 when every map server failed. While
    the lookup is still running: streetpick.Pending (pending_ok, /jobs/preview answers 202) or 409 with a plain line."""
    try:
        return streetpick.pick(os.path.join(settings.data_dir, "cache", "streetpick"), _bundles(D), lat, lon,
                               google_key=settings.google_server_key)
    except streetpick.NoRoad as e:
        raise HTTPException(422, str(e)) from None
    except streetpick.Pending:
        if pending_ok:
            raise
        raise HTTPException(409, "Still finding this street — try again in a few seconds.") from None
    except streetpick.OverpassBusy:
        raise HTTPException(503, "Map server is busy — try again in a minute.") from None


# ------------------------------------------------------------------------------------------------ jobs
class ClickIn(BaseModel):
    lat: float = Field(ge=-90, le=90, examples=[11.0316])
    lon: float = Field(ge=-180, le=180, examples=[76.9745])


class JobIn(BaseModel):
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)
    polygon: Optional[dict] = Field(None, description="GeoJSON Polygon (lon/lat), a drawn area. A clicked street's own "
                                    "area may be a MultiPolygon (a street with gaps); it is built here, never sent")
    name: Optional[str] = Field(None, max_length=120)
    lines: Optional[dict] = Field(None, description="with {lat, lon}: the trimmed stretch of the clicked street (GeoJSON "
                                  "LineString / MultiLineString, lon/lat); the job polygon is rebuilt from it")
    include_elsewhere: bool = Field(False, description="D57: with {lat, lon}: also analyse the pieces of the same street "
                                    "name that don't connect to the clicked piece (the preview's `elsewhere`)")
    test: bool = Field(False, description="made by an automated test (only such jobs, and jobs cancelled before any worker "
                                          "started them, are removed by 'clear test jobs')")
    cost_cap_usd: Optional[float] = Field(None, gt=0, le=100, description="pause for approval above this planned cost "
                                          "(US$); default JOB_COST_CAP_USD (2)")


class EstimateIn(BaseModel):
    length_m: float = Field(gt=0, le=20000, examples=[420])


@router.post("/jobs/preview", tags=["jobs"])
def job_preview(body: ClickIn, request: Request, D: Data = Depends(get_data)):
    """Resolve a map click to the street it lands on (no job created) — for the confirm sheet. The estimate comes from
    the real camera plan (P7.2): planning starts here in the background; poll GET /jobs/plan-estimate/{key}."""
    try:
        res = pick_street(request.app.state.settings, D, body.lat, body.lon, pending_ok=True)
    except streetpick.Pending as p:
        if p.partial:
            # the road is known, its details (full name / length) are still loading: show it now; the browser keeps
            # asking and swaps in the full street. No cost estimate for an incomplete street (it would only add map load).
            return {"offline": not D.db_online, **p.partial, "status": "partial", "osm_details": False,
                    "plan_estimate": {"key": "", "status": "running", "elapsed_s": 0},
                    "cost_cap_usd": request.app.state.settings.job_cost_cap_usd}
        # hotfix: still looking it up (in the background): 202, the browser asks again; never a 503 for "slow"
        return JSONResponse(status_code=202, content={"offline": not D.db_online, "status": "pending", "retry_after_ms": 800})
    return {"offline": not D.db_online, **res, "status": "ok", "plan_estimate": _plan(request, res["polygon"], res.get("way_ids"), res.get("lines")),
            "cost_cap_usd": request.app.state.settings.job_cost_cap_usd}


def _plan(request, polygon, way_ids, lines=None):
    st = request.app.state.settings
    return planest.start(polygon, way_ids, data_dir=st.data_dir, maps_key=st.google_server_key,
                         model_card=request.app.state.model_card.get(), cap_usd=st.job_cost_cap_usd, lines=lines)


class PlanIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    lines: Optional[dict] = Field(None, description="the trimmed stretch (GeoJSON LineString / MultiLineString, lon/lat); "
                                  "none = the whole street")
    include_elsewhere: bool = Field(False, description="D57: include the unconnected pieces of the same name")


@router.post("/jobs/plan-estimate", tags=["jobs"])
def job_plan_estimate(body: PlanIn, request: Request, D: Data = Depends(get_data)):
    """Start (or join) the real-planner estimate for the street under {lat, lon}, or for a trimmed stretch of it.
    Same job polygon as POST /jobs would store. Returns {key, status, estimate?}."""
    pick = pick_street(request.app.state.settings, D, body.lat, body.lon)
    if body.include_elsewhere:
        pick = streetpick.with_elsewhere(pick)
    if body.lines is not None:
        try:
            pick = streetpick.trim(pick, body.lines)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
    return {"offline": not D.db_online, "length_m": pick["length_m"], **_plan(request, pick["polygon"], pick.get("way_ids"), pick.get("lines"))}


@router.get("/jobs/plan-estimate/{key}", tags=["jobs"])
def job_plan_estimate_status(key: str):
    """The planner estimate's progress: running (with elapsed seconds) / done (with the estimate) / failed (why)."""
    return {"offline": False, **planest.status(key)}


@router.post("/jobs", tags=["jobs"], status_code=201)
def job_create(body: JobIn, request: Request, D: Data = Depends(get_data)):
    """Queue an analysis: {lat, lon} (street click) or {polygon} (drawn area)."""
    settings = request.app.state.settings
    if not D.db_online and not D.probe():
        raise OfflineError("offline data mode — read only (jobs need the database)")
    job_id = str(uuid.uuid4())
    if body.polygon is not None:
        try:
            poly = shape(body.polygon)
        except Exception:
            raise HTTPException(422, "polygon must be a GeoJSON Polygon") from None
        if poly.geom_type != "Polygon" or not poly.is_valid:
            raise HTTPException(422, f"polygon must be a single valid Polygon ({explain_validity(poly)})")
        km2 = _area_km2(poly)
        if km2 > settings.max_polygon_km2:
            raise HTTPException(422, f"area is {km2:.2f} km²; the limit is {settings.max_polygon_km2} km² per job")
        name = body.name or "Drawn area"
        kind, inp = "polygon", {"polygon": mapping(poly), "name": name, "street": name, "area_km2": round(km2, 3)}
    elif body.lat is not None and body.lon is not None:
        pick = pick_street(settings, D, body.lat, body.lon)
        if body.include_elsewhere:
            pick = streetpick.with_elsewhere(pick)
        if body.lines is not None:
            try:
                pick = streetpick.trim(pick, body.lines)
            except ValueError as e:
                raise HTTPException(422, str(e)) from None
        kind, inp = "street_click", {"click": {"lat": body.lat, "lon": body.lon}, **pick,
                                     "name": body.name or pick["street"]}
        st = _plan(request, pick["polygon"], pick.get("way_ids"), pick.get("lines"))
        if st.get("estimate"):
            inp["estimate"] = st["estimate"]
    else:
        raise HTTPException(422, "give {lat, lon} or {polygon}")
    inp["slug"] = _slugify(inp["name"], job_id)
    # P7.2: this job's cost cap (the worker pauses above it) and the rates behind the confirm sheet's estimate, so the
    # worker's check prices the plan the same way
    inp["cost_cap_usd"] = body.cost_cap_usd if body.cost_cap_usd is not None else settings.job_cost_cap_usd
    rates = planest.measured_rates(settings.areas_dir, request.app.state.model_card.get())
    inp["rates"] = {"sv_price": rates.get("sv_price"), "cloud_usd_per_image": rates.get("cloud_usd_per_image")}

    def fn(s):
        with s.pool.connection() as c:
            if not body.test:
                # P6 cap: one street at a time (cost control on a free-tier demo). Test jobs never block real ones.
                busy = c.execute(f"""select case when coalesce((j.input->>'hidden')::boolean, false) then null else j.input->>'street' end from jobs j where not j.is_test and j.status in {ACTIVE_SQL}
                                     order by j.created_at limit 1""").fetchone()
                if busy:
                    raise HTTPException(409, f"“{busy[0] or 'Another street'}” is still being analysed. One street at a "
                                             "time: wait for it to finish, or cancel it on the Jobs page.")
            c.execute("insert into jobs (id, kind, input, status, is_test) values (%s, %s, %s, 'queued', %s)",
                      (job_id, kind, json.dumps(inp), body.test))
            return _get_job(c, job_id)
    job = D.write(fn)
    online = worker_online(request.app)
    return {"offline": False, "job": job, "worker_online": online,
            "notice": None if online else "queued — analysis worker offline"}


@router.get("/jobs", tags=["jobs"])
def job_list(request: Request, active: bool = False, limit: int = 50, D: Data = Depends(get_data)):
    def fn(s):
        if s.source == "json":
            return []
        with s.pool.connection() as c:
            _finish_stale_cancels(c)
            # D64: a hidden job (a re-run set up by the owner, its area hidden until approved) is not listed; GET /jobs/{id}
            # still answers
            where = "where not coalesce((j.input->>'hidden')::boolean, false)" + (f" and j.status in {ACTIVE_SQL}" if active else "")
            return [_job(r) for r in c.execute(f"select {JOB_COLS} from jobs j left join areas a on a.id = j.area_id "
                                               f"{where} order by j.created_at desc limit %s", (max(1, min(limit, 200)),))]
    jobs, off = D.read(fn)
    return {"offline": off, "jobs": jobs, "worker_online": worker_online(request.app), "worker": worker_status(request.app)}


class ClearIn(BaseModel):
    dry_run: bool = Field(True, description="true: only list what would be removed")
    ids: Optional[List[str]] = Field(None, description="remove only these (from the dry run the person confirmed)")


@router.post("/jobs/clear-test", tags=["jobs"])
def job_clear_test(body: ClearIn, request: Request, D: Data = Depends(get_data)):
    """Remove test jobs and the test areas they made: jobs made by automated tests or the fake worker (with their areas),
    and jobs cancelled before any worker started them. Real analyses, their areas and the three original areas are never
    touched. Call with dry_run first; send the listed ids back to remove exactly what was confirmed."""
    settings = request.app.state.settings
    if not body.dry_run and body.ids is None:
        # extras F1: never remove by rule alone. A removal names the exact jobs (the ones the dry run listed and a
        # person confirmed, or the ones a test made); a job that is not named is never touched.
        raise HTTPException(422, "give the ids to remove (from the dry run); nothing is removed by rule alone")

    def fn(s):
        with s.pool.connection() as c:
            ids = [str(r[0]) for r in c.execute(TEST_JOB_SQL)]
            if body.ids is not None:
                ids = [i for i in ids if i in set(body.ids)]
            jobs = [_get_job(c, i) for i in ids]
        if not body.dry_run:
            for jb in jobs:
                if jb["area_slug"]:
                    delete_area(s, settings, jb["area_slug"], require_test=True)
            with s.pool.connection() as c:
                if ids:
                    c.execute("delete from jobs where id = any(%s::uuid[])", (ids,))
        return jobs
    jobs = D.write(fn)
    return {"offline": False, "dry_run": body.dry_run, "removed": [] if body.dry_run else [j["id"] for j in jobs], "jobs": jobs,
            "areas": [{"slug": j["area_slug"], "name": j["street"]} for j in jobs if j["area_slug"]]}


@router.get("/jobs/{job_id}", tags=["jobs"])
def job_get(job_id: str, request: Request, D: Data = Depends(get_data)):
    """One job, with the confirm sheet's planner estimate stored when it was queued (an estimate, not a measurement)."""
    def fn(s):
        with s.pool.connection() as c:
            return _get_job(c, job_id)
    job = D.write(fn)
    # P7.2: the planner estimate stored with the job (jobs created before P7.2 have none)
    return {"offline": False, "job": job, "worker_online": worker_online(request.app),
            "estimate": (job["input"] or {}).get("estimate")}


@router.get("/jobs/{job_id}/minimap", tags=["jobs"])
def job_minimap(job_id: str, request: Request, D: Data = Depends(get_data)):
    """D39: the Jobs page's mini-map: roads around the requested stretch and, once analysed, its camera stops."""
    def fn(s):
        with s.pool.connection() as c:
            return _get_job(c, job_id)
    job = D.write(fn)
    slug = job.get("area_slug")
    bundle, _ = D.read(lambda s: s.bundle(slug)) if slug else (None, False)
    plan = request.app.state.plans.get(slug) if slug else None
    cache = os.path.join(request.app.state.settings.data_dir, "cache", "streetpick")
    return {"offline": False, "job": job_id, **minimap.job_context(job.get("input"), bundle, plan, cache)}


@router.post("/jobs/{job_id}/cancel", tags=["jobs"])
def job_cancel(job_id: str, request: Request, D: Data = Depends(get_data)):
    """Cancel a job that has not finished; workers never claim it again. A job a live worker is running is "cancelling"
    first: the worker sees it at its next heartbeat (15 s) or stage, stops, and reports back → cancelled. A job with no
    live worker (queued, paused, interrupted) is cancelled at once."""
    def fn(s):
        with s.pool.connection() as c:
            j = _get_job(c, job_id)
            if j["status"] not in ("queued", "running", "expired_token", "needs_approval"):
                raise HTTPException(409, f"job is already {j['status']}")
            if j["display_status"] in ("running", "cancelling"):
                c.execute("update jobs set cancel_requested = true where id = %s", (job_id,))
            else:
                c.execute("update jobs set status = 'failed', message = %s, finished_at = now(), cancel_requested = false "
                          "where id = %s", (CANCELLED, job_id))
            return _get_job(c, job_id)
    return {"offline": False, "job": D.write(fn), "worker_online": worker_online(request.app)}


@router.delete("/jobs/{job_id}", tags=["jobs"])
def job_remove(job_id: str, D: Data = Depends(get_data)):
    """"Remove from list": a job that ended without a result (failed, cancelled, no Street View). Jobs with an area are
    removed by deleting the area; queued / running / paused jobs are cancelled first."""
    def fn(s):
        with s.pool.connection() as c:
            j = _get_job(c, job_id)
            # also a finished job whose area was deleted before deleting took the job with it (D35 F8)
            if (j["status"] not in REMOVABLE and j["status"] != "done") or j["area_slug"]:
                raise HTTPException(409, "only jobs that ended without a result can be removed from the list")
            c.execute("delete from jobs where id = %s", (job_id,))
            return j["id"]
    return {"offline": False, "removed": D.write(fn)}


def _finish_stale_cancels(c):
    """a cancel asked while the worker was going silent: nobody will report back, so it is simply cancelled"""
    c.execute(f"""update jobs set status = 'failed', message = %s, finished_at = now(), cancel_requested = false
                  where status = 'running' and cancel_requested
                    and (heartbeat_at is null or heartbeat_at < now() - interval '{STALE_RUNNING}')""", (CANCELLED,))


def delete_area(s, settings, slug, require_test=False):
    """Delete an area made by a job: its rows (review items cascade) and its job, then its folder. Never the originals;
    with require_test only areas made by a test job. Review history rows are append-only and stay."""
    if slug in ORIGINAL_AREAS:
        raise HTTPException(403, "the original areas can't be deleted")
    with s.pool.connection() as c:
        row = c.execute("""select a.id, a.source_job_id, coalesce(j.is_test, false) from areas a
                           left join jobs j on j.id = a.source_job_id where a.slug = %s""", (slug,)).fetchone()
        if not row:
            raise HTTPException(404, f"area {slug!r} not found")
        if row[1] is None:
            raise HTTPException(403, "only areas analysed from the app can be deleted")
        if require_test and not row[2]:
            raise HTTPException(403, "not a test area")
        c.execute("delete from areas where id = %s", (row[0],))
        c.execute("delete from jobs where id = %s", (row[1],))                # F8: its job leaves the list with it
    s.invalidate(slug)
    folder = os.path.join(settings.areas_dir, slug)
    if os.path.isfile(os.path.join(folder, "live_run.json")):
        shutil.rmtree(folder, ignore_errors=True)


@router.post("/jobs/{job_id}/approve", tags=["jobs"])
def job_approve(job_id: str, request: Request, D: Data = Depends(get_data)):
    """A person accepts a job's cost estimate: it goes back to the queue with the cost cap lifted for this job."""
    def fn(s):
        with s.pool.connection() as c:
            j = _get_job(c, job_id)
            if j["status"] != "needs_approval":
                raise HTTPException(409, f"job is {j['status']}, not waiting for approval")
            c.execute("update jobs set status = 'queued', approved = true, message = null where id = %s", (job_id,))
            return _get_job(c, job_id)
    return {"offline": False, "job": D.write(fn), "worker_online": worker_online(request.app)}


@router.post("/jobs/{job_id}/retry", tags=["jobs"])
def job_retry(job_id: str, request: Request, D: Data = Depends(get_data)):
    """Retry a failed job: the SAME job is queued again. started_at is kept, so the worker that claims it is told it is a
    resumed claim and continues from the progress it saved on Drive (photos already bought are not fetched again)."""
    def fn(s):
        with s.pool.connection() as c:
            j = _get_job(c, job_id)
            if not j["retryable"]:          # failed with an error: not cancelled, not "no Street View", no area
                raise HTTPException(409, f"job is {j['display_status']}: only a failed job can be retried")
            if not j["is_test"]:
                busy = c.execute(f"""select case when coalesce((j.input->>'hidden')::boolean, false) then null else j.input->>'street' end from jobs j where not j.is_test and j.status in {ACTIVE_SQL}
                                     and j.id <> %s order by j.created_at limit 1""", (job_id,)).fetchone()
                if busy:
                    raise HTTPException(409, f"“{busy[0] or 'Another street'}” is still being analysed. One street at a "
                                             "time: wait for it to finish, or cancel it on the Jobs page.")
            c.execute("""update jobs set status = 'queued', message = null, note = null, finished_at = null, stage = null,
                         done = null, total = null, cancel_requested = false where id = %s""", (job_id,))
            return _get_job(c, job_id)
    job = D.write(fn)
    online = worker_online(request.app)
    return {"offline": False, "job": job, "worker_online": online,
            "notice": None if online else "queued — analysis worker offline"}


@router.get("/worker/status", tags=["worker"])
def worker_status_public(request: Request):
    """For the app's top bar: is a worker connected, on which device, and which street it is analysing."""
    return {"offline": False, **worker_status(request.app)}


# ------------------------------------------------------------------------------------------------ worker
def worker_auth(request: Request, x_worker_token: str = Header("", alias="X-Worker-Token")):
    expected = request.app.state.settings.worker_token
    if not expected:
        raise HTTPException(503, "WORKER_TOKEN is not configured on the backend")
    if not hmac.compare_digest(x_worker_token.encode(), expected.encode()):
        raise HTTPException(401, "bad worker token")


class NextIn(BaseModel):
    worker_id: str = Field(min_length=1, max_length=80)
    device: Optional[str] = Field(None, max_length=10, description="gpu | cpu")
    job: Optional[str] = Field(None, description="claim exactly this job (resume after fresh AWS keys; tests). Without it "
                                                 "the oldest claimable job that is not a test job is claimed.")
    test: bool = Field(False, description="a test worker (the fake worker's replay): the job it claims becomes a test job, so "
                                          "'Clear test jobs' removes it and its area")


class ProgressIn(BaseModel):
    job: str
    stage: str = Field(max_length=40)
    done: Optional[int] = None
    total: Optional[int] = None
    message: Optional[str] = Field(None, max_length=500)
    worker_id: Optional[str] = Field(None, max_length=80)
    note: Optional[str] = Field(None, max_length=300, description="a note for people, e.g. continued from saved progress")


class HeartbeatIn(BaseModel):
    worker_id: str = Field(min_length=1, max_length=80)
    job: Optional[str] = None
    device: Optional[str] = Field(None, max_length=10)


class FailIn(BaseModel):
    job: str
    code: str = Field(max_length=40)
    message: Optional[str] = Field(None, max_length=2000)
    estimate: Optional[dict] = Field(None, description="NEEDS_APPROVAL: the plan-time estimate (photos, cost, minutes)")
    worker_id: Optional[str] = Field(None, max_length=80)


class KnownIn(BaseModel):
    ids: List[str] = Field(default_factory=list, max_length=500)


def _seen(request, worker_id, device=None, job=None):
    """Remember a worker: last seen, device, and a short description of its job for the top bar."""
    if not worker_id:
        return
    w = request.app.state.workers.get(worker_id)
    w = dict(w) if isinstance(w, dict) else {}
    w["t"] = time.monotonic()
    if device:
        w["device"] = device
    if job is not None:
        w["job"] = job or None
    request.app.state.workers[worker_id] = w


def _job_brief(j):
    if j and j["input"].get("hidden"):
        return ""                                     # D64: a hidden job is not named in the top bar
    return {"id": j["id"], "street": j["street"], "stage": j["stage"], "done": j["done"], "total": j["total"]} if j else None


@router.post("/worker/next", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_next(body: NextIn, request: Request, D: Data = Depends(get_data)):
    """Claim ONE job: the oldest queued one, one waiting for fresh AWS keys, or a running one whose worker went silent
    (interrupted: it resumes). A job waiting for cost approval is never claimed."""
    _seen(request, body.worker_id, body.device)

    if body.job:
        try:
            uuid.UUID(body.job)
        except ValueError:
            raise HTTPException(422, "job id must be a UUID") from None

    def fn(s):
        with s.pool.connection() as c:
            # claimable: queued, waiting for fresh keys, or running with a silent worker (interrupted). A worker asking
            # again for the job it already holds (it re-entered the tunnel URL) gets it back too.
            _finish_stale_cancels(c)
            which = "id = %s and" if body.job else "not is_test and"
            # a fresh attempt: progress starts again from its first stage (forward-only within an attempt)
            r = c.execute(f"""with pick as (select id, started_at from jobs
                                  where {which} not cancel_requested and (status in ('queued', 'expired_token')
                                             or (status = 'running' and (heartbeat_at is null or worker_id = %s
                                                 or heartbeat_at < now() - interval '{STALE_RUNNING}')))
                                  order by created_at limit 1 for update skip locked)
                              update jobs set status = 'running', started_at = coalesce(jobs.started_at, now()), heartbeat_at = now(),
                                     worker_id = %s, device = coalesce(%s, device), message = null, note = null,
                                     stage = null, done = null, total = null, is_test = is_test or %s
                              from pick where jobs.id = pick.id
                              returning jobs.id, pick.started_at is not null""",
                          (*([body.job] if body.job else []), body.worker_id, body.worker_id, body.device, body.test)).fetchone()
            if not r:
                return None
            j = _get_job(c, str(r[0]))
            j["resumed_claim"] = bool(r[1])          # an earlier attempt started it: the worker says whether it continues
            return j
    job = D.write(fn)
    _seen(request, body.worker_id, job=_job_brief(job) or "")
    return {"offline": False, "job": job}


class MapDataIn(BaseModel):
    kind: str = Field(pattern="^(overpass|microsoft)$")
    query: Optional[str] = Field(None, max_length=8000, description="overpass: the pipeline's query text")
    bbox: Optional[List[float]] = Field(None, min_length=4, max_length=4, description="microsoft: min_lon, min_lat, max_lon, max_lat")


@router.post("/worker/mapdata", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_mapdata(body: MapDataIn, request: Request):
    """D53: map data for the worker's area stage (geo_cascadia.area.MAP_SOURCE in the Colab cell). Covered cities: from
    PostGIS (source "local", with the snapshot dates). Elsewhere, Overpass through this API's raced mirrors and 30-day
    cache (source "overpass" / "cache"); "pending" = still asking (the worker asks again), "none" = not available here
    (the worker then asks Overpass / Microsoft itself, as before)."""
    if body.kind == "microsoft":
        if not body.bbox:
            raise HTTPException(422, "bbox is required for microsoft")
        minx, miny, maxx, maxy = body.bbox
        rings = mapdata.ms_rings(miny, minx, maxy, maxx)
        if rings is None:
            return {"source": "none"}
        return {**mapdata.source_line(mapdata.city_for_box(miny, minx, maxy, maxx)), "rings": rings}
    if not body.query:
        raise HTTPException(422, "query is required for overpass")
    loc = mapdata.answer(body.query)
    if loc is not None:
        return {**loc[1], "elements": loc[0]}
    cache = os.path.join(request.app.state.settings.data_dir, "cache", "streetpick")
    try:
        els, cached = streetpick.overpass(body.query, cache, time.monotonic() + 20)   # < the tunnel's 100 s limit
    except streetpick.OverpassSlow:
        return {"source": "pending", "retry_after_s": 5}
    except streetpick.OverpassBusy:
        return {"source": "none"}
    return {"source": "cache" if cached else "overpass", "elements": els}


class RegisterIn(BaseModel):
    job: str


@router.post("/worker/register", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_register(body: RegisterIn, request: Request, D: Data = Depends(get_data)):
    """D64: a re-run of an analysed area keeps that area's synthetic register. For a job whose input names
    `register_from` (an area slug), the records (with their hidden building ids) and the planted list of that area, as
    its run saved them; the pipeline pairs them by location as always. 404 when the job asks for none."""
    def fn(s):
        with s.pool.connection() as c:
            return _get_job(c, body.job)
    j, _ = D.read(fn)
    src = j["input"].get("register_from")
    if not src or not re.fullmatch(r"[a-z0-9_]+", src):
        raise HTTPException(404, "this job keeps no earlier register")
    folder = os.path.join(request.app.state.settings.areas_dir, src)
    try:
        with open(os.path.join(folder, "register_synthetic.json"), encoding="utf-8") as f:
            records = json.load(f)
        with open(os.path.join(folder, "planted_register_mistakes.json"), encoding="utf-8") as f:
            planted = json.load(f)
    except (OSError, ValueError):
        raise HTTPException(404, f"no saved register for {src}") from None
    return {"offline": False, "from": src, "records": records, "planted": planted}


@router.post("/worker/known", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_known(body: KnownIn, D: Data = Depends(get_data)):
    """Of the job ids whose progress a worker keeps on Drive, the ones still worth keeping: not finished, or failed and
    retryable. The worker deletes the saved progress of the rest (done, cancelled, removed from the list)."""
    ids = []
    for x in body.ids:
        try:
            ids.append(str(uuid.UUID(x)))
        except ValueError:
            pass

    def fn(s):
        with s.pool.connection() as c:
            rows = c.execute(f"""select j.id from jobs j where j.id = any(%s::uuid[]) and (j.status in {ACTIVE_SQL}
                                 or (j.status = 'failed' and j.message is distinct from %s and j.area_id is null))""",
                             (ids, CANCELLED)).fetchall()
            return sorted(str(r[0]) for r in rows)
    return {"offline": False, "keep": D.write(fn) if ids else []}


@router.post("/worker/heartbeat", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_heartbeat(body: HeartbeatIn, request: Request, D: Data = Depends(get_data)):
    job = None
    if body.job:
        def fn(s):
            with s.pool.connection() as c:
                c.execute("update jobs set heartbeat_at = now(), device = coalesce(%s, device) where id = %s and status = 'running'",
                          (body.device, body.job))
                return _get_job(c, body.job)
        job = D.write(fn)
    _seen(request, body.worker_id, body.device, _job_brief(job) if body.job else "")
    # "cancelling" / "failed" (cancelled) tell the worker to stop this job
    return {"offline": False, "ok": True, "job_status": job["display_status"] if job else None}


@router.post("/worker/progress", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_progress(body: ProgressIn, request: Request, D: Data = Depends(get_data)):
    """Stage + done/total. Sub-steps map onto the ten stages; progress only moves forward within an attempt (a late report
    from an earlier stage keeps the stage but refreshes the heartbeat). The response's job_status tells the worker to
    stop when the job is being cancelled."""
    stage = SUB_STAGES.get(body.stage, body.stage)

    def fn(s):
        with s.pool.connection() as c:
            cur = _get_job(c, body.job)
            back = stage in STAGES and cur["stage"] in STAGES and STAGES.index(stage) < STAGES.index(cur["stage"])
            if back:
                c.execute("update jobs set heartbeat_at = now() where id = %s and status = 'running'", (body.job,))
            else:
                c.execute("""update jobs set stage = %s, done = %s, total = %s, message = coalesce(%s, message),
                             note = coalesce(%s, note), heartbeat_at = now() where id = %s and status = 'running'""",
                          (stage, body.done, body.total, body.message, body.note, body.job))
            return _get_job(c, body.job)
    job = D.write(fn)
    _seen(request, body.worker_id, job=_job_brief(job))
    return {"offline": False, "job": job, "job_status": job["display_status"]}


@router.post("/worker/fail", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_fail(body: FailIn, request: Request, D: Data = Depends(get_data)):
    """NO_STREET_VIEW / NO_STREETS / NO_CAMERAS → no_street_view; GOOGLE_KEY / GOOGLE_REQUEST / BAD_AREA → failed with
    the cause (retryable); AWS_TOKEN_EXPIRED → expired_token (resumable);
    NEEDS_APPROVAL → needs_approval (cost cap: waits for a person, with the estimate); anything else → failed."""
    status = FAIL_CODES.get(body.code.upper(), "failed")

    def fn(s):
        with s.pool.connection() as c:
            _get_job(c, body.job)
            msg = CANCELLED if body.code.upper() == "CANCELLED" else body.message
            c.execute("""update jobs set status = %s, message = %s, estimate = coalesce(%s, estimate), cancel_requested = false,
                         finished_at = case when %s = any(%s) then null else now() end, heartbeat_at = now()
                         where id = %s and status <> 'done'""",
                      (status, msg, json.dumps(body.estimate) if body.estimate else None, status, list(OPEN_STATUSES), body.job))
            return _get_job(c, body.job)
    job = D.write(fn)
    _seen(request, body.worker_id, job="")
    return {"offline": False, "job": job}


@router.post("/worker/result", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_result(request: Request, job: str = Form(...), files: List[UploadFile] = File(...),
                  worker_id: Optional[str] = Form(None), D: Data = Depends(get_data)):
    """Upload export.json + run JSONs → saved to data/areas/<slug>/, run_report built, area loaded into the DB with the
    same rules as the original areas (street names, gap display, coverage banner, positions and sign-text use come from
    the pipeline's own export). A live_run.json marks it as a fresh, non-resumed run: its timings and costs are real."""
    settings = request.app.state.settings
    if not D.db_online and not D.probe():
        raise OfflineError("offline data mode — read only (results need the database)")
    blobs = {}
    for f in files:
        name = os.path.basename(f.filename or "")
        if not FILE_OK.match(name):
            raise HTTPException(422, f"file name not allowed: {name!r}")
        data = f.file.read(MAX_FILE + 1)
        if len(data) > MAX_FILE:
            raise HTTPException(413, f"{name} is larger than {MAX_FILE // (1024 * 1024)} MB")
        if name.endswith((".json", ".geojson")):
            try:
                json.loads(data)
            except ValueError:
                raise HTTPException(422, f"{name} is not valid JSON") from None
        blobs[name] = data
    if "export.json" not in blobs:
        raise HTTPException(422, "export.json is required")
    exp = json.loads(blobs["export.json"])
    if not isinstance(exp, dict) or not {"meta", "buildings", "assets"} <= set(exp):
        raise HTTPException(422, "export.json does not look like a pipeline export (meta/buildings/assets missing)")

    def fn(s):
        with s.pool.connection() as c:
            j = _get_job(c, job)
        if j["status"] != "running" or j["cancel_requested"]:
            raise HTTPException(409, f"job is {j['display_status']}" + (f" ({j['message']})" if j.get("message") else ""))
        slug = j["input"].get("slug") or _slugify(j["street"], j["id"])
        folder = os.path.join(settings.areas_dir, slug)
        tmp = folder + f".upload-{uuid.uuid4().hex[:6]}"
        os.makedirs(tmp)
        try:
            for name, data in blobs.items():
                with open(os.path.join(tmp, name), "wb") as fh:
                    fh.write(data)
            fill_street_names(tmp, j["input"])      # F4 / D36: every street gets a plain display name
            try:            # the worker's own note: did this run resume from files saved by an earlier attempt?
                wr = json.loads(blobs["worker_run.json"]) if "worker_run.json" in blobs else {}
            except ValueError:
                wr = {}
            with open(os.path.join(tmp, "live_run.json"), "w", encoding="utf-8") as fh:
                json.dump({"job_id": j["id"], "device": j.get("device"), "street": j["street"], "kind": j["kind"],
                           "started_at": j["started_at"], "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                           "resumed_from_saved_files": bool(wr.get("resumed_from_saved_files")),
                           "attempts": wr.get("attempts"), "ocr_mode": wr.get("ocr_mode"),
                           "replay_of": wr.get("replay_of")}, fh)             # fake worker: another run's files
            if j["input"].get("hidden"):                  # D64: kept out of the area list until the owner switches
                with open(os.path.join(tmp, loader.HIDDEN_FILE), "w", encoding="utf-8") as fh:
                    json.dump({"hidden": True, "job_id": j["id"], "why": j["input"].get("hidden_why") or "hidden job"}, fh)
            r = subprocess.run([sys.executable, os.path.join(loader.ROOT, "tools", "build_run_report.py"), tmp],
                               capture_output=True, text=True, encoding="utf-8", env={**os.environ, "PYTHONUTF8": "1"})
            if r.returncode:
                raise HTTPException(422, "build_run_report failed: " + (r.stderr.strip().splitlines() or ["?"])[-1][:300])
            if os.path.isdir(folder):
                shutil.rmtree(folder)
            os.replace(tmp, folder)
        finally:
            if os.path.isdir(tmp):
                shutil.rmtree(tmp, ignore_errors=True)
        with s.pool.connection() as c:
            res = loader.load_area(c, folder, slug=slug, source_job_id=j["id"])
            c.execute("""update jobs set status = 'done', stage = 'done', area_id = %s, finished_at = now(), heartbeat_at = now(),
                         message = null, is_test = is_test or %s where id = %s""",
                      (res["area_id"], bool(wr.get("replay_of")), j["id"]))
            out = _get_job(c, j["id"])
        s.invalidate(slug)
        _osm_tags_later(s, request.app.state.settings, slug)
        from . import boxchoice                                  # D62: which box is "this building" (display only)
        boxchoice.write_later(folder, os.path.join(request.app.state.settings.data_dir, "cache", "p45_overpass"), log)
        return out
    out = D.write(fn)
    _seen(request, worker_id, job="")
    return {"offline": False, "job": out}


def _osm_tags_later(s, settings, slug):
    """extras 3 + 4: a new area gets its OpenStreetMap names and building:levels (one Overpass look-up by id, in the
    background; best effort: until it lands, the comparison says it is not loaded yet)"""
    def run():
        try:
            from . import osmref
            osmref.fetch(s.bundle(slug), settings.areas_dir, os.path.join(settings.data_dir, "cache", "streetpick"), s.pool)
        except Exception as e:                                        # noqa: BLE001 - never fails the delivered result
            log.warning("OpenStreetMap tags for %s not fetched (%s): run tools/fetch_osm_tags.py", slug, type(e).__name__)
    threading.Thread(target=run, name="osm-tags", daemon=True).start()


def is_deletable(slug):
    return slug not in ORIGINAL_AREAS


STREET_KEYS = ("buildings", "assets", "missing_asset_records", "streetlight_gaps", "unmapped_businesses", "review_queue")


def fill_street_names(folder, job_input=None):
    """D35/D36: a street the pipeline could not name (no Google route name) keeps its raw OpenStreetMap label, e.g.
    "(unnamed residential #907980850)". Give it a plain display name from real map names only: the clicked street keeps
    the name the picker gave it (it saw the roads at both ends); any other one gets streetpick.unnamed_label from the
    run's own streets ("between A and B" / "near A"). Added to street_names.json and put on the export's records, as the
    pipeline does for the names it found. Display names only; no numbers change.
    P7.1: the clicked street gets the picker's name even when the pipeline found a Google route name for it (Google's
    reverse geocoding names the nearest route, often the cross street), so the Analyse box, Jobs, the map and the records
    all use one label for it."""
    def rd(n, default):
        p = os.path.join(folder, n)
        if not os.path.isfile(p):
            return default
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    streets, names, exp = rd("streets.json", []), rd("street_names.json", {}), rd("export.json", None)
    if not exp or not isinstance(streets, list):
        return
    from shapely.geometry import LineString, MultiLineString, Point
    from geo_cascadia.geo import Frame
    geo, ways, Fr = {}, {}, None
    for st in streets:
        ls = st.get("lines_latlon")
        ls = json.loads(ls) if isinstance(ls, str) else ls
        ls = [l for l in (ls or []) if len(l) >= 2]
        if not ls:
            continue
        Fr = Fr or Frame(ls[0][0][0], ls[0][0][1])
        geo[st["name"]] = MultiLineString([LineString([Fr.xy(p[0], p[1]) for p in l]) for l in ls])
        w = st.get("way_ids")
        ways[st["name"]] = set(json.loads(w) if isinstance(w, str) else (w or []))
    display = lambda raw: names.get(raw, raw)
    ji = job_input or {}
    job_ways, job_name = set(ji.get("way_ids") or []), ji.get("street")
    new, used = {}, set(names.values())
    for raw in geo:
        clicked = bool(job_name and ways.get(raw, set()) & job_ways)
        if not str(raw).startswith("(unnamed") or (raw in names and not clicked):
            continue
        if clicked:
            base = job_name                                    # the clicked street: the picker's name
            if names.get(raw) == base:
                continue
            old = names.get(raw)
            if old:                                            # replaces the pipeline's Google route name on the records
                used.discard(old)
        else:
            named = [(streetpick.tidy(display(n)), g) for n, g in geo.items() if n != raw]
            base = streetpick.unnamed_label(geo[raw], named, Point(0, 0))
        name, k = base, 2
        while name in used:
            name, k = f"{base} ({k})", k + 1
        new[raw] = name; used.add(name)
    if not new:
        return
    # P7.3: keep the pipeline's own names (its Google geocoding vote) before the app changes them: a source for the
    # street-name picker, never overwritten
    keep = os.path.join(folder, "street_names_pipeline.json")
    if not os.path.isfile(keep):
        with open(keep, "w", encoding="utf-8") as f:
            json.dump(rd("street_names.json", {}), f)
    # records carry the display name (the raw label, or the pipeline's Google name): map both to the new name
    rename = {display(raw): nm for raw, nm in new.items()}
    rename.update(new)
    names.update(new)
    for key in STREET_KEYS:
        for rec in exp.get(key) or []:
            if isinstance(rec, dict) and rec.get("street") in rename:
                rec["street"] = rename[rec["street"]]
    by = ((exp.get("dashboard") or {}).get("charts") or {}).get("by_street")
    if isinstance(by, dict):
        exp["dashboard"]["charts"]["by_street"] = {rename.get(k, k): v for k, v in by.items()}
    if isinstance((exp.get("dashboard") or {}).get("streets"), list):
        exp["dashboard"]["streets"] = [rename.get(x, x) for x in exp["dashboard"]["streets"]]
    for n, obj in (("street_names.json", names), ("export.json", exp)):
        with open(os.path.join(folder, n), "w", encoding="utf-8") as f:
            json.dump(obj, f)
