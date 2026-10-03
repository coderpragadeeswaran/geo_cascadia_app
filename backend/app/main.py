"""GEO-CASCADIA API (CLAUDE.md §7).

Start (from the repo root):
    backend\\.venv\\Scripts\\python -m uvicorn app.main:app --app-dir backend --port 8000
Swagger: http://localhost:8000/docs

Every JSON response carries `"offline": true|false` — true when the DB is unreachable and data comes read-only from
data/areas/*.json (docs/DECISIONS.md D4).
"""
import re
import json
import logging
import os
import sys
import time
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .settings import ROOT, Settings

sys.path.insert(0, os.path.join(ROOT, "pipeline"))   # geo_cascadia (import only — never modified)

from . import drive, evidence, frontwall, gaps, gate1pos, hood, imagery, loader, mapdata, minimap, namepick, registertest, spatial, trust, views  # noqa: E402
from . import streetpick as streetpick_mod  # noqa: E402
from .storage import StorageError  # noqa: E402
from .store import Data, OfflineError  # noqa: E402

LAYERS = ("buildings", "assets", "gaps", "unmapped", "missing", "streets")


def get_data(request: Request) -> Data:
    return request.app.state.data


def need(store, slug):
    b = store.bundle(slug)
    if b is None:
        raise HTTPException(404, f"area {slug!r} not found")
    return b


class ModelCard:
    def __init__(self, path):
        self.path, self._stamp, self._data = path, None, None

    def get(self):
        if not os.path.exists(self.path):
            return None
        stamp = os.path.getmtime(self.path)
        if stamp != self._stamp:
            with open(self.path, encoding="utf-8") as f:
                self._data, self._stamp = json.load(f), stamp
        return self._data


class QueryIn(BaseModel):
    area: str = Field(examples=["ward29"])
    text: Optional[str] = Field(None, min_length=2, max_length=300,
                                examples=["Show commercial buildings with more than two visible floors that do not have a matching property record"])
    filters: Optional[dict] = Field(None, description="edited filter chips (parsed_filters shape) instead of text")
    scope_street: Optional[str] = Field(None, description="the street selected in the app; a typed question that names "
                                        "no street is answered on it (shown as a Street chip)")


def _log_setup():
    """Data-mode changes (offline fallback + its reason, reconnects) go to the API console next to uvicorn's lines."""
    lg = logging.getLogger("geo_cascadia")
    if not lg.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", "%H:%M:%S"))
        lg.addHandler(h)
        lg.setLevel(logging.INFO)
        lg.propagate = False


