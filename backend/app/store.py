"""Data access with an offline fallback (docs/DECISIONS.md D4).

Both stores build the same per-area *bundle* (export.json shape + live review state):
  DbStore   — Supabase Postgres/PostGIS (records come from the `record` jsonb columns, review state from review_items)
  JsonStore — data/areas/<slug>/*.json, read-only
`Data.read(fn)` runs fn on the DB store and falls back to the JSON store when the DB is unreachable; the caller gets
`offline=True` so every response can say so. Writes never fall back: they raise OfflineError (HTTP 503).
"""
import json
import logging
import os
import re
import threading
import time

from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.ops import unary_union

from . import loader
from .db import DbUnavailable, Pool
from .streetgeo import gap_display, named_streets

log = logging.getLogger("geo_cascadia.data")

LAYER_TABLES = {  # layer -> (table, key column, geometry expression)
    "buildings": ("buildings", "id", "coalesce(footprint, geom)"),
    "assets": ("assets", "id", "geom"),
    "gaps": ("streetlight_gaps", "id", "geom"),
    "unmapped": ("unmapped_businesses", "id", "geom"),
    "missing": ("missing_asset_records", "asset_no", "geom"),
    "streets": ("streets", "name", "geom"),
}
REVIEW_KEYS = ("id", "item_type", "ref_id", "building_id", "asset_cls", "street", "lat", "lon", "priority", "reasons",
               "discrepancies", "status", "reviewer", "note", "appeal_photo_path", "updated_at")


class OfflineError(RuntimeError):
    """A write was attempted while the database is unavailable."""


def _round_coords(g, nd=7):
    if isinstance(g, (list, tuple)):
        return [_round_coords(x, nd) for x in g] if g and isinstance(g[0], (list, tuple)) else [round(x, nd) for x in g]
    return g


def _geojson(geom):
    m = mapping(geom)
    return {"type": m["type"], "coordinates": _round_coords(m["coordinates"])}


def review_item(**kw):
    return {k: kw.get(k) for k in REVIEW_KEYS}


VERSION_TAG = re.compile(r"\s*\((?:v|version\s*)\d+(?:\.\d+)*\)\s*$", re.I)


def display_area_name(name):
    """D36: internal version tags are not part of a place's name ("Ward 29, Coimbatore (v2)" -> "Ward 29, Coimbatore")."""
    return VERSION_TAG.sub("", name).strip() if isinstance(name, str) else name


def assemble(slug, name, polygon_source, polygon, bbox, meta, dashboard, run_report, streets, buildings, assets, gaps,
             unmapped, missing, queue, gap_disp, source):
    """Common bundle. Applies live review state from `queue` onto the building/asset records."""
    by_ref = {(q["item_type"], q["ref_id"]): q for q in queue}
    for kind, recs in (("building", buildings), ("asset", assets)):
        for r in recs:
            q = by_ref.get((kind, r["id"]))
            rv = dict(r.get("review") or {})
            rv["status"] = q["status"] if q else None
            if kind == "building":
                rv["appeal_note"] = q["note"] if q and q["status"] == "appealed" else rv.get("appeal_note")
                rv["appeal_photo_path"] = q["appeal_photo_path"] if q else rv.get("appeal_photo_path")
            r["review"] = rv
    return {"slug": slug, "name": display_area_name(name), "polygon_source": polygon_source, "polygon": polygon, "bbox": bbox,
            "meta": meta, "dashboard_stored": dashboard, "run_report": run_report, "streets": streets,
            "buildings": buildings, "assets": assets, "streetlight_gaps": gaps, "unmapped_businesses": unmapped,
            "missing_asset_records": missing, "review_queue": queue, "gap_display": gap_disp or {}, "source": source}


def _feature_geom(layer, rec):
    """Shapely geometry of a bundle record (JSON-mode bbox filter; mirrors LAYER_TABLES)."""
    if layer == "buildings":
        ring = (rec.get("footprint") or {}).get("polygon_latlon") or []
        return Polygon([(p[1], p[0]) for p in ring]) if len(ring) >= 4 else Point(rec["lon"], rec["lat"])
    if layer == "gaps":
        return LineString([rec["start"][::-1], rec["end"][::-1]])
    if layer == "streets":
        return shape(rec["geometry"]) if rec.get("geometry") else None
    return Point(rec["lon"], rec["lat"])


