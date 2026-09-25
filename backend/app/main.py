"""GEO-CASCADIA API (CLAUDE.md §7).

Start (from the repo root):
    backend\\.venv\\Scripts\\python -m uvicorn app.main:app --app-dir backend --port 8000
Swagger: http://localhost:8000/docs

Every JSON response carries `"offline": true|false` — true when the DB is unreachable and data comes read-only from
data/areas/*.json (docs/DECISIONS.md D4).
"""
import json
import os
import sys
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .settings import ROOT, Settings

sys.path.insert(0, os.path.join(ROOT, "pipeline"))   # geo_cascadia (import only — never modified)

from . import views  # noqa: E402
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
    text: str = Field(min_length=2, max_length=300,
                      examples=["Show commercial buildings with more than two visible floors that do not have a matching property record"])


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="GEO-CASCADIA API", version="0.2.0",
                  description="Street View asset & property intelligence. Registers are SYNTHETIC demo data. "
                              "Every response carries `offline` (true = read-only JSON fallback).")
    app.state.settings = settings
    app.state.data = Data(settings)
    app.state.model_card = ModelCard(os.path.join(settings.data_dir, "model_card.json"))
    app.state.workers = {}
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
                "worker_online": worker_online(app)}

    @app.get("/config/public", tags=["meta"])
    def config_public(D: Data = Depends(get_data)):
        """Browser-safe config: the referrer-restricted Maps JS key + Map ID. Never a server key."""
        return {"maps_js_key": settings.maps_browser_key, "map_id": settings.map_id, "offline": not D.db_online}

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
            return {"area": area, "building": rec, "review_item": item}
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

    # ------------------------------------------------------------ query
    @app.post("/query", tags=["query"])
    def query(body: QueryIn, D: Data = Depends(get_data)):
        """Plain-English query via pipeline `workspace.QueryEngine` (inputs rebuilt from the export records)."""
        res, off = D.read(lambda s: views.run_query(need(s, body.area), body.text))
        return {"offline": off, "area": body.area, **res}

    from .jobs import router as jobs_router
    from .review import router as review_router
    app.include_router(review_router)
    app.include_router(jobs_router)
    return app


app = create_app()
