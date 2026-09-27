"""A map click → the street it lands on (design pass B §3), for the Analyse confirm sheet and the job input.

A port of geo_cascadia.picker.click_to_street (same Overpass queries, road classes, nearest-way rule, named-street
extension and 1.2 km cap; the pipeline itself is not modified) with the reliability the UI needs:
- the three analysed areas answer from their own streets.json first (a click within 15 m of an analysed street line):
  no Overpass call at all;
- Overpass: one mirror, then one fallback mirror, inside a 14 s budget for the whole lookup; a clear "busy" error;
  when OpenStreetMap is busy and an analysed street lies within the 60 m search radius, that street is offered
  (with a note saying so);
- disk caches: Overpass answers by query, and the resolved street by the rounded click (4 decimals ≈ 11 m); a street
  whose named-street extension failed is cached for 10 minutes only;
- the display name: street_names.json for analysed streets (never "(unnamed residential #…)"); the OSM name outside
  analysed areas; an unnamed road gets "Unnamed <type> road" (+ "near <named road>" when one is within reach);
- "already analysed": the same OSM way ids, or ≥ 30 % of its length within 15 m of an analysed street.
"""
import hashlib
import json
import re
import os
import time

import requests
from shapely.geometry import LineString, MultiLineString, Point, Polygon, mapping, shape
from shapely.ops import linemerge, transform, unary_union

from geo_cascadia.geo import Frame
from geo_cascadia.picker import ROADS            # same road classes as the pipeline

MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
BUDGET_S = 14.0            # the whole lookup (both queries, both mirrors); the browser gives up at 18 s
PER_CALL_S = 6.5
SEARCH_M, BUFFER_M, MAX_LEN_M = 60, 45, 1200      # pipeline defaults (picker.click_to_street)
LOCAL_SNAP_M = 15          # a click this close to an analysed street line is that street (no Overpass)
OVERLAP_BUFFER_M, OVERLAP_SHARE = 15, 0.30
PARTIAL_TTL_S = 600
UA = {"User-Agent": "geo-cascadia/0.2 (research prototype; street picker)"}


class OverpassBusy(RuntimeError):
    pass


class NoRoad(RuntimeError):
    pass


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f)
    os.replace(tmp, path)


def overpass(query, cache_dir, deadline):
    """Cached Overpass call: primary mirror, then one fallback, within the deadline. Returns (elements, from_cache)."""
    path = os.path.join(cache_dir, "overpass", hashlib.md5(query.encode()).hexdigest() + ".json")
    hit = _read_json(path)
    if hit is not None:
        return hit, True
    last = None
    for url in MIRRORS:
        left = deadline - time.monotonic()
        if left < 1.0:
            break
        try:
            r = requests.post(url, data={"data": query}, headers=UA, timeout=(min(3.05, left), min(PER_CALL_S, left)))
            if r.status_code == 200 and r.text.lstrip().startswith("{"):
                els = r.json().get("elements", [])
                _write_json(path, els)
                return els, False
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            last = type(e).__name__
    raise OverpassBusy(f"OpenStreetMap is busy or unreachable ({last or 'timeout'}) — try again in a moment")


# ------------------------------------------------------------------ geometry (local metre frame, as the pipeline)
def _to_xy(F, g):
    return transform(lambda lon, lat, z=None: F.xy(lat, lon), g)


def _to_ll(F, g):
    return transform(lambda x, y, z=None: F.ll(x, y)[::-1], g)


def _parts(g):
    if g.is_empty:
        return []
    return [p for p in (list(g.geoms) if hasattr(g, "geoms") else [g]) if p.geom_type == "LineString" and p.length > 0]


def _result(F, line_xy, way_ids, street, name_source, osm_name, source):
    parts = _parts(line_xy.intersection(Point(0, 0).buffer(MAX_LEN_M / 2)))       # cap job size (pipeline rule)
    if not parts:
        raise NoRoad(f"no road within {SEARCH_M} m of the clicked point")
    merged = MultiLineString(parts)
    buf = merged.buffer(BUFFER_M)
    poly = Polygon([F.ll(x, y)[::-1] for x, y in buf.exterior.coords])
    lines_ll = _to_ll(F, merged)
    return {"street": street, "name_source": name_source, "osm_name": osm_name, "length_m": round(merged.length),
            "osm_ways": len(way_ids), "way_ids": way_ids, "polygon": mapping(poly),
            "lines": {"type": "MultiLineString", "coordinates": [[[round(x, 7), round(y, 7)] for x, y in l.coords] for l in lines_ll.geoms]},
            "source": source}