class ServerErrorsAsJson:
    """An unhandled error becomes a JSON 500 INSIDE the CORS middleware. Starlette answers it in its outermost layer,
    without CORS headers, so the browser saw a failed fetch and the app said "API not reachable" for a server bug.
    The detail names only the error class (a message can hold a request URL with a key); the traceback goes to the
    API console."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False

        async def send_(msg):
            nonlocal started
            started = started or msg["type"] == "http.response.start"
            await send(msg)
        try:
            await self.app(scope, receive, send_)
        except Exception as exc:
            if started:
                raise
            logging.getLogger("geo_cascadia").exception("server error on %s %s", scope.get("method"), scope.get("path"))
            await JSONResponse({"detail": f"server error ({type(exc).__name__})", "server_error": True},
                               status_code=500)(scope, receive, send)


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings()
    _log_setup()
    app = FastAPI(title="GEO-CASCADIA API", version="0.2.0",
                  description="Street View asset & property intelligence. Registers are SYNTHETIC demo data. "
                              "Every response carries `offline` (true = read-only JSON fallback).")
    app.state.settings = settings
    app.state.data = Data(settings)
    app.state.model_card = ModelCard(os.path.join(settings.data_dir, "model_card.json"))
    app.state.detections = evidence.Detections(settings.areas_dir)
    app.state.plans = drive.Plans(settings.areas_dir)
    app.state.gapcalc = gaps.GapCalc(settings.areas_dir)
    app.state.runfiles = hood.RunFiles(settings.areas_dir)
    app.state.gate1rows = gate1pos.EvalRows(settings.areas_dir)
    app.state.workers = {}
    # D53: local OpenStreetMap + Microsoft footprints for the covered cities (street click, mini-maps, cost planner)
    mapdata.configure(app.state.data.pool if settings.local_map_data else None)
    import geo_cascadia.area as pipeline_area
    pipeline_area.MAP_SOURCE = (mapdata.pipeline_source(os.path.join(settings.data_dir, "cache", "streetpick"))
                                if settings.local_map_data else None)
    app.add_middleware(ServerErrorsAsJson)          # added first = innermost: its 500 still passes through CORS
    app.add_middleware(GZipMiddleware, minimum_size=2000)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(OfflineError)
    def _offline(_, exc):
        return JSONResponse({"detail": str(exc), "offline": True}, status_code=503)

    @app.exception_handler(StorageError)
    def _storage(_, exc):
        return JSONResponse({"detail": str(exc), "offline": False}, status_code=502)

    @app.on_event("startup")
    def _warm():
        """Load area bundles in the background so the first map request is fast (falls back to JSON if the DB is down)."""
        import threading
        D = app.state.data
        threading.Thread(target=lambda: D.read(lambda s: [s.bundle(x) for x in s.slugs()]), daemon=True).start()

    @app.on_event("shutdown")
    def _close():
        app.state.data.close()

    mc = lambda: app.state.model_card.get()

    # ------------------------------------------------------------ meta
    @app.get("/health", tags=["meta"])
    def health(D: Data = Depends(get_data)):
        from .jobs import worker_online
        online = D.probe()
        return {"ok": True, "offline": not online, "db_error": D.last_error, "configured": settings.describe(),
                "worker_online": worker_online(app), "map_servers": streetpick_mod.mirror_health()}

    @app.get("/config/public", tags=["meta"])
    def config_public(D: Data = Depends(get_data)):
        """Browser-safe config: the referrer-restricted Maps JS key + Map ID. Never a server key."""
        return {"maps_js_key": settings.maps_browser_key, "map_id": settings.map_id, "offline": not D.db_online}

    @app.get("/mapdata", tags=["meta"])
    def map_data_status():
        """D53: the cities whose OpenStreetMap roads / buildings and Microsoft footprints are held locally (PostGIS), with
        their snapshot dates and the attribution to show. Outside them the app asks OpenStreetMap's servers (30-day cache)."""
        return {"offline": False, **mapdata.status()}

    @app.get("/model-card", tags=["meta"])
    def model_card(D: Data = Depends(get_data)):
        card = mc()
        if card is None:
            raise HTTPException(404, "data/model_card.json not found")
        return {**card, "offline": not D.db_online}

    # ------------------------------------------------------------ areas
    @app.get("/areas", tags=["areas"])
    def list_areas(D: Data = Depends(get_data)):
        res, off = D.read(lambda s: [views.area_card(b) for b in (s.bundle(x) for x in s.slugs()) if b])
        return {"offline": off, "areas": res}

    @app.get("/areas/{slug}", tags=["areas"])
    def area(slug: str, D: Data = Depends(get_data)):
        """meta + dashboard (recomputed from records) + run_report + computed summary + consistency list + cost (D1)."""
        res, off = D.read(lambda s: views.area_detail(need(s, slug), mc()))
        return {"offline": off, **res}

    @app.delete("/areas/{slug}", tags=["areas"])
    def area_delete(slug: str, confirm: str = Query(..., description="must repeat the slug"), D: Data = Depends(get_data)):
        """Delete an area analysed from the app (demo cleanup): its database rows (review items included), its job and its
        folder. The original areas are never deleted. `confirm` must repeat the slug. Review history rows stay (append-only)."""
        from .jobs import ORIGINAL_AREAS
        if confirm != slug:
            raise HTTPException(422, "confirm must repeat the area slug")
        if slug in ORIGINAL_AREAS:
            raise HTTPException(403, "the original areas can't be deleted")

        from .jobs import delete_area
        D.write(lambda s: delete_area(s, settings, slug))
        D.json._cache.pop(slug, None)
        return {"offline": False, "deleted": slug}

    @app.get("/areas/{slug}/geojson", tags=["areas"])
    def area_geojson(slug: str, layers: str = Query("buildings,assets,gaps,unmapped", description=f"any of {', '.join(LAYERS)}"),
                     bbox: Optional[str] = Query(None, description="minLon,minLat,maxLon,maxLat"), D: Data = Depends(get_data)):
        L = [x.strip() for x in layers.split(",") if x.strip()]
        bad = [x for x in L if x not in LAYERS]
        if bad:
            raise HTTPException(422, f"unknown layer(s) {bad}; use {list(LAYERS)}")
        bb = None
        if bbox:
            try:
                bb = [float(x) for x in bbox.split(",")]
                assert len(bb) == 4 and bb[0] < bb[2] and bb[1] < bb[3]
            except (ValueError, AssertionError):
                raise HTTPException(422, "bbox must be minLon,minLat,maxLon,maxLat") from None

        def fn(s):
            b = need(s, slug)
            keep = {x: s.ids_in_bbox(b, x, bb) for x in L} if bb else None
            return views.features(b, L, keep)

        feats, off = D.read(fn)
        return {"type": "FeatureCollection", "features": feats, "offline": off}

    @app.get("/areas/{slug}/camera-buildings", tags=["areas"])
    def camera_buildings(slug: str):
        """P7.3: buildings found only by the camera — box rays from several cameras crossing where OpenStreetMap has no
        building outline (the pipeline's building_positions.json "no_footprint"). Not analysed as buildings (no register
        check); shown as a map layer. Read from the run's files, so it works with or without the database."""
        if not re.fullmatch(r"[a-z0-9_]+", slug):
            raise HTTPException(404, "unknown area")
        path = os.path.join(settings.areas_dir, slug, "building_positions.json")
        if not os.path.isdir(os.path.join(settings.areas_dir, slug)):
            raise HTTPException(404, f"area {slug!r} not found")
        try:
            with open(path, encoding="utf-8") as f:
                bp = json.load(f)
        except (OSError, ValueError):
            return {"offline": False, "available": False, "points": [], "count": 0, "stats": None}
        pts = [{"id": f"cb-{i + 1:03d}", "lat": q["lat"], "lon": q["lon"], "method": q.get("method"), "from": q.get("from"),
                "n_cameras": q.get("n_cameras"), "uncertainty_m": q.get("uncertainty_m"), "approximate": q.get("approximate")}
               for i, q in enumerate(bp.get("no_footprint") or []) if q.get("lat") is not None]
        return {"offline": False, "available": True, "points": pts, "count": len(pts), "stats": bp.get("no_footprint_stats"),
                "source": "building_positions.json (no_footprint): camera rays crossing with no building outline"}

    @app.get("/areas/{slug}/street-names", tags=["areas"])
    def street_names(slug: str):
        """P7.3: every name each street of the area has (OpenStreetMap, Google, the street picker's rule, the register,
        Places) with mismatches flagged, the default pick (the F2 rule), and any name a person picked to display."""
        if not re.fullmatch(r"[a-z0-9_]+", slug) or not os.path.isdir(os.path.join(settings.areas_dir, slug)):
            raise HTTPException(404, f"area {slug!r} not found")
        c = namepick.candidates(os.path.join(settings.areas_dir, slug))
        picks = namepick.read_picks(settings.data_dir).get(slug, {})
        return {"offline": False, "available": c is not None, "generated": (c or {}).get("generated"),
                "streets": (c or {}).get("streets", []), "picks": picks}

    class NamePickIn(BaseModel):
        raw: str = Field(..., description="the street's raw OpenStreetMap label (streets.json name)")
        name: Optional[str] = Field(None, description="one of the street's candidate names; null = remove the pick")

    @app.put("/areas/{slug}/street-names", tags=["areas"])
    def pick_street_name(slug: str, body: NamePickIn, D: Data = Depends(get_data)):
        """Pick the name a street is DISPLAYED with (stored in data/street_name_picks.json; source files untouched). The
        area is reloaded so the map, records and charts all use it. Needs the database (offline mode is read-only)."""
        if not re.fullmatch(r"[a-z0-9_]+", slug) or not os.path.isdir(os.path.join(settings.areas_dir, slug)):
            raise HTTPException(404, f"area {slug!r} not found")
        folder = os.path.join(settings.areas_dir, slug)
        c = namepick.candidates(folder) or {}
        row = next((r for r in c.get("streets", []) if r["raw"] == body.raw), None)
        if row is None:
            raise HTTPException(404, f"street {body.raw!r} not in this area's name list")
        allowed = {s["name"] for s in row["sources"] if s.get("name")} | {row["current"]}
        if body.name is not None and body.name not in allowed:
            raise HTTPException(422, f"pick one of the street's names: {sorted(allowed)}")
        if not D.db_online and not D.probe():
            raise OfflineError("offline data mode — read only (picking a street name needs the database)")
        before = namepick.read_picks(settings.data_dir).get(slug, {}).get(body.raw)
        namepick.save_pick(settings.data_dir, slug, body.raw, None if body.name == row["current"] else body.name)
        try:
            def fn(s):
                with s.pool.connection() as conn:
                    loader.load_area(conn, folder)
            D.write(fn)
        except Exception:
            namepick.save_pick(settings.data_dir, slug, body.raw, before)          # keep store and files in step
            raise
        D.db.invalidate(slug)
        D.json._cache.pop(slug, None)
        return {"offline": False, "picks": namepick.read_picks(settings.data_dir).get(slug, {})}

    @app.get("/areas/{slug}/buildings", tags=["buildings"])
    def buildings(slug: str, street: Optional[str] = None,
                  status: Optional[str] = Query(None, description="match status: matched | discrepancy | no_record"),
                  use: Optional[str] = Query(None, description="observed use, or not_classified"),
                  q: Optional[str] = Query(None, description="search id, street, name, Google name, OCR text"),
                  floors_status: Optional[str] = None, review_status: Optional[str] = None, severity: Optional[str] = None,
                  page: int = 1, page_size: int = 50, D: Data = Depends(get_data)):
        res, off = D.read(lambda s: views.page(views.filter_buildings(need(s, slug), street, status, use, q, floors_status,
                                                                      review_status, severity), page, page_size))
        return {"offline": off, **res}

    @app.get("/buildings/{area}/{id}", tags=["buildings"])
    def building(area: str, id: str, D: Data = Depends(get_data)):
        def fn(s):
            b = need(s, area)
            rec = next((x for x in b["buildings"] if x["id"] == id), None)
            if rec is None:
                raise HTTPException(404, f"building {id!r} not found in {area!r}")
            item = next((q for q in b["review_queue"] if q["item_type"] == "building" and q["ref_id"] == id), None)
            # Gate 1 for this building: Trust's own row; roads for the corner check from the mini-map's cache (a short
            # wait at most; without them only the analysed streets are checked, and the answer says so)
            r = minimap.roads(b, app.state.plans.get(area), os.path.join(settings.data_dir, "cache", "streetpick"),
                              deadline=time.monotonic() + 2.0)
            card = mc()
            pos = gate1pos.check(b, rec, app.state.gate1rows.get(area), r["roads"] if r["available"] else None,
                                 ((card or {}).get("gate1_position") or {}).get("target_m", 3.5), gate1pos.area_stats(card, area))
            return {"area": area, "building": rec, "review_item": item, "front_wall": frontwall.front_wall(b, rec),
                    "position_check": pos}
        res, off = D.read(fn)
        return {"offline": off, **res}

    @app.get("/areas/{slug}/assets", tags=["assets"])
    def assets(slug: str, street: Optional[str] = None, type: Optional[str] = Query(None, description="pole | streetlight"),
               status: Optional[str] = Query(None, description="register status"), confidence: Optional[str] = None,
               method: Optional[str] = None, review_status: Optional[str] = None, page: int = 1, page_size: int = 50,
               D: Data = Depends(get_data)):
        res, off = D.read(lambda s: views.page(views.filter_assets(need(s, slug), street, type, status, confidence, method,
                                                                   review_status), page, page_size))
        return {"offline": off, **res}

    @app.get("/areas/{slug}/unmapped", tags=["assets"])
    def unmapped(slug: str, D: Data = Depends(get_data)):
        """Businesses read on frontage with no building outline (approximate positions), full records."""
        res, off = D.read(lambda s: need(s, slug)["unmapped_businesses"])
        return {"offline": off, "total": len(res), "rows": res}

    @app.get("/assets/{area}/{id}", tags=["assets"])
    def asset(area: str, id: str, D: Data = Depends(get_data)):
        def fn(s):
            b = need(s, area)
            rec = next((x for x in b["assets"] if x["id"] == id), None)
            if rec is None:
                raise HTTPException(404, f"asset {id!r} not found in {area!r}")
            item = next((q for q in b["review_queue"] if q["item_type"] == "asset" and q["ref_id"] == id), None)
            return {"area": area, "asset": rec, "review_item": item}
        res, off = D.read(fn)
        return {"offline": off, **res}

    @app.get("/areas/{slug}/imagery", tags=["evidence"])
    def area_imagery(slug: str, D: Data = Depends(get_data)):
        """P8: when the photos were taken (panos.json capture month): the area's range and, per object, its photo's month,
        its newest photo's month and whether a missing / not-in-register finding rests only on photos > 3 years old."""
        res, off = D.read(lambda s: imagery.imagery(need(s, slug), app.state.runfiles.get(slug)))
        return {"offline": off, "area": slug, **res}

    @app.get("/areas/{slug}/evidence/{kind}/{obj_id}", tags=["evidence"])
    def evidence_boxes(slug: str, kind: str, obj_id: str, D: Data = Depends(get_data)):
        """Every detection box (building, pole, lamp_head, signboard + confidence) on each evidence photo of an object, with
        the object's own box marked. Asset photos are re-aimed views: boxes are projected from the same panorama's views."""
        if kind not in ("building", "asset", "unmapped"):
            raise HTTPException(422, "kind must be building, asset or unmapped")
        res, off = D.read(lambda s: evidence.evidence(app.state.detections, need(s, slug), kind, obj_id))
        if res is None:
            raise HTTPException(404, f"{kind} {obj_id!r} not found in {slug!r}")
        out = {"offline": off, "area": slug, "kind": kind, "id": obj_id, "views": res}
        if kind == "building":
            out["links"] = evidence.building_links(app.state.detections, slug, obj_id)
        return out

    @app.get("/areas/{slug}/drive", tags=["areas"])
    def drive_street(slug: str, street: str = Query(..., description="street display name"), D: Data = Depends(get_data)):
        """Drive the street: the real camera stops of one street in driving order (per merged branch, strictly increasing
        along-road distance, forward = road tangent), with dark stretches, lamps, poles, buildings and businesses placed
        by the same distance."""
        def fn(s):
            b = need(s, slug)
            return drive.drive(b, app.state.plans.get(slug), street)
        res, off = D.read(fn)
        if res is None:
            raise HTTPException(404, f"street {street!r} not found in {slug!r}")
        if not res["branches"]:
            raise HTTPException(404, f"no camera stops recorded on {street!r} (plan.json)")
        return {"offline": off, "area": slug, **res}

    @app.get("/areas/{slug}/minimap", tags=["areas"])
    def area_minimap(slug: str, D: Data = Depends(get_data)):
        """D39: context for the small plans: every road around the area (OpenStreetMap, fetched once and cached) and the
        run's camera stops. roads_available=false when OpenStreetMap could not be reached (analysed streets only)."""
        res, off = D.read(lambda s: minimap.context(need(s, slug), app.state.plans.get(slug),
                                                    os.path.join(settings.data_dir, "cache", "streetpick")))
        return {"offline": off, "area": slug, **res}

    # ------------------------------------------------------------ under the hood / trust (P5)
    @app.get("/areas/{slug}/hood", tags=["hood"])
    def area_hood(slug: str, D: Data = Depends(get_data)):
        """Under the Hood: every number of the pipeline story, computed from the records and the run's own files (`n`, with
        its source in `src`); Sankey, sign funnel, route splits, per-street table, the story with its corrections, and
        timings/cost flagged as resumed-run values (D1)."""
        res, off = D.read(lambda s: {**hood.hood(need(s, slug), app.state.runfiles.get(slug), mc()),
                                     "map_data": mapdata.area_map_data(need(s, slug), settings.areas_dir)})
        return {"offline": off, **res}

    @app.get("/areas/{slug}/hood/examples", tags=["hood"])
    def area_hood_examples(slug: str, key: str = Query(..., description=f"one of {', '.join(hood.EXAMPLE_KEYS)}"),
                           D: Data = Depends(get_data)):
        """Up to 3 real items for one step or branch of the story, each with the reason it belongs there."""
        cache = os.path.join(settings.data_dir, "cache", "streetpick")
        res, off = D.read(lambda s: hood.examples(need(s, slug), app.state.runfiles.get(slug), key,
                                                  outline_at=lambda la, lo: minimap.building_at(la, lo, cache)))
        if res is None:
            raise HTTPException(422, f"unknown example key {key!r}")
        return {"offline": off, "area": slug, "key": key, "examples": res}

    @app.get("/trust", tags=["trust"])
    def trust_page(D: Data = Depends(get_data)):
        """Trust cards and experiments: every number quotes model_card.json (`src` = its dotted path)."""
        card = mc()
        if card is None:
            raise HTTPException(404, "data/model_card.json not found")
        return {"offline": not D.db_online, "cards": trust.cards(card), "experiments": trust.experiments(card),
                "confusion_matrix": None,
                "confusion_note": "model_card.json has precision and recall per class, not a confusion matrix, so none is drawn.",
                # D45: single-camera pole error by camera distance (model_card, written by tools/pole_uncertainty.py)
                "single_camera_by_distance": card.get("single_camera_by_distance")}

    @app.get("/trust/sign-links", tags=["trust"])
    def trust_sign_links(area: str = "ward29"):
        """P7.4: the sign-linking rule and its Google-pin check (model_card.sign_links), the spot-check sample of sign moves
        (sign_spotcheck.json: photo view, box, camera, line of sight, old / new outline) and the AI first-pass verdicts
        (sign_spotcheck_ai.json, labelled as an AI visual check, not a human one)."""
        if not re.fullmatch(r"[a-z0-9_]+", area):
            raise HTTPException(404, "unknown area")
        def rd(name):
            try:
                with open(os.path.join(settings.areas_dir, area, name), encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, ValueError):
                return None
        return {"offline": False, "area": area, "model_card": (app.state.model_card.get() or {}).get("sign_links"),
                "spotcheck": rd("sign_spotcheck.json"), "ai_check": rd("sign_spotcheck_ai.json")}

    @app.get("/trust/register", tags=["trust"])
    def trust_register(D: Data = Depends(get_data)):
        """D42/D43: per area, planted-mistake recovery (caught / missed / false alarms per kind) and how often a register
        record was paired by location with its own building — computed from the records and the run's files."""
        def fn(s):
            return registertest.all_tests([b for b in (s.bundle(x) for x in s.slugs()) if b], settings.areas_dir)
        res, off = D.read(fn)
        return {"offline": off, **res}

    @app.get("/trust/consistency", tags=["trust"])
    def trust_consistency(D: Data = Depends(get_data)):
        """Every place, in every area, where a stored counter or story sentence differs from the computed count."""
        def fn(s):
            bundles = [b for b in (s.bundle(x) for x in s.slugs()) if b]
            return trust.consistency(bundles, {b["slug"]: app.state.runfiles.get(b["slug"]) for b in bundles}, mc())
        res, off = D.read(fn)
        return {"offline": off, "rows": res}

    # ------------------------------------------------------------ query
    @app.post("/query", tags=["query"])
    def query(body: QueryIn, D: Data = Depends(get_data)):
        """Plain-English query via pipeline `workspace.QueryEngine` (inputs rebuilt from the export records).
        `filters` (edited chips) are turned into canonical text that QueryEngine parses back to the same filters."""
        if bool(body.text) == bool(body.filters):
            raise HTTPException(422, "give either text or filters")
        try:
            def fn(s):
                b = need(s, body.area)
                gaps_at = lambda iv: app.state.gapcalc.get(b, iv)
                near_at = lambda m: spatial.near_dark(s, b, m)          # D53: "within N m of a possible dark stretch"
                return views.run_filters(b, body.filters, gaps_at, near_at) if body.filters \
                    else views.run_query(b, body.text, gaps_at=gaps_at, scope_street=body.scope_street, near_at=near_at)
            res, off = D.read(fn)
        except views.FilterError as e:
            raise HTTPException(422, str(e)) from None
        return {"offline": off, "area": body.area, **res}

    from .jobs import router as jobs_router
    from .review import router as review_router
    app.include_router(review_router)
    app.include_router(jobs_router)
    return app


app = create_app()