LAYER_RECORDS = {"buildings": ("buildings", "id"), "assets": ("assets", "id"), "gaps": ("streetlight_gaps", "id"),
                 "unmapped": ("unmapped_businesses", "id"), "missing": ("missing_asset_records", "asset_no"),
                 "streets": ("streets", "name")}


class JsonStore:
    source = "json"

    def __init__(self, areas_dir):
        self.dir = areas_dir
        self._cache, self._lock = {}, threading.Lock()

    def slugs(self):
        if not os.path.isdir(self.dir):
            return []
        return sorted(d for d in os.listdir(self.dir) if ".upload-" not in d     # a worker upload being unpacked (P6)
                      and os.path.isfile(os.path.join(self.dir, d, "export.json")))

    def bundle(self, slug):
        folder = os.path.join(self.dir, slug)
        path = os.path.join(folder, "export.json")
        if not os.path.isfile(path):
            return None
        stamp = os.path.getmtime(path)
        with self._lock:
            hit = self._cache.get(slug)
            if hit and hit[0] == stamp:
                return hit[1]
        exp = loader._read(path)
        rr_path = os.path.join(folder, "run_report.json")
        rr = loader._read(rr_path) if os.path.exists(rr_path) else None
        raw_streets, names, plan = loader.read_street_inputs(folder)
        named = named_streets(raw_streets, names)          # display name + osm_name, same as the loader (D13)
        poly, poly_src = loader.area_polygon(exp, raw_streets)
        B, A, U = exp.get("buildings", []), exp.get("assets", []), exp.get("unmapped_businesses") or []
        bb = unary_union([poly] + [Point(o["lon"], o["lat"]) for o in B + A + U]).bounds  # same rule as the loader
        streets = []
        for s in named:
            g = loader._street_lines(s)
            streets.append({"name": s["name"], "osm_name": s["osm_name"], "length_m": s.get("length_m"), "road_type": s.get("type"),
                            "kind": s.get("kind"), "panos": s.get("panos"), "coverage": s.get("coverage"),
                            "way_ids": s.get("way_ids") or [], "geometry": _geojson(g) if g else None})
        asset_by_key = {(round(a["lat"], 7), round(a["lon"], 7), a["type"]): a["id"] for a in A}
        queue = []
        for q in exp.get("review_queue", []):
            ref = q.get("building_id") if q["item_type"] == "building" else \
                asset_by_key.get((round(q["lat"], 7), round(q["lon"], 7), q.get("asset_cls")))
            if ref:
                queue.append(review_item(item_type=q["item_type"], ref_id=ref, building_id=q.get("building_id"),
                                         asset_cls=q.get("asset_cls"), street=q.get("street"), lat=q["lat"], lon=q["lon"],
                                         priority=q.get("priority"), reasons=q.get("reasons") or [],
                                         discrepancies=q.get("discrepancies") or [], status=q.get("status") or "pending",
                                         appeal_photo_path=q.get("appeal_photo_path")))
        b = assemble(slug, exp["meta"].get("area") or slug, poly_src, _geojson(poly), [round(x, 7) for x in bb],
                     exp["meta"], exp.get("dashboard") or {}, rr, streets, B, A, exp.get("streetlight_gaps", []), U,
                     exp.get("missing_asset_records", []), queue, gap_display(exp, named, plan, names), "json")
        b["live"] = os.path.isfile(os.path.join(folder, "live_run.json"))    # P6: analysed from the app, a fresh run
        with self._lock:
            self._cache[slug] = (stamp, b)
        return b

    def ids_in_bbox(self, bundle, layer, bb):
        env = box(*bb)
        coll, key = LAYER_RECORDS[layer]
        out = set()
        for r in bundle[coll]:
            g = _feature_geom(layer, r)
            if g is not None and g.intersects(env):
                out.add(r[key])
        return out