TRIM_TOL_M, MIN_TRIM_M = 8, 20


def trim(res, lines):
    """Review fix 10: the person dragged the end dots to a shorter stretch of the picked street. `lines` = GeoJSON
    (Multi)LineString, lon/lat. Every vertex must lie on the picked street (within 8 m); the job polygon is rebuilt from
    the stretch with the pipeline's 45 m buffer, so the worker analyses only that stretch. Raises ValueError."""
    try:
        g = shape(lines)
    except Exception:
        raise ValueError("lines must be a GeoJSON LineString or MultiLineString") from None
    if g.geom_type not in ("LineString", "MultiLineString") or g.is_empty:
        raise ValueError("lines must be a GeoJSON LineString or MultiLineString")
    c = g.centroid
    F = Frame(c.y, c.x)
    full = _to_xy(F, shape(res["lines"]))
    parts = _parts(_to_xy(F, g))
    if not parts:
        raise ValueError("the stretch is empty")
    far = max(full.distance(Point(xy)) for p in parts for xy in p.coords)
    if far > TRIM_TOL_M:
        raise ValueError(f"the stretch leaves the picked street by {far:.0f} m")
    merged = MultiLineString(parts)
    if merged.length < MIN_TRIM_M:
        raise ValueError(f"the stretch is {merged.length:.0f} m; the shortest is {MIN_TRIM_M} m")
    if merged.length > full.length + 1:
        raise ValueError("the stretch is longer than the picked street")
    buf = merged.buffer(BUFFER_M)
    poly = Polygon([F.ll(x, y)[::-1] for x, y in buf.exterior.coords])
    lines_ll = _to_ll(F, merged)
    return {**res, "length_m": round(merged.length), "full_length_m": res["length_m"], "trimmed": True, "polygon": mapping(poly),
            "lines": {"type": "MultiLineString", "coordinates": [[[round(x, 7), round(y, 7)] for x, y in l.coords] for l in lines_ll.geoms]}}


def _street_geom(s):
    g = s.get("geometry")
    return shape(g) if g else None


# ------------------------------------------------------------------ 1) analysed areas (no Overpass)
def pick_local(bundles, lat, lon, snap_m=LOCAL_SNAP_M):
    F = Frame(lat, lon)
    best = None
    for b in bundles:
        for s in b["streets"]:
            g = _street_geom(s)
            if g is None or g.is_empty:
                continue
            gx = _to_xy(F, g)
            d = gx.distance(Point(0, 0))
            if d <= snap_m and (best is None or d < best[0]):
                best = (d, s, gx)
    if not best:
        return None
    _, s, gx = best
    # s["name"] is the analysed street's display name (street_names.json applied, D13)
    return _result(F, gx, list(s.get("way_ids") or []), s["name"], "street_names", s.get("osm_name"), "area")


