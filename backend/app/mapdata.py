"""Local map data (D53): OpenStreetMap + Microsoft footprints for the covered cities, from PostGIS.

tools/import_osm_local.py loads the tables (map_cities, osm_roads, osm_buildings, osm_pois, ms_buildings). Everything that
used to ask Overpass sends the same query text through `answer()` first:
- the street click (streetpick: the ~330 m road tile, the named street within 1.5 km, the roads at an unnamed road's ends),
- the mini-maps (roads around an area, the outline under a dropped camera),
- the pipeline's area stage (roads, building outlines, shop points; via geo_cascadia.area's map-source hook), both in
  the cost planner here and in the Colab worker (POST /worker/mapdata, over the tunnel).
When the query's whole box (or every point plus its radius) lies inside a covered city, the answer comes from PostGIS in
Overpass's own element format, so callers do not change. Otherwise `answer()` returns None and the caller uses Overpass
as before (streetpick keeps those answers 30 days). With the database offline, None as well.

Microsoft footprints: `ms_rings(bbox)` returns the outlines the pipeline's ms_footprints would read from the tile
(every ring whose bounding box overlaps the area's), so the pipeline's own OSM-first rule (< 8 % OSM cover) is unchanged.
"""
import json
import logging
import re
import threading
import time

log = logging.getLogger("geo_cascadia")

_POOL = None
_LOCK = threading.Lock()
_CITIES = {"t": 0.0, "rows": None}
CITIES_TTL_S = 60.0
DOWN_S = 30.0                      # after a database failure, don't ask again for this long (Overpass is used meanwhile)
_DOWN = {"until": 0.0}
M_PER_DEG = 111_320.0

NUM = r"(-?\d+(?:\.\d+)?)"
BB = rf"\({NUM},{NUM},{NUM},{NUM}\)"
AROUND = rf"\(around:{NUM},{NUM},{NUM}\)"
Q_ROADS = re.compile(rf'^\[out:json\]\[timeout:\d+\];way\["highway"\]{BB};out geom tags;$')
Q_ROADS_RE = re.compile(rf'^\[out:json\]\[timeout:\d+\];way\["highway"~"([^"]+)"\]{BB};out geom tags;$')
Q_BUILDINGS = re.compile(rf'^\[out:json\]\[timeout:\d+\];\(way\["building"\]{BB};relation\["building"\]{BB};\);out geom tags;$')
Q_POIS = re.compile(rf'^\[out:json\]\[timeout:\d+\];\(node\["shop"\]{BB};node\["amenity"\]{BB};node\["office"\]{BB};'
                    rf'way\["shop"\]{BB};way\["amenity"\]{BB};\);out center tags;$')
Q_NAMED = re.compile(rf'^\[out:json\]\[timeout:\d+\];way\["highway"\]\["name"="((?:[^"\\]|\\.)*)"\]{AROUND};out geom tags;$')
Q_ENDS = re.compile(rf'^\[out:json\]\[timeout:\d+\];\(((?:way\["highway"\]{AROUND};)+)\);out geom tags;$')
Q_OUTLINE = re.compile(rf'^\[out:json\]\[timeout:\d+\];way\["building"\]{AROUND};out geom;$')


def configure(pool):
    """the API's database pool (store.Data.pool); None = no database, always fall back to Overpass"""
    global _POOL
    _POOL = pool
    _CITIES.update(t=0.0, rows=None)


def _conn():
    if _POOL is None or time.monotonic() < _DOWN["until"]:
        return None
    return _POOL.connection()


def _query(sql, args=()):
    cm = _conn()
    if cm is None:
        return None
    try:
        with cm as c:
            return c.execute(sql, args).fetchall()
    except Exception as e:                                     # noqa: BLE001 - any DB failure: Overpass instead
        _DOWN["until"] = time.monotonic() + DOWN_S
        log.warning("local map data unavailable (%s) - using OpenStreetMap's servers for %.0f s", type(e).__name__, DOWN_S)
        return None


