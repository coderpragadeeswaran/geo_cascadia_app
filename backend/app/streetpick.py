"""A map click → the street it lands on (design pass B §3), for the Analyse confirm sheet and the job input.

A port of geo_cascadia.picker.click_to_street (same Overpass queries, road classes, nearest-way rule, named-street
extension and 1.2 km cap; the pipeline itself is not modified) with the reliability the UI needs:
- the three analysed areas answer from their own streets.json first (a click within 15 m of an analysed street line):
  no Overpass call at all;
- Overpass (P7.1): every query races both mirrors in a background pool; a click waits at most BUDGET_S (5 s) in total.
  A query still running when the click gives up keeps running and fills the cache, so Retry is instant once it lands.
  The road itself comes first; if the details (the named street's full length, the roads at an unnamed road's ends)
  are still slow, the street is shown without them (`osm_details: false`, a note, nothing cached as complete). When the
  road itself is slow or OpenStreetMap is busy and an analysed street lies within 60 m, that street is offered;
- disk caches: Overpass answers by query; roads by map tile (~330 m, so every click in a tile needs no new road query);
  the resolved street by OSM way id (a second click anywhere on the same road is instant) and by the rounded click;
- the display name: street_names.json for analysed streets (never "(unnamed residential #…)"); the OSM name outside
  analysed areas; an unnamed road gets "Unnamed <type> road" (+ "near <named road>" when one is within reach);
- "already analysed": the same OSM way ids, or ≥ 30 % of its length within 15 m of an analysed street.
"""
import hashlib
import json
import math
import re
import os
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, TimeoutError as FutureTimeout, wait

import requests
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import linemerge, transform, unary_union

from geo_cascadia.geo import Frame
from geo_cascadia.picker import ROADS            # same road classes as the pipeline

MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
BUDGET_S = 5.0             # P7.1: a click waits at most this long in total; the browser gives up at 8 s
BG_PER_CALL_S = 25.0       # a query keeps running in the background this long per mirror after the click gave up
TILE_DEG = 0.003           # roads are fetched per tile (~330 m) with a margin, so any click in it resolves locally
TILE_PAD_M = 80            # > SEARCH_M + 8 (the pipeline's around radius): the nearest road is never cut off
SEARCH_M, BUFFER_M, MAX_LEN_M = 60, 45, 1200      # pipeline defaults (picker.click_to_street)
LOCAL_SNAP_M = 15          # a click this close to an analysed street line is that street (no Overpass)
OVERLAP_BUFFER_M, OVERLAP_SHARE = 15, 0.30
LABEL_RULE = 2             # P7.1 naming rule; resolved streets cached under an older rule are resolved again
UA = {"User-Agent": "geo-cascadia/0.2 (research prototype; street picker)"}


class OverpassBusy(RuntimeError):
    pass


class OverpassSlow(OverpassBusy):
    """The query is still running (in the background) after the click's time budget."""


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
    tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f)
    os.replace(tmp, path)


_POOL = ThreadPoolExecutor(max_workers=6, thread_name_prefix="overpass-race")        # one coordinator per query
_CALLS = ThreadPoolExecutor(max_workers=16, thread_name_prefix="overpass-call")      # mirror requests (may hang)
_INFLIGHT, _LOCK = {}, threading.Lock()
BG_TOTAL_S = 45.0          # a background query gives up after this long in total
TRIES_PER_MIRROR = 3       # a mirror answering 429 / 5xx / timeout is asked again (after a short wait) while time allows


def _ask_mirror(url, query, wait_s=0.0):
    if wait_s:
        time.sleep(wait_s)
    r = requests.post(url, data={"data": query}, headers=UA, timeout=(5, BG_PER_CALL_S))
    if r.status_code == 200 and r.text.lstrip().startswith("{"):
        return r.json().get("elements", [])
    raise OverpassBusy(f"HTTP {r.status_code}")