# ------------------------------------------------------------------ 2) Overpass (port of picker.click_to_street)
def pick_overpass(cache_dir, lat, lon, deadline, google_key=None):
    """Returns (result, complete) — complete is False when the named-street extension could not be fetched."""
    F = Frame(lat, lon)
    q = f'[out:json][timeout:25];way["highway"~"{ROADS}"](around:{SEARCH_M + 8},{round(lat, 4)},{round(lon, 4)});out geom tags;'
    els, cached = overpass(q, cache_dir, deadline)
    ways = [w for w in els if "geometry" in w]
    geom = lambda w: LineString([F.xy(n["lat"], n["lon"]) for n in w["geometry"]])
    hit = min(ways, key=lambda w: geom(w).distance(Point(0, 0))) if ways else None
    if hit is None or geom(hit).distance(Point(0, 0)) > SEARCH_M:
        raise NoRoad(f"no road within {SEARCH_M} m of the clicked point")
    tags = hit.get("tags", {})
    name = tags.get("name")
    group = [w for w in ways if name and w.get("tags", {}).get("name") == name] or [hit]
    source, complete = ("cache" if cached else "overpass"), True
    if name:                                                      # extend a named street beyond the search circle
        safe = name.replace("\\", "").replace('"', '\\"')
        q2 = f'[out:json][timeout:25];way["highway"]["name"="{safe}"](around:1500,{round(lat, 3)},{round(lon, 3)});out geom tags;'
        try:
            els2, cached2 = overpass(q2, cache_dir, deadline)
            group = [w for w in els2 if "geometry" in w] or group
            source = "cache" if cached and cached2 else "overpass"
        except OverpassBusy:
            complete = False                                      # keep the ways within the search circle
    line = unary_union([geom(w) for w in group])
    if name:
        street, src = tidy(name), "osm"
    else:
        # the named roads at the unnamed road's two ends (they can lie outside the search circle): one small query
        named = [w for w in ways if (w.get("tags") or {}).get("name")]
        ends = end_points(line)
        els3 = []
        if ends:
            pts = [F.ll(p.x, p.y) for p in ends]
            # every road at the two ends: named ones name it; unnamed ones may have a name on Google Maps
            q3 = ("[out:json][timeout:25];(" + "".join(f'way["highway"](around:{TOUCH_M},{la:.6f},{lo:.6f});' for la, lo in pts)
                  + ");out geom tags;")
            try:
                els3, _ = overpass(q3, cache_dir, deadline)
                named += [w for w in els3 if "geometry" in w and (w.get("tags") or {}).get("name")]
            except OverpassBusy:
                complete = False                                  # name from the roads within the search circle only
        pairs = [(tidy(w["tags"]["name"]), geom(w)) for w in named]
        if google_key:
            pairs += google_names_at_ends(cache_dir, F, line, [geom(w) for w in ways + (els3 if ends else [])
                                                               if "geometry" in w and w["id"] != hit["id"]
                                                               and not (w.get("tags") or {}).get("name")], google_key)
        street = unnamed_label(line, pairs, Point(0, 0))
        src = "unnamed"
    return _result(F, line, [w["id"] for w in group], street, src, name, source), complete


TOUCH_M = 15                  # a named road this close to an end of an unnamed road is where it starts or ends
GEO_URL = "https://maps.googleapis.com/maps/api/geocode/json"
GOOGLE_TTL_S = 30 * 86400     # Google names are kept at most 30 days


def google_names_at_ends(cache_dir, F, line, unnamed_osm, key):
    """D36: where an end of the clicked road meets a road that has no name on OpenStreetMap, ask Google Maps for that
    road's name (reverse geocoding, "route", 25 m along it from the junction; at most one look-up per end, cached).
    Returns [(name, geometry)] for unnamed_label. Any failure (key not enabled for Geocoding, quota) returns nothing."""
    out = []
    for p in end_points(line):
        near = [g for g in unnamed_osm if g.distance(p) <= TOUCH_M]
        if not near:
            continue
        g = min(near, key=lambda x: x.distance(p))
        s = g.project(p)
        q = g.interpolate(s + 25 if s + 25 <= g.length else max(0.0, s - 25))
        la, lo = F.ll(q.x, q.y)
        path = os.path.join(cache_dir, "google_route", f"{la:.5f}_{lo:.5f}.json")
        hit = _read_json(path)
        if hit and time.time() - hit.get("t", 0) < GOOGLE_TTL_S:
            name = hit.get("name")
        else:
            try:
                j = requests.get(GEO_URL, params={"latlng": f"{la:.6f},{lo:.6f}", "result_type": "route", "key": key},
                                 timeout=6).json()
            except requests.RequestException:
                continue
            if j.get("status") not in ("OK", "ZERO_RESULTS"):
                continue                                          # e.g. REQUEST_DENIED: Geocoding not enabled for the key
            name = next((c["long_name"] for r in j.get("results", []) for c in r.get("address_components", [])
                         if "route" in c.get("types", [])), None)
            _write_json(path, {"t": time.time(), "name": name})
        if name and name.lower() != "unnamed road":
            out.append((tidy(name), g))
    return out
SMALL_WORDS = {"and", "of", "the", "to", "on", "in", "at", "by"}


def tidy(name):
    """A map name as written, only with each word capitalised when the map has it in lower case ("Union mill road" ->
    "Union Mill Road"). Tamil or other scripts, and names already capitalised, are left exactly as they are."""
    if not isinstance(name, str) or not name.isascii() or not any(w[:1].islower() for w in name.split()):
        return name
    return " ".join(w if (i and w.lower() in SMALL_WORDS) or not w[:1].islower() else w[:1].upper() + w[1:]
                    for i, w in enumerate(name.split()))


def end_points(line):
    """the free ends of a (possibly multi-piece) road line"""
    m = linemerge(line) if line.geom_type == "MultiLineString" else line
    b = m.boundary
    return list(b.geoms) if hasattr(b, "geoms") else ([] if b.is_empty else [b])