class DbStore:
    source = "db"

    def __init__(self, pool, version_check_s=20.0):   # writes in this process invalidate at once; external reloads show within 20 s
        self.pool, self.version_check_s = pool, version_check_s
        self._cache, self._lock = {}, threading.Lock()   # slug -> (version, checked_at, bundle)

    def invalidate(self, slug=None):
        with self._lock:
            if slug:
                self._cache.pop(slug, None)
            else:
                self._cache.clear()

    def slugs(self):
        with self.pool.connection() as c:
            return [r[0] for r in c.execute("select slug from areas order by slug")]

    def patch_review(self, slug, item, version):
        """Apply one review decision to the cached bundle in place (review fix 12: no full reload after each write).
        `item` = the updated review_items row as a dict; `version` = the area's version after the write (_version shape)."""
        with self._lock:
            hit = self._cache.get(slug)
        if not hit:
            return None
        b = hit[2]
        q = next((x for x in b["review_queue"] if x["id"] == item["id"]), None)
        if q is None:
            self.invalidate(slug)
            return None
        q.update({k: item[k] for k in ("status", "reviewer", "note", "appeal_photo_path", "updated_at")})
        recs = b["buildings"] if q["item_type"] == "building" else b["assets"]
        r = next((x for x in recs if x["id"] == q["ref_id"]), None)
        if r is not None:
            rv = dict(r.get("review") or {})
            rv["status"] = q["status"]
            if q["item_type"] == "building":
                rv["appeal_note"] = q["note"] if q["status"] == "appealed" else rv.get("appeal_note")
                rv["appeal_photo_path"] = q["appeal_photo_path"]
            r["review"] = rv
        b.pop("_qe", None)                                   # QueryEngine inputs carry review_status
        with self._lock:
            self._cache[slug] = (version, time.monotonic(), b)
        return b

    def _version(self, c, slug):
        return c.execute("""select a.id, a.updated_at, (select max(updated_at) from review_items r where r.area_id = a.id),
                                   (select count(*) from review_items r where r.area_id = a.id)
                            from areas a where slug = %s""", (slug,)).fetchone()

    def bundle(self, slug):
        now = time.monotonic()
        with self._lock:
            hit = self._cache.get(slug)
        if hit and now - hit[1] < self.version_check_s:
            return hit[2]
        with self.pool.connection() as c:
            ver = self._version(c, slug)
            if ver is None:
                return None
            if hit and hit[0] == ver:
                with self._lock:
                    self._cache[slug] = (ver, now, hit[2])
                return hit[2]
            b = self._load(c, ver[0], slug)
        with self._lock:
            self._cache[slug] = (ver, now, b)
        return b

    def _load(self, c, area_id, slug):
        a = c.execute("""select name, polygon_source, ST_AsGeoJSON(polygon, 7)::json,
                                array[ST_XMin(bbox), ST_YMin(bbox), ST_XMax(bbox), ST_YMax(bbox)], meta, dashboard, run_report,
                                source_job_id is not null
                         from areas where id = %s""", (area_id,)).fetchone()
        recs = lambda t: [r[0] for r in c.execute(f"select record from {t} where area_id = %s order by ord nulls last, id",
                                                   (area_id,))]
        B, A, G, U = recs("buildings"), recs("assets"), recs("streetlight_gaps"), recs("unmapped_businesses")
        GD = {r[0]: r[1] for r in c.execute("select id, display from streetlight_gaps where area_id = %s and display is not null",
                                            (area_id,))}
        M = [{"asset_no": r[0], "lat": r[1], "lon": r[2], "street": r[3], "why": r[4]} for r in c.execute(
            "select asset_no, ST_Y(geom), ST_X(geom), street, why from missing_asset_records where area_id = %s "
            "order by ord nulls last, asset_no", (area_id,))]
        S = [{"name": r[0], "osm_name": r[8], "length_m": r[1], "road_type": r[2], "kind": r[3], "panos": r[4], "coverage": r[5],
              "way_ids": list(r[6] or []), "geometry": r[7]} for r in c.execute(
            "select name, length_m, road_type, kind, panos, coverage, way_ids, ST_AsGeoJSON(geom, 7)::json, osm_name from streets "
            "where area_id = %s order by ord nulls last, name", (area_id,))]
        asset_type = {x["id"]: x["type"] for x in A}
        Q = [review_item(id=r[0], item_type=r[1], ref_id=r[2], building_id=r[2] if r[1] == "building" else None,
                         asset_cls=asset_type.get(r[2]) if r[1] == "asset" else None, street=r[3], lat=r[4], lon=r[5],
                         priority=r[6], reasons=list(r[7] or []), discrepancies=list(r[8] or []), status=r[9],
                         reviewer=r[10], note=r[11], appeal_photo_path=r[12],
                         updated_at=r[13].isoformat() if r[13] else None)
             for r in c.execute("""select id, item_type, ref_id, street, ST_Y(geom), ST_X(geom), priority, reasons, discrepancies,
                                          status, reviewer, note, appeal_photo_url, updated_at
                                   from review_items where area_id = %s order by ord nulls last, id""", (area_id,))]
        b = assemble(slug, a[0], a[1], a[2], [round(x, 7) for x in a[3]], a[4], a[5], a[6], S, B, A, G, U, M, Q, GD, "db")
        b["live"] = bool(a[7])                                # P6: made by a worker job (a fresh, non-resumed run)
        return b

    def ids_in_bbox(self, bundle, layer, bb):
        table, key, geom = LAYER_TABLES[layer]
        with self.pool.connection() as c:
            return {r[0] for r in c.execute(
                f"select t.{key} from {table} t join areas a on a.id = t.area_id "
                f"where a.slug = %s and ST_Intersects({geom}, ST_MakeEnvelope(%s, %s, %s, %s, 4326))",
                (bundle["slug"], *bb))}