def _race(query, path):
    """Every mirror at once; the first valid answer wins and is cached. A failed mirror is asked again after a short
    wait (Overpass answers 429 when one address asks too often). Runs in the background pool."""
    t_end, last = time.monotonic() + BG_TOTAL_S, None
    pending = {_CALLS.submit(_ask_mirror, u, query): (u, 1) for u in MIRRORS}
    try:
        while pending:
            done, _ = wait(list(pending), timeout=max(0.0, t_end - time.monotonic()), return_when=FIRST_COMPLETED)
            if not done:
                break
            for f in done:
                u, k = pending.pop(f)
                try:
                    els = f.result()
                except Exception as e:                    # noqa: BLE001 - any mirror failure: try again / the other one
                    last = str(e) if isinstance(e, OverpassBusy) else type(e).__name__
                    if k < TRIES_PER_MIRROR and time.monotonic() + 2 * k + 3 < t_end:
                        pending[_CALLS.submit(_ask_mirror, u, query, 2.0 * k)] = (u, k + 1)
                    continue
                _write_json(path, els)
                return els
        raise OverpassBusy(f"OpenStreetMap is busy or unreachable ({last or 'timeout'}) — try again in a moment")
    finally:
        with _LOCK:
            _INFLIGHT.pop(path, None)


def overpass(query, cache_dir, deadline, per_call=None):
    """Cached Overpass call. Returns (elements, from_cache). Waits until `deadline` (time.monotonic) at most: a query
    still running then raises OverpassSlow and keeps running in the background (a later identical call joins it).
    per_call: unused, kept for callers of the old signature."""
    path = os.path.join(cache_dir, "overpass", hashlib.md5(query.encode()).hexdigest() + ".json")
    hit = _read_json(path)
    if hit is not None:
        return hit, True
    with _LOCK:
        fut = _INFLIGHT.get(path)
        if fut is None:
            # a separate thread starts the race, so the race's own mirror calls never wait behind it in the pool
            fut = _INFLIGHT[path] = _POOL.submit(_race, query, path)
    try:
        return fut.result(timeout=max(0.0, deadline - time.monotonic())), False
    except FutureTimeout:
        raise OverpassSlow("OSM lookup slow") from None


def _tile_query(lat, lon):
    """roads of the ~330 m tile holding the click, plus a margin wider than the pipeline's search radius"""
    ty, tx = math.floor(lat / TILE_DEG), math.floor(lon / TILE_DEG)
    plat = TILE_PAD_M / 110574
    plon = TILE_PAD_M / (111320 * max(0.2, math.cos(math.radians(lat))))
    s, w = ty * TILE_DEG - plat, tx * TILE_DEG - plon
    n, e = (ty + 1) * TILE_DEG + plat, (tx + 1) * TILE_DEG + plon
    return f'[out:json][timeout:25];way["highway"~"{ROADS}"]({s:.6f},{w:.6f},{n:.6f},{e:.6f});out geom tags;'


# ------------------------------------------------------------------ geometry (local metre frame, as the pipeline)
def _to_xy(F, g):
    return transform(lambda lon, lat, z=None: F.xy(lat, lon), g)


def _to_ll(F, g):
    return transform(lambda x, y, z=None: F.ll(x, y)[::-1], g)


def _parts(g):
    if g.is_empty:
        return []
    return [p for p in (list(g.geoms) if hasattr(g, "geoms") else [g]) if p.geom_type == "LineString" and p.length > 0]


def _area_ll(F, lines_xy):
    """The job area: the street buffered by the pipeline's 45 m, back in lon/lat. A street whose OSM ways leave a gap
    wider than twice the buffer buffers into separate pieces; every piece is kept (a MultiPolygon with any number of
    parts), and run_area / the worker take either. Holes are filled, as picker.click_to_street does."""
    buf = lines_xy.buffer(BUFFER_M)
    polys = [Polygon([F.ll(x, y)[::-1] for x, y in p.exterior.coords])
             for p in (buf.geoms if hasattr(buf, "geoms") else [buf]) if not p.is_empty]
    return polys[0] if len(polys) == 1 else MultiPolygon(polys)


def _result(F, line_xy, way_ids, street, name_source, osm_name, source):
    parts = _parts(line_xy.intersection(Point(0, 0).buffer(MAX_LEN_M / 2)))       # cap job size (pipeline rule)
    if not parts:
        raise NoRoad(f"no road within {SEARCH_M} m of the clicked point")
    merged = MultiLineString(parts)
    poly = _area_ll(F, merged)
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
    poly = _area_ll(F, merged)
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
def _lines_ll(F, line_xy):
    return [[[round(x, 7), round(y, 7)] for x, y in l.coords] for l in _to_ll(F, MultiLineString(_parts(line_xy))).geoms]


def _from_ll(F, lines_ll):
    return unary_union([LineString([F.xy(la, lo) for lo, la in l]) for l in lines_ll if len(l) >= 2])


