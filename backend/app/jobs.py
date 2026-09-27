"""Jobs (analyse a new street) and the Colab worker protocol (CLAUDE.md §7-8).

A street click is resolved on the laptop by app/streetpick.py (a port of geo_cascadia.picker.click_to_street: analysed
areas answer from their own streets.json, Overpass with a 15 s budget, a disk cache, display names, overlap check).
The job stores the polygon (GeoJSON, lon/lat), OSM way ids and an output slug, so the worker can call run_area directly.
Jobs need the database: in offline data mode, creating/claiming jobs returns 503.
"""
import hmac
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from shapely.geometry import mapping, shape
from shapely.ops import transform
from shapely.validation import explain_validity

from . import loader, streetpick, views
from .store import Data, OfflineError

router = APIRouter()
STALE_RUNNING = "10 minutes"      # a running job with no heartbeat for this long can be claimed again (worker died)
JOB_COLS = f"""j.id, j.kind, j.input, j.status, j.stage, j.done, j.total, j.message, a.slug, j.created_at, j.started_at,
              j.finished_at, j.heartbeat_at, j.worker_id, j.is_test,
              (j.status = 'running' and (j.heartbeat_at is null or j.heartbeat_at < now() - interval '{STALE_RUNNING}'))"""
FAIL_CODES = {"NO_STREET_VIEW": "no_street_view", "NO_STREETS": "no_street_view", "NO_CAMERAS": "no_street_view",
              "AWS_TOKEN_EXPIRED": "expired_token", "EXPIRED_TOKEN": "expired_token"}
FILE_OK = re.compile(r"^[A-Za-z0-9_.-]{1,80}\.(json|geojson|csv)$")
MAX_FILE = 40 * 1024 * 1024
CANCELLED = "cancelled by user"
# "Clear test jobs" removes ONLY jobs that ended without a result and were either made by automated tests (is_test) or
# cancelled before any worker picked them up (nothing was analysed, so nothing is lost). Never done / queued / running.
TEST_JOB_SQL = f"""select j.id from jobs j where j.area_id is null and j.status in ('failed', 'no_street_view')
                    and (j.is_test or (j.status = 'failed' and j.message = '{CANCELLED}' and j.started_at is null))"""


def get_data(request: Request) -> Data:
    return request.app.state.data


def worker_online(app):
    win = app.state.settings.worker_online_s
    return any(time.monotonic() - t < win for t in app.state.workers.values())


def display_status(status, message, stale):
    """What people see: cancelled (stored as failed + "cancelled by user") and interrupted (running, no heartbeat for
    10 min: the worker stopped; it resumes when a worker claims it again) are shown as their own states."""
    if status == "failed" and message == CANCELLED:
        return "cancelled"
    if status == "running" and stale:
        return "interrupted"
    return status


def _job(r):
    inp = dict(r[2] or {})
    return {"id": str(r[0]), "kind": r[1], "input": inp, "street": inp.get("street") or inp.get("name"), "status": r[3],
            "display_status": display_status(r[3], r[7], r[15]), "is_test": bool(r[14]),
            "stage": r[4], "done": r[5], "total": r[6], "message": r[7], "area_slug": r[8],
            "created_at": r[9].isoformat() if r[9] else None, "started_at": r[10].isoformat() if r[10] else None,
            "finished_at": r[11].isoformat() if r[11] else None, "heartbeat_at": r[12].isoformat() if r[12] else None,
            "worker_id": r[13]}


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


def pick_street(settings, D, lat, lon):
    """The street under a click (streetpick.pick): 422 when there is no road, 503 when OpenStreetMap is busy."""
    try:
        return streetpick.pick(os.path.join(settings.data_dir, "cache", "streetpick"), _bundles(D), lat, lon)
    except streetpick.NoRoad as e:
        raise HTTPException(422, str(e)) from None
    except streetpick.OverpassBusy as e:
        raise HTTPException(503, str(e)) from None


# ------------------------------------------------------------------------------------------------ jobs
class ClickIn(BaseModel):
    lat: float = Field(ge=-90, le=90, examples=[11.0316])
    lon: float = Field(ge=-180, le=180, examples=[76.9745])


class JobIn(BaseModel):
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)
    polygon: Optional[dict] = Field(None, description="GeoJSON Polygon (lon/lat)")
    name: Optional[str] = Field(None, max_length=120)
    lines: Optional[dict] = Field(None, description="with {lat, lon}: the trimmed stretch of the clicked street (GeoJSON "
                                  "LineString / MultiLineString, lon/lat); the job polygon is rebuilt from it")
    test: bool = Field(False, description="made by an automated test (only such jobs, and jobs cancelled before any worker "
                                          "started them, are removed by 'clear test jobs')")