def cities():
    """[{city, name, box: (s, w, n, e), osm_snapshot, ms_release, counts}] - cached for a minute"""
    with _LOCK:
        if _CITIES["rows"] is not None and time.monotonic() - _CITIES["t"] < CITIES_TTL_S:
            return _CITIES["rows"]
    rows = _query("select city, name, ST_YMin(box), ST_XMin(box), ST_YMax(box), ST_XMax(box), osm_snapshot, ms_release, "
                  "counts, loaded_at, box_source from map_cities order by city")
    if rows is None:
        return _CITIES["rows"] or []
    out = [{"city": r[0], "name": r[1], "box": (r[2], r[3], r[4], r[5]),
            "osm_snapshot": r[6].isoformat() if r[6] else None, "ms_release": r[7].isoformat() if r[7] else None,
            "counts": r[8], "loaded_at": r[9].isoformat() if r[9] else None, "box_source": r[10]} for r in rows]
    with _LOCK:
        _CITIES.update(t=time.monotonic(), rows=out)
    return out


def city_for_box(s, w, n, e):
    """the covered city whose box holds the whole (s, w, n, e), else None"""
    for c in cities():
        bs, bw, bn, be = c["box"]
        if s >= bs and w >= bw and n <= bn and e <= be:
            return c
    return None


def city_for_point(lat, lon, radius_m=0.0):
    import math
    dlat = radius_m / M_PER_DEG
    dlon = radius_m / (M_PER_DEG * max(0.2, math.cos(math.radians(lat))))
    return city_for_box(lat - dlat, lon - dlon, lat + dlat, lon + dlon)


def source_line(c):
    """what the answer came from (Hood, worker_run.json): the snapshot dates"""
    return {"source": "local", "city": c["city"], "osm_snapshot": c["osm_snapshot"], "ms_release": c["ms_release"]}


# ------------------------------------------------------------------ PostGIS -> Overpass element format
def _geom_list(gj):
    return [{"lat": la, "lon": lo} for lo, la in gj]


def _ways(rows):
    """(way_id, highway, name, bridge, tunnel, geojson) -> Overpass ways with the tags the app and pipeline read"""
    out = []
    for wid, hw, name, bridge, tunnel, gj in rows:
        tags = {"highway": hw}
        for k, v in (("name", name), ("bridge", bridge), ("tunnel", tunnel)):
            if v is not None:
                tags[k] = v
        out.append({"type": "way", "id": wid, "geometry": _geom_list(json.loads(gj)["coordinates"]), "tags": tags})
    return out


ROAD_COLS = "way_id, highway, name, bridge, tunnel, ST_AsGeoJSON(geom, 7)"
ENV = "ST_MakeEnvelope(%s, %s, %s, %s, 4326)"


def roads_in_box(s, w, n, e, highway_re=None):
    """Overpass `way["highway"](bbox)`: every way whose line meets the box (Overpass returns a way when any of its
    segments crosses the box); `~"re"` = PostgreSQL's unanchored regex, as Overpass's."""
    extra, args = ("and highway ~ %s", [highway_re]) if highway_re else ("", [])
    rows = _query(f"select {ROAD_COLS} from osm_roads where geom && {ENV} and ST_Intersects(geom, {ENV}) {extra} order by way_id",
                  [w, s, e, n, w, s, e, n, *args])
    return None if rows is None else _ways(rows)


def roads_near(points, radius_m, name=None):
    """Overpass `way["highway"]["name"=X](around:r, lat, lon)` (and several points): ways within r metres"""
    conds, args = [], []
    for la, lo in points:
        conds.append("ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)")
        args += [lo, la, radius_m]
    extra = ""
    if name is not None:
        extra, args = "and name = %s", args + [name]
    rows = _query(f"select {ROAD_COLS} from osm_roads where ({' or '.join(conds)}) {extra} order by way_id", args)
    return None if rows is None else _ways(rows)


def nearest_roads(lat, lon, highway_re, max_m, k=8):
    """the roads of the given classes nearest to a click: PostGIS nearest-neighbour (`<->` on the GiST index), the k
    nearest within max_m, as [(way_id, metres)] nearest first. The street picker then applies its own rule among them
    (local-metre distance, ties to the lowest way id, as with Overpass's id-ordered answer), so a click on a junction
    resolves to the same road as before."""
    rows = _query(f"""select way_id, ST_Distance(geom::geography, p::geography) d
                      from (select way_id, geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326) p from osm_roads
                            where highway ~ %s order by geom <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326) limit %s) k
                      where ST_Distance(geom::geography, p::geography) <= %s
                      order by d, way_id""", [lon, lat, highway_re, lon, lat, k, max_m + 1])
    return None if rows is None else [(r[0], r[1]) for r in rows]