def unnamed_label(line, named, click):
    """D36: a name for a road the map has no name for, from real map names only (never invented):
    connects two named roads -> "Unnamed road between A and B"; touches one -> "Unnamed road off A";
    else -> "Unnamed road near <nearest named road>"; none known -> "Unnamed road".
    `line` and the named geometries are in metres (same frame); `named` = [(name, geometry)], OpenStreetMap names first
    (Google names for roads the map leaves unnamed after them)."""
    named = [(n, g) for n, g in named if n and not str(n).startswith("(unnamed")]
    if not named:
        return "Unnamed road"
    at_ends = []
    for p in end_points(line):
        d, _, n = min((round(g.distance(p), 1), i, n) for i, (n, g) in enumerate(named))   # a tie: the earlier (map) name
        if d <= TOUCH_M and n not in at_ends:
            at_ends.append(n)
    if len(at_ends) >= 2:
        return f"Unnamed road between {at_ends[0]} and {at_ends[1]}"
    touching = at_ends or [n for d, n in sorted((g.distance(line), n) for n, g in named) if d <= 3][:1]
    if touching:
        return f"Unnamed road off {touching[0]}"
    return f"Unnamed road near {min((g.distance(line), n) for n, g in named)[1]}"


# ------------------------------------------------------------------ 3) display name + overlap with analysed streets
RANK = {"way_ids": 1, "geometry": 0}


def annotate(res, bundles, lat, lon):
    """An analysed street's display name wins over the raw OSM label; the "already analysed" list, best match first."""
    F = Frame(lat, lon)
    mine = set(res["way_ids"])
    line = _to_xy(F, shape(res["lines"]))
    already = []
    for b in bundles:
        best = None
        for s in b["streets"]:
            g = _street_geom(s)
            share = line.intersection(_to_xy(F, g).buffer(OVERLAP_BUFFER_M)).length / max(line.length, 1) if g is not None else 0.0
            if mine & set(s.get("way_ids") or []):
                cand = {"slug": b["slug"], "area": b["name"], "street": s["name"], "by": "way_ids", "overlap": round(min(1.0, max(share, 0.01)), 2)}
            elif share >= OVERLAP_SHARE:
                cand = {"slug": b["slug"], "area": b["name"], "street": s["name"], "by": "geometry", "overlap": round(share, 2)}
            else:
                continue
            if best is None or (RANK[cand["by"]], cand["overlap"]) > (RANK[best["by"]], best["overlap"]):
                best = cand
        if best:
            already.append(best)
            if best["by"] == "way_ids" and res["name_source"] != "street_names":
                res["street"], res["name_source"] = best["street"], "street_names"
    already.sort(key=lambda a: (-RANK[a["by"]], -a["overlap"]))
    res["already"] = already
    res["already_analysed_in"] = [a["slug"] for a in already]
    return res


UNNAMED_TYPED = re.compile(r"^Unnamed [a-z_ ]+? road\b")


def plain_name(name):
    """D35 (F4): no OpenStreetMap road classes in names: "Unnamed residential road near X" -> "Unnamed road near X".
    Also applied to names cached or stored before this rule."""
    return UNNAMED_TYPED.sub("Unnamed road", name) if isinstance(name, str) else name


def pick(cache_dir, bundles, lat, lon, google_key=None):
    """Resolve a click. Raises NoRoad (422) or OverpassBusy (503)."""
    res = pick_local(bundles, lat, lon)
    if res is None:
        # picks2: resolved clicks named by the D36 rule (the old folder holds "near" names)
        path = os.path.join(cache_dir, "picks2", f"{round(lat, 4):.4f}_{round(lon, 4):.4f}.json")
        hit = _read_json(path)
        if hit and (hit.get("complete") or time.time() - hit.get("t", 0) < PARTIAL_TTL_S):
            res = {**hit["res"], "source": "cache"}
        else:
            try:
                res, complete = pick_overpass(cache_dir, lat, lon, time.monotonic() + BUDGET_S, google_key)
                _write_json(path, {"complete": complete, "t": time.time(), "res": res})
            except OverpassBusy:
                res = pick_local(bundles, lat, lon, SEARCH_M)          # busy: offer the nearest analysed street
                if res is None:
                    raise
                res["note"] = "OpenStreetMap is busy, so this is the nearest street that was already analysed."
    res = annotate(res, bundles, lat, lon)
    res["street"] = plain_name(res["street"])
    return res