class EstimateIn(BaseModel):
    length_m: float = Field(gt=0, le=20000, examples=[420])


@router.post("/jobs/preview", tags=["jobs"])
def job_preview(body: ClickIn, request: Request, D: Data = Depends(get_data)):
    """Resolve a map click to the street it lands on (no job created) — for the confirm sheet."""
    res = pick_street(request.app.state.settings, D, body.lat, body.lon)
    return {"offline": not D.db_online, **res, "estimate": _estimate(request, D, res.get("length_m"))}


def _estimate(request, D, length_m):
    try:
        ref, _ = D.read(lambda s: s.bundle("ward29"))
    except Exception:
        ref = None
    return views.job_estimate(length_m, ref, request.app.state.model_card.get())


@router.post("/jobs/estimate", tags=["jobs"])
def job_estimate(body: EstimateIn, request: Request, D: Data = Depends(get_data)):
    """Estimate for a stretch of this length (live while the end dots are dragged): same rule as the preview."""
    return {"offline": not D.db_online, "length_m": round(body.length_m), "estimate": _estimate(request, D, body.length_m)}


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
        if body.lines is not None:
            try:
                pick = streetpick.trim(pick, body.lines)
            except ValueError as e:
                raise HTTPException(422, str(e)) from None
        kind, inp = "street_click", {"click": {"lat": body.lat, "lon": body.lon}, **pick,
                                     "name": body.name or pick["street"]}
    else:
        raise HTTPException(422, "give {lat, lon} or {polygon}")
    inp["slug"] = _slugify(inp["name"], job_id)

    def fn(s):
        with s.pool.connection() as c:
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
            where = "where j.status in ('queued', 'running')" if active else ""
            return [_job(r) for r in c.execute(f"select {JOB_COLS} from jobs j left join areas a on a.id = j.area_id "
                                               f"{where} order by j.created_at desc limit %s", (max(1, min(limit, 200)),))]
    jobs, off = D.read(fn)
    return {"offline": off, "jobs": jobs, "worker_online": worker_online(request.app)}


class ClearIn(BaseModel):
    dry_run: bool = Field(True, description="true: only list what would be removed")
    ids: Optional[List[str]] = Field(None, description="remove only these (from the dry run the person confirmed)")


@router.post("/jobs/clear-test", tags=["jobs"])
def job_clear_test(body: ClearIn, D: Data = Depends(get_data)):
    """Remove test jobs: cancelled before any worker started them, or made by automated tests, and ended without a result.
    Done, queued and running jobs and real worker failures are never removed. Call with dry_run first; send the listed
    ids back to remove exactly what was confirmed."""
    def fn(s):
        with s.pool.connection() as c:
            ids = [str(r[0]) for r in c.execute(TEST_JOB_SQL)]
            if body.ids is not None:
                ids = [i for i in ids if i in set(body.ids)]
            jobs = [_get_job(c, i) for i in ids]
            if not body.dry_run and ids:
                c.execute("delete from jobs where id = any(%s::uuid[])", (ids,))
            return jobs
    jobs = D.write(fn)
    return {"offline": False, "dry_run": body.dry_run, "removed": [] if body.dry_run else [j["id"] for j in jobs], "jobs": jobs}


@router.get("/jobs/{job_id}", tags=["jobs"])
def job_get(job_id: str, request: Request, D: Data = Depends(get_data)):
    """One job, with the estimate for its street length (same rule as the confirm sheet; an estimate, not a measurement)."""
    def fn(s):
        with s.pool.connection() as c:
            return _get_job(c, job_id)
    job = D.write(fn)
    length = (job["input"] or {}).get("length_m")
    return {"offline": False, "job": job, "worker_online": worker_online(request.app),
            "estimate": _estimate(request, D, length) if length else None}


@router.post("/jobs/{job_id}/cancel", tags=["jobs"])
def job_cancel(job_id: str, request: Request, D: Data = Depends(get_data)):
    """Cancel a job that has not finished (status → failed, message "cancelled by user"); workers never claim it again."""
    def fn(s):
        with s.pool.connection() as c:
            j = _get_job(c, job_id)
            if j["status"] not in ("queued", "running", "expired_token"):
                raise HTTPException(409, f"job is already {j['status']}")
            c.execute("update jobs set status = 'failed', message = %s, finished_at = now() where id = %s",
                      (CANCELLED, job_id))
            return _get_job(c, job_id)
    return {"offline": False, "job": D.write(fn), "worker_online": worker_online(request.app)}