class Data:
    """Chooses the store per request. After a DB failure, serves JSON for `offline_retry_s`, then tries the DB again."""

    def __init__(self, settings):
        self.settings = settings
        self.json = JsonStore(settings.areas_dir)
        self.pool = Pool(settings.database_url) if settings.database_url else None
        self.db = DbStore(self.pool) if self.pool else None
        self.offline_until, self.last_error = 0.0, None if self.pool else "DATABASE_URL not set"

    @property
    def db_online(self):
        return self.db is not None and time.monotonic() >= self.offline_until

    def mark_offline(self, err):
        self.offline_until = time.monotonic() + self.settings.offline_retry_s
        self.last_error = str(err) or type(err).__name__
        log.warning("database unavailable - %s - serving the offline JSON copy (read-only) for %.0f s, then retrying",
                    getattr(err, "reason", self.last_error), self.settings.offline_retry_s)

    def _db(self, fn):
        """fn on the DB. A failure on a reused idle connection (the Supabase pooler closes idle connections) is retried
        once, quietly, on a fresh connection before anything is marked offline (review fix 4)."""
        try:
            return fn(self.db)
        except DbUnavailable as e:
            if not e.stale:
                raise
            log.info("database: %s - reconnecting and retrying once", e.reason)
            self.pool.close()
            return fn(self.db)

    def read(self, fn):
        """Returns (result, offline)."""
        if self.db_online:
            try:
                res = self._db(fn)
                if self.last_error:
                    log.info("database back online")
                self.last_error = None
                return res, False
            except DbUnavailable as e:
                self.mark_offline(e)
        return fn(self.json), True

    def write(self, fn):
        if not self.db_online:
            raise OfflineError("offline data mode — read only")
        try:
            return self._db(fn)
        except DbUnavailable as e:
            self.mark_offline(e)
            raise OfflineError("offline data mode — read only") from None

    def probe(self):
        """Health check: try the DB now (ignores the retry window)."""
        if self.db is None:
            return False
        try:
            with self.pool.connection() as c:
                c.execute("select 1")
            self.offline_until, self.last_error = 0.0, None
            return True
        except DbUnavailable as e:
            self.mark_offline(e)
            return False

    def close(self):
        if self.pool:
            self.pool.close()