def buildings_in_box(s, w, n, e, tags=True):
    """Overpass `(way["building"](bbox); relation["building"](bbox);); out geom tags;` - simple outlines as ways; each
    relation as one element whose outer members sit at their original member index (the pipeline names them
    r<id>_<index>). Only members meeting the box are returned; the pipeline drops the others anyway (it keeps outlines
    that meet the area polygon, which lies inside this box)."""
    rows = _query(f"select id, ST_AsGeoJSON(geom, 7) from osm_buildings where geom && {ENV} and ST_Intersects(geom, {ENV}) order by id",
                  [w, s, e, n, w, s, e, n])
    if rows is None:
        return None
    ways, rels = [], {}
    for bid, gj in rows:
        ring = _geom_list(json.loads(gj)["coordinates"][0])
        if bid.startswith("w"):
            ways.append({"type": "way", "id": int(bid[1:]), "geometry": ring, **({"tags": {"building": "yes"}} if tags else {})})
        else:
            rid, k = bid[1:].split("_")
            rels.setdefault(int(rid), {})[int(k)] = ring
    out = ways
    for rid, members in sorted(rels.items()):
        ms = [{"type": "way", "ref": 0, "role": ""} for _ in range(max(members) + 1)]
        for k, ring in members.items():
            ms[k] = {"type": "way", "ref": 0, "role": "outer", "geometry": ring}
        out.append({"type": "relation", "id": rid, "members": ms, "tags": {"building": "yes"}})
    return out


def outlines_near(lat, lon, radius_m):
    """Overpass `way["building"](around:r, lat, lon); out geom;` (no tags)"""
    rows = _query("""select id, ST_AsGeoJSON(geom, 7) from osm_buildings where id like 'w%%'
                     and ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s) order by id""",
                  [lon, lat, radius_m])
    if rows is None:
        return None
    return [{"type": "way", "id": int(i[1:]), "geometry": _geom_list(json.loads(gj)["coordinates"][0])} for i, gj in rows]


def pois_in_box(s, w, n, e):
    """Overpass shop / amenity / office nodes and shop / amenity ways (`out center`: a way as its bounding-box centre)"""
    rows = _query(f"select osm_type, osm_id, ST_Y(geom), ST_X(geom) from osm_pois where geom && {ENV} order by osm_type, osm_id",
                  [w, s, e, n])
    if rows is None:
        return None
    return [{"type": "node", "id": i, "lat": la, "lon": lo} if t == "n" else
            {"type": "way", "id": i, "center": {"lat": la, "lon": lo}} for t, i, la, lo in rows]


def ms_rings(s, w, n, e):
    """Microsoft outlines whose bounding box overlaps (s, w, n, e), as [[lon, lat], ...] rings (the pipeline's cache
    format); None when the box is not covered or the database is unavailable"""
    c = city_for_box(s, w, n, e)
    if c is None:
        return None
    rows = _query(f"select ST_AsGeoJSON(geom, 7) from ms_buildings where geom && {ENV} order by id", [w, s, e, n])
    if rows is None:
        return None
    return [json.loads(r[0])["coordinates"][0] for r in rows]


def _box(m, i=0):
    s, w, n, e = (float(m.group(i + k)) for k in (1, 2, 3, 4))
    return s, w, n, e