# ------------------------------------------------------------------------------------------------ worker
def worker_auth(request: Request, x_worker_token: str = Header("", alias="X-Worker-Token")):
    expected = request.app.state.settings.worker_token
    if not expected:
        raise HTTPException(503, "WORKER_TOKEN is not configured on the backend")
    if not hmac.compare_digest(x_worker_token.encode(), expected.encode()):
        raise HTTPException(401, "bad worker token")


class NextIn(BaseModel):
    worker_id: str = Field(min_length=1, max_length=80)


class ProgressIn(BaseModel):
    job: str
    stage: str = Field(max_length=40)
    done: Optional[int] = None
    total: Optional[int] = None
    message: Optional[str] = Field(None, max_length=500)
    worker_id: Optional[str] = Field(None, max_length=80)


class HeartbeatIn(BaseModel):
    worker_id: str = Field(min_length=1, max_length=80)
    job: Optional[str] = None


class FailIn(BaseModel):
    job: str
    code: str = Field(max_length=40)
    message: Optional[str] = Field(None, max_length=2000)


def _seen(request, worker_id):
    if worker_id:
        request.app.state.workers[worker_id] = time.monotonic()


@router.post("/worker/next", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_next(body: NextIn, request: Request, D: Data = Depends(get_data)):
    """Claim the oldest claimable job: queued, expired_token (keys refreshed → resume), or running with a stale heartbeat."""
    _seen(request, body.worker_id)

    def fn(s):
        with s.pool.connection() as c:
            r = c.execute(f"""update jobs set status = 'running', started_at = coalesce(started_at, now()), heartbeat_at = now(),
                                     worker_id = %s, message = null
                              where id = (select id from jobs where status in ('queued', 'expired_token')
                                             or (status = 'running' and (heartbeat_at is null
                                                 or heartbeat_at < now() - interval '{STALE_RUNNING}'))
                                          order by created_at limit 1 for update skip locked)
                              returning id""", (body.worker_id,)).fetchone()
            return _get_job(c, str(r[0])) if r else None
    return {"offline": False, "job": D.write(fn)}


@router.post("/worker/heartbeat", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_heartbeat(body: HeartbeatIn, request: Request, D: Data = Depends(get_data)):
    _seen(request, body.worker_id)
    if body.job:
        def fn(s):
            with s.pool.connection() as c:
                c.execute("update jobs set heartbeat_at = now() where id = %s and status = 'running'", (body.job,))
        D.write(fn)
    return {"offline": False, "ok": True}


@router.post("/worker/progress", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_progress(body: ProgressIn, request: Request, D: Data = Depends(get_data)):
    _seen(request, body.worker_id)

    def fn(s):
        with s.pool.connection() as c:
            _get_job(c, body.job)
            c.execute("""update jobs set stage = %s, done = %s, total = %s, message = coalesce(%s, message), heartbeat_at = now()
                         where id = %s and status = 'running'""",
                      (body.stage, body.done, body.total, body.message, body.job))
            return _get_job(c, body.job)
    return {"offline": False, "job": D.write(fn)}


@router.post("/worker/fail", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_fail(body: FailIn, D: Data = Depends(get_data)):
    """NO_STREET_VIEW / NO_STREETS / NO_CAMERAS → no_street_view; AWS_TOKEN_EXPIRED → expired_token; else failed."""
    status = FAIL_CODES.get(body.code.upper(), "failed")

    def fn(s):
        with s.pool.connection() as c:
            _get_job(c, body.job)
            c.execute("""update jobs set status = %s, message = %s, finished_at = case when %s = 'expired_token' then null
                         else now() end, heartbeat_at = now() where id = %s""", (status, body.message, status, body.job))
            return _get_job(c, body.job)
    return {"offline": False, "job": D.write(fn)}


@router.post("/worker/result", tags=["worker"], dependencies=[Depends(worker_auth)])
def worker_result(request: Request, job: str = Form(...), files: List[UploadFile] = File(...), D: Data = Depends(get_data)):
    """Upload export.json + run JSONs → saved to data/areas/<slug>/, run_report built, area loaded into the DB."""
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
        if j["status"] != "running":
            raise HTTPException(409, f"job is {j['status']}" + (f" ({j['message']})" if j.get("message") else ""))
        slug = j["input"].get("slug") or _slugify(j["street"], j["id"])
        folder = os.path.join(settings.areas_dir, slug)
        tmp = folder + f".upload-{uuid.uuid4().hex[:6]}"
        os.makedirs(tmp)
        try:
            for name, data in blobs.items():
                with open(os.path.join(tmp, name), "wb") as fh:
                    fh.write(data)
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
                         message = null where id = %s""", (res["area_id"], j["id"]))
            out = _get_job(c, j["id"])
        s.invalidate(slug)
        return out
    return {"offline": False, "job": D.write(fn)}
