"""Idempotent upsert of one area folder (export.json + run_report.json + streets.json) into Postgres/PostGIS.

- Re-running replaces the area's data; rows no longer in the export are deleted.
- Human review decisions survive reloads: review_items keep status/reviewer/note/appeal on conflict, and only
  *pending* items that vanished from the export are deleted.
- Area polygon: the study-area polygon when it contains ≥95% of the area's buildings and assets (Ward 29), otherwise
  the analysed streets buffered by 40 m. Recorded in areas.polygon_source.
"""
import json
import math
import os
import subprocess
import sys

from psycopg.types.json import Jsonb
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import transform, unary_union

from .derived import computed_counts, consistency
from .streetgeo import gap_display, named_streets

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STUDY_AREA = os.path.join(ROOT, "data", "study_area", "Study_area.geojson")
MODEL_CARD = os.path.join(ROOT, "data", "model_card.json")
STREET_BUFFER_M = 40


def _read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _clean(x):
    """NaN/inf are not valid JSON for Postgres jsonb."""
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_clean(v) for v in x]
    return x


def J(x):
    return Jsonb(_clean(x)) if x is not None else None


def _num(x):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else x


def ensure_run_report(folder):
    path = os.path.join(folder, "run_report.json")
    if not os.path.exists(path):
        r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_run_report.py"), folder],
                           capture_output=True, text=True, encoding="utf-8", env={**os.environ, "PYTHONUTF8": "1"})
        if r.returncode:
            raise RuntimeError(f"build_run_report failed for {folder}:\n{r.stderr[-2000:]}")
    return _read(path)


def _buffer_m(geom, metres):
    """Buffer a lon/lat geometry by metres using a local equirectangular projection."""
    c = geom.centroid
    kx, ky = 111320 * math.cos(math.radians(c.y)), 110540
    fwd = transform(lambda x, y, z=None: ((x - c.x) * kx, (y - c.y) * ky), geom)
    return transform(lambda x, y, z=None: (x / kx + c.x, y / ky + c.y), fwd.buffer(metres))


def _multi(poly):
    return poly if isinstance(poly, MultiPolygon) else MultiPolygon([poly])


def _street_lines(street):
    lines = [LineString([(p[1], p[0]) for p in line]) for line in street.get("lines_latlon") or [] if len(line) >= 2]
    return MultiLineString(lines) if lines else None


def read_street_inputs(folder):
    """streets.json, street_names.json (OSM label -> display name) and plan.json (camera stops); each may be absent."""
    opt = lambda n, d: _read(os.path.join(folder, n)) if os.path.exists(os.path.join(folder, n)) else d
    return opt("streets.json", []), opt("street_names.json", {}), opt("plan.json", None)


def area_polygon(exp, streets):
    pts = [Point(o["lon"], o["lat"]) for o in exp.get("buildings", []) + exp.get("assets", [])]
    if os.path.exists(STUDY_AREA) and pts:
        study = unary_union([shape(f["geometry"]) for f in _read(STUDY_AREA)["features"]])
        if sum(study.contains(p) for p in pts) >= 0.95 * len(pts):
            return _multi(study), "study_area"
    lines = [g for g in (_street_lines(s) for s in streets) if g is not None]
    if lines:
        return _multi(_buffer_m(unary_union(lines), STREET_BUFFER_M)), f"streets_buffer_{STREET_BUFFER_M}m"
    return _multi(_buffer_m(unary_union(pts).convex_hull, STREET_BUFFER_M)), f"points_hull_buffer_{STREET_BUFFER_M}m"


def _footprint(b):
    ring = (b.get("footprint") or {}).get("polygon_latlon") or []
    return Polygon([(p[1], p[0]) for p in ring]).wkt if len(ring) >= 4 else None


PT = "ST_SetSRID(ST_MakePoint(%s, %s), 4326)"
G = "ST_GeomFromText(%s, 4326)"


def _replace(cur, table, key_cols, cols, rows, area_id, geom_exprs=None, key_name="id"):
    """Upsert rows (list of tuples in `cols` order, area_id first) and delete this area's rows not in `rows`."""
    geom_exprs = geom_exprs or {}
    cols, rows = cols + ["ord"], [tuple(r) + (i,) for i, r in enumerate(rows)]  # keep export order
    vals = ", ".join(geom_exprs.get(c, "%s") for c in cols)
    upd = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in key_cols)
    sql = f"insert into {table} ({', '.join(cols)}) values ({vals}) on conflict ({', '.join(key_cols)}) do update set {upd}"
    flat = []
    for r in rows:
        out = []
        for c, v in zip(cols, r):
            out.extend(v if c in geom_exprs and geom_exprs[c] == PT else [v])
        flat.append(out)
    if flat:
        cur.executemany(sql, flat)
    keys = [r[cols.index(key_name)] for r in rows]
    cur.execute(f"delete from {table} where area_id = %s and not ({key_name} = any(%s))", (area_id, keys))


