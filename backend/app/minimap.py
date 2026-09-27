"""D39: context for the small plans (mini-maps) — every road around an area and the camera stops of its run.

Roads come from OpenStreetMap (one Overpass query per area, the same road classes as the pipeline, cached on disk like
the click picker's queries, so it is fetched once). Camera stops come from the run's plan.json. Buildings, poles,
lights and findings are already in the area records the app loads, so they are not repeated here.
"""
import math
import time

from . import streetpick
from .streetpick import ROADS, OverpassBusy

MARGIN_M = 200                      # roads this far outside the area are still drawn (the edges of a mini-map)
BUDGET_S = 30.0                     # background fetch (the mini-map draws without roads meanwhile)
PER_CALL_S = 15.0
RETRY_AFTER_S = 120                 # after a failed fetch, answer "not available" at once for this long
_failed = {}                        # query -> monotonic time of the last failure


def street_lines(st):
    """a street record's lines as [[lat, lon], …] lists (GeoJSON geometry, or the pipeline's lines_latlon)"""
    g = st.get("geometry")
    if isinstance(g, dict) and g.get("coordinates"):
        parts = [g["coordinates"]] if g.get("type") == "LineString" else g["coordinates"]
        return [[[la, lo] for lo, la in part] for part in parts]
    return st.get("lines_latlon") or []


def bounds_of(lats, lons, margin_m=MARGIN_M):
    if not lats:
        return None
    dlat = margin_m / 110540
    dlon = margin_m / (111320 * math.cos(math.radians((min(lats) + max(lats)) / 2)))
    return [min(lats) - dlat, min(lons) - dlon, max(lats) + dlat, max(lons) + dlon]


def area_bounds(bundle, plan):
    """[south, west, north, east] around everything the area has: street lines, buildings and camera stops."""
    lats, lons = [], []
    for s in bundle.get("streets") or []:
        for line in street_lines(s):
            for la, lo in line:
                lats.append(la); lons.append(lo)
    for b in bundle.get("buildings") or []:
        lats.append(b["lat"]); lons.append(b["lon"])
    for e in plan or []:
        lats.append(e["camera_lat"]); lons.append(e["camera_lon"])
    if not lats and bundle.get("bbox"):
        w, s, e, n = bundle["bbox"]
        lats, lons = [s, n], [w, e]
    return bounds_of(lats, lons)


def roads(bundle, plan, cache_dir, deadline=None, bb=None):
    """Every road around the area (or inside `bb`): [{name, type, lines: [[[lat, lon], …], …]}]. available=False when
    OpenStreetMap could not be reached and nothing is cached (the mini-maps then draw the analysed streets only, and say so)."""
    bb = bb or area_bounds(bundle, plan)
    if not bb:
        return {"available": False, "roads": []}
    s, w, n, e = (round(x, 4) for x in bb)
    q = f'[out:json][timeout:25];way["highway"~"{ROADS}"]({s},{w},{n},{e});out geom tags;'
    if time.monotonic() - _failed.get(q, -1e9) < RETRY_AFTER_S:
        return {"available": False, "roads": []}
    try:
        els, _ = streetpick.overpass(q, cache_dir, deadline or time.monotonic() + BUDGET_S, per_call=PER_CALL_S)
    except OverpassBusy:
        _failed[q] = time.monotonic()
        return {"available": False, "roads": []}
    out = []
    for w_ in els:
        g = w_.get("geometry")
        if not g or len(g) < 2:
            continue
        tags = w_.get("tags") or {}
        out.append({"name": streetpick.tidy(tags["name"]) if tags.get("name") else None, "type": tags.get("highway"),
                    "lines": [[[round(p["lat"], 6), round(p["lon"], 6)] for p in g]]})
    return {"available": True, "roads": out}


def stops(plan, bundle=None):
    """The camera stops the run photographed from: position, street (display name, as everywhere in the app) and the
    directions photographed (level views)."""
    disp = {s.get("osm_name") or s["name"]: s["name"] for s in (bundle or {}).get("streets") or []}
    return [{"lat": round(e["camera_lat"], 6), "lon": round(e["camera_lon"], 6), "street": disp.get(e.get("street"), e.get("street")),
             "headings": sorted({round(v["heading"]) for v in e.get("views") or [] if not v.get("pitch")})}
            for e in plan or []]


def context(bundle, plan, cache_dir):
    r = roads(bundle, plan, cache_dir)
    return {"roads": r["roads"], "roads_available": r["available"], "stops": stops(plan, bundle), "stops_available": plan is not None}


def job_context(inp, bundle, plan, cache_dir):
    """A job's mini-map (Jobs page): the roads around the requested stretch, and once the job made its area, that
    area's camera stops. Before the run, the stops are not known (stops_available=false)."""
    g = (inp or {}).get("lines") or {}
    parts = [g["coordinates"]] if g.get("type") == "LineString" else g.get("coordinates") or []
    lats = [la for part in parts for lo, la in part]
    lons = [lo for part in parts for lo, la in part]
    r = roads(None, None, cache_dir, bb=bounds_of(lats, lons, 150)) if lats else {"available": False, "roads": []}
    return {"roads": r["roads"], "roads_available": r["available"], "stops": stops(plan, bundle) if plan else [],
            "stops_available": plan is not None}


def building_at(lat, lon, cache_dir):
    """The OpenStreetMap building outline containing (lat, lon), as [[lat, lon], …], or None (none there, it came from
    Microsoft's building map, or OpenStreetMap is unreachable). One small cached query per point."""
    from shapely.geometry import Point, Polygon
    q = f'[out:json][timeout:15];way["building"](around:25,{lat:.6f},{lon:.6f});out geom;'
    try:
        els, _ = streetpick.overpass(q, cache_dir, time.monotonic() + BUDGET_S, per_call=PER_CALL_S)
    except OverpassBusy:
        return None
    pt = Point(lon, lat)
    for w in els:
        g = w.get("geometry") or []
        if len(g) >= 4:
            ring = [(n["lon"], n["lat"]) for n in g]
            if Polygon(ring).buffer(0).contains(pt):
                return [[round(la, 7), round(lo, 7)] for lo, la in ring]
    return None