def answer(query):
    """The local answer to one of the Overpass queries the app and pipeline send, or None (not covered / not one of
    those queries / database unavailable). Returns (elements, source_line)."""
    if _POOL is None:
        return None
    q = query.strip()
    m = Q_ROADS.match(q)
    if m:
        bb = _box(m)
        c = city_for_box(*bb)
        return _wrap(roads_in_box(*bb), c) if c else None
    m = Q_ROADS_RE.match(q)
    if m:
        bb = _box(m, 1)
        c = city_for_box(*bb)
        return _wrap(roads_in_box(*bb, highway_re=m.group(1)), c) if c else None
    m = Q_BUILDINGS.match(q)
    if m:
        bb = _box(m)
        c = city_for_box(*bb) if bb == _box(m, 4) else None
        return _wrap(buildings_in_box(*bb), c) if c else None
    m = Q_POIS.match(q)
    if m:
        bb = _box(m)
        c = city_for_box(*bb) if all(_box(m, 4 * k) == bb for k in range(1, 5)) else None
        return _wrap(pois_in_box(*bb), c) if c else None
    m = Q_NAMED.match(q)
    if m:
        name = re.sub(r"\\(.)", r"\1", m.group(1))
        r, la, lo = float(m.group(2)), float(m.group(3)), float(m.group(4))
        c = city_for_point(la, lo, r)
        return _wrap(roads_near([(la, lo)], r, name=name), c) if c else None
    m = Q_ENDS.match(q)
    if m:
        parts = re.findall(AROUND, m.group(1))
        pts = [(float(la), float(lo)) for _, la, lo in parts]
        r = float(parts[0][0])
        if any(float(p[0]) != r for p in parts):
            return None
        cs = [city_for_point(la, lo, r) for la, lo in pts]
        return _wrap(roads_near(pts, r), cs[0]) if cs and all(cs) else None
    m = Q_OUTLINE.match(q)
    if m:
        r, la, lo = float(m.group(1)), float(m.group(2)), float(m.group(3))
        c = city_for_point(la, lo, r)
        return _wrap(outlines_near(la, lo, r), c) if c else None
    return None


def _wrap(els, c):
    return None if els is None else (els, source_line(c))


def status():
    """GET /mapdata: the covered cities and their snapshot dates (Under the Hood's data-source line)"""
    cs = cities()
    return {"available": bool(cs), "cities": cs,
            "attribution": {"osm": "© OpenStreetMap contributors (ODbL)",
                            "microsoft": "Building footprints © Microsoft (Global ML Building Footprints, ODbL)"}}


def area_city(polygon_bounds):
    """the covered city for an analysed area's bounds (lon/lat bounds: minx, miny, maxx, maxy), or None"""
    minx, miny, maxx, maxy = polygon_bounds
    return city_for_box(miny, minx, maxy, maxx)


def pipeline_source(cache_dir):
    """geo_cascadia.area.MAP_SOURCE for this process (the cost planner runs the pipeline's own area stage): the covered
    cities from PostGIS; elsewhere Overpass through the street picker's raced mirrors and 30-day disk cache; None (the
    pipeline's own Overpass call, as before) when that fails too."""
    def src(kind, arg):
        if kind == "overpass":
            loc = answer(arg)
            if loc is not None:
                return loc[0]
            from . import streetpick
            try:
                return streetpick.overpass(arg, cache_dir, time.monotonic() + streetpick.BG_TOTAL_S + 5)[0]
            except Exception:                                   # noqa: BLE001 - busy / slow: the pipeline's own call
                return None
        if kind == "microsoft":
            minx, miny, maxx, maxy = arg
            return ms_rings(miny, minx, maxy, maxx)
        return None
    return src


def area_map_data(bundle, areas_dir):
    """Under the Hood's data-source line for one area: the covered city (its snapshot dates, used by new analyses
    there) and what this area's own run used: the worker records it in worker_run.json `map_data` (D53); runs made
    before that asked OpenStreetMap's live servers (and Microsoft's tiles) at run time."""
    import os
    bb = bundle.get("bbox")                                    # [minx, miny, maxx, maxy]
    c = area_city(bb) if bb else None
    folder = os.path.join(areas_dir, bundle["slug"])
    wr, lr = {}, {}
    for name, into in (("worker_run.json", wr), ("live_run.json", lr)):
        try:
            with open(os.path.join(folder, name), encoding="utf-8") as f:
                into.update(json.load(f))
        except (OSError, ValueError):
            pass
    used = wr.get("map_data")
    if used:
        run = {"kind": "snapshot" if used.get("local") else "live", **used}
    else:
        run = {"kind": "live", "date": (lr.get("started_at") or "")[:10] or None}
    return {"city": c, "run": run,
            "attribution": {"osm": "© OpenStreetMap contributors (ODbL)",
                            "microsoft": "Building footprints © Microsoft (Global ML Building Footprints, ODbL)"}}