def pick_overpass(cache_dir, lat, lon, deadline, google_key=None):
    """Returns (result, complete). complete is False when the details (the named street beyond the tile, the roads at
    an unnamed road's ends) were still loading when the click's budget ran out: the street is shown without them."""
    F = Frame(lat, lon)
    els, cached = overpass(_tile_query(lat, lon), cache_dir, deadline)      # same road classes as the pipeline
    ways = [w for w in els if "geometry" in w]
    geom = lambda w: LineString([F.xy(n["lat"], n["lon"]) for n in w["geometry"]])
    hit = min(ways, key=lambda w: geom(w).distance(Point(0, 0))) if ways else None
    if hit is None or geom(hit).distance(Point(0, 0)) > SEARCH_M:
        raise NoRoad(f"no road within {SEARCH_M} m of the clicked point")
    # the same road clicked before (anywhere along it): its street is resolved already
    known = _read_json(os.path.join(cache_dir, "byway", f"{hit['id']}.json"))
    if known and known.get("rule") == LABEL_RULE:
        return _result(F, _from_ll(F, known["lines"]), known["way_ids"], known["street"], known["name_source"],
                       known.get("osm_name"), "cache"), True
    tags = hit.get("tags", {})
    name = tags.get("name")
    group = [w for w in ways if name and w.get("tags", {}).get("name") == name] or [hit]
    source, complete = ("cache" if cached else "overpass"), True
    if name:                                                      # extend a named street beyond the tile
        safe = name.replace("\\", "").replace('"', '\\"')
        q2 = f'[out:json][timeout:25];way["highway"]["name"="{safe}"](around:1500,{round(lat, 3)},{round(lon, 3)});out geom tags;'
        try:
            els2, cached2 = overpass(q2, cache_dir, deadline)
            group = [w for w in els2 if "geometry" in w] or group
            source = "cache" if cached and cached2 else "overpass"
        except OverpassBusy:
            complete = False                                      # keep the pieces within the tile
    line = unary_union([geom(w) for w in group])
    if name:
        street, src = tidy(name), "osm"
    else:
        # the named roads at the unnamed road's two ends (they can lie outside the tile): one small query
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
                complete = False                                  # name from the roads within the tile only
        pairs = [(tidy(w["tags"]["name"]), geom(w)) for w in named]
        if google_key:
            g_pairs, g_complete = google_names_at_ends(cache_dir, F, line, [geom(w) for w in ways + (els3 if ends else [])
                                                                            if "geometry" in w and w["id"] != hit["id"]
                                                                            and not (w.get("tags") or {}).get("name")], google_key, deadline)
            pairs += g_pairs
            complete = complete and g_complete                    # a Google name still to come: not final, not cached
        street = unnamed_label(line, pairs, Point(0, 0))
        src = "unnamed"
    way_ids = [w["id"] for w in group]
    if complete:                                                  # every way of the street resolves to it from now on
        rec = {"rule": LABEL_RULE, "t": time.time(), "lines": _lines_ll(F, line), "way_ids": way_ids, "street": street,
               "name_source": src, "osm_name": name}
        for wid in (way_ids if name else [hit["id"]]):
            _write_json(os.path.join(cache_dir, "byway", f"{wid}.json"), rec)
    return _result(F, line, way_ids, street, src, name, source), complete


TOUCH_M = 15                  # a named road this close to an end of an unnamed road is where it starts or ends
GEO_URL = "https://maps.googleapis.com/maps/api/geocode/json"
GOOGLE_TTL_S = 30 * 86400     # Google names are kept at most 30 days


def google_names_at_ends(cache_dir, F, line, unnamed_osm, key, deadline=None):
    """D36: where an end of the clicked road meets a road that has no name on OpenStreetMap, ask Google Maps for that
    road's name (reverse geocoding, "route", 25 m along it from the junction; at most one look-up per end, cached).
    Returns ([(name, geometry)] for unnamed_label, complete). A refusal (key not enabled for Geocoding, quota) adds
    nothing and is final; a look-up skipped for time or lost to the network makes complete False (P7.1)."""
    out, complete = [], True
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
            left = 6.0 if deadline is None else deadline - time.monotonic()
            if left < 0.5:
                complete = False                                  # the click's budget is spent: no Google name this time
                continue
            try:
                j = requests.get(GEO_URL, params={"latlng": f"{la:.6f},{lo:.6f}", "result_type": "route", "key": key},
                                 timeout=min(6.0, left)).json()
            except (requests.RequestException, ValueError):
                complete = False
                continue
            if j.get("status") not in ("OK", "ZERO_RESULTS"):
                continue                                          # e.g. REQUEST_DENIED: Geocoding not enabled for the key
            name = next((c["long_name"] for r in j.get("results", []) for c in r.get("address_components", [])
                         if "route" in c.get("types", [])), None)
            _write_json(path, {"t": time.time(), "name": name})
        if name and name.lower() != "unnamed road":
            out.append((tidy(name), g))
    return out, complete
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