def load_area(conn, folder, slug=None, source_job_id=None):
    folder = os.path.abspath(folder)
    slug = slug or os.path.basename(folder.rstrip("\\/"))
    exp = _read(os.path.join(folder, "export.json"))
    rr = ensure_run_report(folder)
    streets, names, plan = read_street_inputs(folder)
    streets = named_streets(streets, names)          # name = pipeline display name, osm_name = raw OSM label (D13)
    mc = _read(MODEL_CARD) if os.path.exists(MODEL_CARD) else None
    meta, B, A = exp["meta"], exp.get("buildings", []), exp.get("assets", [])
    U, GAPS, M, Q = (exp.get("unmapped_businesses") or [], exp.get("streetlight_gaps", []),
                     exp.get("missing_asset_records", []), exp.get("review_queue", []))

    poly, poly_src = area_polygon(exp, streets)
    feats = [poly] + [Point(o["lon"], o["lat"]) for o in B + A + U]
    bbox = box(*unary_union(feats).bounds)

    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            f"""insert into areas (slug, name, polygon, polygon_source, bbox, source_job_id, meta, dashboard, run_report,
                                   computed, consistency)
                values (%s, %s, {G}, %s, {G}, %s, %s, %s, %s, %s, %s)
                on conflict (slug) do update set name = excluded.name, polygon = excluded.polygon,
                  polygon_source = excluded.polygon_source, bbox = excluded.bbox,
                  source_job_id = coalesce(excluded.source_job_id, areas.source_job_id), meta = excluded.meta,
                  dashboard = excluded.dashboard, run_report = excluded.run_report, computed = excluded.computed,
                  consistency = excluded.consistency, updated_at = now()
                returning id""",
            (slug, meta.get("area") or slug, poly.wkt, poly_src, bbox.wkt, source_job_id, J(meta),
             J(exp.get("dashboard") or {}), J(rr), J(computed_counts(exp)), J(consistency(exp, rr, mc))))
        area_id = cur.fetchone()[0]

        rows = []
        for s in streets:
            g = _street_lines(s)
            rows.append((area_id, s["name"], s["osm_name"], g.wkt if g else None, _num(s.get("length_m")), s.get("type"),
                         s.get("kind"), s.get("panos"), _num(s.get("coverage")), s.get("way_ids") or []))
        _replace(cur, "streets", ("area_id", "name"),
                 ["area_id", "name", "osm_name", "geom", "length_m", "road_type", "kind", "panos", "coverage", "way_ids"],
                 rows, area_id, {"geom": G}, key_name="name")

        rows = []
        for b in B:
            at = b.get("attributes") or {}
            use, fl, nm = at.get("use") or {}, at.get("floors") or {}, at.get("name") or {}
            rows.append((area_id, b["id"], b.get("street"), (b["lon"], b["lat"]), _footprint(b),
                         use.get("value"), use.get("route"), fl.get("value"), fl.get("status"),
                         nm.get("value"), nm.get("quality"), nm.get("route"), bool(nm.get("google_confirmed")),
                         b.get("match_status"), b.get("severity"), b.get("discrepancies") or [], b.get("reasons") or [],
                         b.get("google_flags") or [], J(at), J(b.get("register")), J(b.get("evidence")), J(b)))
        _replace(cur, "buildings", ("area_id", "id"),
                 ["area_id", "id", "street", "geom", "footprint", "use", "use_route", "floors", "floors_status", "name",
                  "name_quality", "name_route", "google_confirmed", "match_status", "severity", "discrepancies",
                  "reasons", "google_flags", "attrs", "register", "evidence", "record"],
                 rows, area_id, {"geom": PT, "footprint": G})

        rows = []
        for a in A:
            reg = a.get("register") or {}
            rows.append((area_id, a["id"], a["type"], a.get("street"), (a["lon"], a["lat"]), a.get("confidence"),
                         a.get("method"), a.get("cameras_used"), _num(a.get("uncertainty_m")), reg.get("status"),
                         reg.get("flags") or [], J(a.get("evidence")), J(a)))
        _replace(cur, "assets", ("area_id", "id"),
                 ["area_id", "id", "type", "street", "geom", "confidence", "method", "cameras_used", "uncertainty_m",
                  "register_status", "flags", "evidence", "record"],
                 rows, area_id, {"geom": PT})

        rows = [(area_id, u["id"], u.get("name"), u.get("ocr_text"), u.get("street"), (u["lon"], u["lat"]),
                 u.get("sightings"), J(u.get("evidence")), J(u)) for u in U]
        _replace(cur, "unmapped_businesses", ("area_id", "id"),
                 ["area_id", "id", "name", "ocr_text", "street", "geom", "sightings", "evidence", "record"],
                 rows, area_id, {"geom": PT})

        disp = gap_display(exp, streets, plan, names)
        rows = [(area_id, g["id"], g.get("street"), LineString([g["start"][::-1], g["end"][::-1]]).wkt,
                 _num(g.get("length_m")), g.get("interval_m"), g.get("poles_inside"), g.get("gap_type"), J(g),
                 J(disp.get(g["id"]))) for g in GAPS]
        _replace(cur, "streetlight_gaps", ("area_id", "id"),
                 ["area_id", "id", "street", "geom", "length_m", "interval_m", "poles_inside", "gap_type", "record", "display"],
                 rows, area_id, {"geom": G})

        rows = [(area_id, m["asset_no"], m.get("street"), (m["lon"], m["lat"]), m.get("why")) for m in M]
        _replace(cur, "missing_asset_records", ("area_id", "asset_no"),
                 ["area_id", "asset_no", "street", "geom", "why"], rows, area_id, {"geom": PT}, key_name="asset_no")

        # review_queue -> review_items. Asset rows have no id: join by (lat, lon rounded to 7 dp, type) (D7).
        asset_by_key = {(round(a["lat"], 7), round(a["lon"], 7), a["type"]): a["id"] for a in A}
        items, unjoined = [], 0
        for q in Q:
            if q["item_type"] == "building":
                ref = q.get("building_id")
            else:
                ref = asset_by_key.get((round(q["lat"], 7), round(q["lon"], 7), q.get("asset_cls")))
            if not ref:
                unjoined += 1
                continue
            items.append((area_id, q["item_type"], ref, q.get("street"), q["lon"], q["lat"], q.get("priority"),
                          q.get("reasons") or [], q.get("discrepancies") or [], q.get("status") or "pending", len(items)))
        if items:
            cur.executemany(
                f"""insert into review_items (area_id, item_type, ref_id, street, geom, priority, reasons, discrepancies, status, ord)
                    values (%s, %s, %s, %s, {PT}, %s, %s, %s, %s, %s)
                    on conflict (area_id, item_type, ref_id) do update set street = excluded.street, geom = excluded.geom,
                      priority = excluded.priority, reasons = excluded.reasons, discrepancies = excluded.discrepancies,
                      ord = excluded.ord""",
                items)
        keep = [f"{it[1]}:{it[2]}" for it in items]
        cur.execute("delete from review_items where area_id = %s and status = 'pending' "
                    "and not (item_type || ':' || ref_id = any(%s))", (area_id, keep))

        # review_status on objects mirrors review_items (null = not in the review queue)
        for table, kind in (("buildings", "building"), ("assets", "asset")):
            cur.execute(f"""update {table} t set review_status = r.status from review_items r
                            where r.area_id = t.area_id and r.item_type = %s and r.ref_id = t.id and t.area_id = %s""",
                        (kind, area_id))
            cur.execute(f"""update {table} t set review_status = null where t.area_id = %s and not exists
                            (select 1 from review_items r where r.area_id = t.area_id and r.item_type = %s and r.ref_id = t.id)""",
                        (area_id, kind))

    return {"slug": slug, "area_id": area_id, "polygon_source": poly_src, "review_unjoined": unjoined}


def db_counts(conn, area_id):
    q = lambda sql: conn.execute(sql, (area_id,)).fetchone()[0]
    return {
        "buildings": q("select count(*) from buildings where area_id = %s"),
        "assets": q("select count(*) from assets where area_id = %s"),
        "missing_asset_records": q("select count(*) from missing_asset_records where area_id = %s"),
        "streetlight_gaps_60m": q("select count(*) from streetlight_gaps where area_id = %s and interval_m = 60"),
        "review_items": q("select count(*) from review_items where area_id = %s"),
        "unmapped_businesses": q("select count(*) from unmapped_businesses where area_id = %s"),
        "streets": q("select count(*) from streets where area_id = %s"),
        "use_not_classified": q("select count(*) from buildings where area_id = %s and use is null"),
    }