def unnamed_label(line, named, click=None):
    """D36 / P7.1: a name for a road the map has no name for, from the named cross streets at its ends only (never
    invented): two different names -> "Unnamed road between A and B"; one -> "Unnamed road near A"; none ->
    "Unnamed road". A cross street is a named road within TOUCH_M of an end, or one crossing the road (within 3 m).
    `line` and the named geometries are in metres (same frame); `named` = [(name, geometry)], OpenStreetMap names first
    (Google names for roads the map leaves unnamed after them). `click` is unused (kept for callers)."""
    named = [(n, g) for n, g in named if n and not str(n).startswith("(unnamed")]
    if not named:
        return "Unnamed road"
    cross = []
    for p in end_points(line):
        d, _, n = min((round(g.distance(p), 1), i, n) for i, (n, g) in enumerate(named))   # a tie: the earlier (map) name
        if d <= TOUCH_M and n not in cross:
            cross.append(n)
    if len(cross) < 2:
        cross += [n for d, n in sorted((g.distance(line), n) for n, g in named) if d <= 3 and n not in cross][:2 - len(cross)]
    if len(cross) >= 2:
        return f"Unnamed road between {cross[0]} and {cross[1]}"
    return f"Unnamed road near {cross[0]}" if cross else "Unnamed road"


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


_FINISHING = set()


def _finish_later(cache_dir, lat, lon, path, google_key):
    """The click gave up: resolve the same click in the background with a long budget (its queries join the ones
    already running), so Retry — or any click on the same road — is answered from the cache."""
    with _LOCK:
        if path in _FINISHING:
            return
        _FINISHING.add(path)

    def run():
        try:
            res, complete = pick_overpass(cache_dir, lat, lon, time.monotonic() + BG_TOTAL_S, google_key)
            if complete:
                _write_json(path, {"complete": True, "rule": LABEL_RULE, "t": time.time(), "res": res})
        except Exception:                                         # noqa: BLE001 - best effort; the next click asks again
            pass
        finally:
            with _LOCK:
                _FINISHING.discard(path)
    threading.Thread(target=run, name="pick-finish", daemon=True).start()


SLOW_NOTE = "OSM lookup slow — showing without OSM details (the name and full length may be incomplete)."


def pick(cache_dir, bundles, lat, lon, google_key=None):
    """Resolve a click within BUDGET_S. Raises NoRoad (422), OverpassSlow (503, still loading in the background) or
    OverpassBusy (503). A street resolved without its OSM details carries osm_details=False and SLOW_NOTE."""
    res = pick_local(bundles, lat, lon)
    if res is None:
        # picks2: resolved clicks (complete answers named by the current rule only)
        path = os.path.join(cache_dir, "picks2", f"{round(lat, 4):.4f}_{round(lon, 4):.4f}.json")
        hit = _read_json(path)
        if hit and hit.get("complete") and hit.get("rule") == LABEL_RULE:
            res = {**hit["res"], "source": "cache"}
        else:
            try:
                res, complete = pick_overpass(cache_dir, lat, lon, time.monotonic() + BUDGET_S, google_key)
                if complete:
                    _write_json(path, {"complete": True, "rule": LABEL_RULE, "t": time.time(), "res": res})
                else:
                    res["osm_details"], res["note"] = False, SLOW_NOTE
                    _finish_later(cache_dir, lat, lon, path, google_key)
            except OverpassSlow:
                _finish_later(cache_dir, lat, lon, path, google_key)
                res = pick_local(bundles, lat, lon, SEARCH_M)
                if res is None:
                    raise
                res["note"] = "OpenStreetMap is slow, so this is the nearest street that was already analysed."
            except OverpassBusy:
                res = pick_local(bundles, lat, lon, SEARCH_M)          # slow / busy: offer the nearest analysed street
                if res is None:
                    raise
                res["note"] = "OpenStreetMap is slow or busy, so this is the nearest street that was already analysed."
    res = annotate(res, bundles, lat, lon)
    res["street"] = plain_name(res["street"])
    return res
