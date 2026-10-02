"""Gate 1 for one building (the drawer): its own position error, from the same set and reference as Trust.

Trust's Gate 1 table (model_card.json `gate1_position`, written by tools/eval_gate1.py) scores each predicted position
against the middle of the building's road-facing wall on its OpenStreetMap outline. Only camera-derived positions are a
fair measure ("camera-derived (triangulated + wall_hit)", Ward 29 n = 260); a front-wall-centre position IS that point.
So a building is in one of two cases here (the third, a camera-only building with no outline, has no record: the drawer
reads the camera-buildings layer):
  - `camera`: triangulated or wall_hit. Its distance is the row Trust used (data/areas/<slug>/gate1_eval.json
    `official_front_m`). An area Trust does not cover (an area analysed from the app) gets the same distance computed
    with the same wall here (`from_trust` false).
  - `map`: wall_centre or footprint_centre. The error is not measured; no distance is given (never "0 m").

Corner check (display only, no rule uses it): an outline wall >= 3 m "faces a street" when the line straight out of its
middle meets a road within 10 m without crossing another analysed building. Roads: the area's analysed streets plus
OpenStreetMap's roads around it (the mini-map's cached set; service ways left out). A hit within 4 m of the building's own
street is that street, not another one. A wall turned >= 60 deg from the chosen front wall counts: a side wall (60-120
deg) means a corner, a back wall (> 120 deg) a street behind. Outlines that are not analysed buildings don't block.
"""
import json
import math
import os
import threading

from shapely.geometry import LineString, Point, Polygon

from . import frontwall

CAMERA = ("triangulated", "wall_hit")
FACE_M = 10.0               # a road this close in front of a wall: the wall faces it
WALL_MIN_M = 3.0            # shorter outline edges are jogs, not walls
TURN_DEG = 60.0             # a wall turned at least this far from the front wall is another side of the building
BACK_DEG = 120.0            # … and beyond this it is the back
OWN_STREET_M = 4.0          # a hit this close to the building's own street line is that street
REFERENCE = ("the middle of the building's road-facing wall on its OpenStreetMap outline (the organiser's reference, "
             "the same point as Trust's Gate 1 table)")


class EvalRows:
    """gate1_eval.json rows per area ({building id: row}), cached by mtime; None when the area has no evaluation."""

    def __init__(self, areas_dir):
        self.dir = areas_dir
        self._cache, self._lock = {}, threading.Lock()

    def get(self, slug):
        path = os.path.join(self.dir, slug, "gate1_eval.json")
        if not os.path.isfile(path):
            return None
        stamp = os.path.getmtime(path)
        with self._lock:
            hit = self._cache.get(slug)
            if hit and hit[0] == stamp:
                return hit[1]
        with open(path, encoding="utf-8") as f:
            rows = {r["id"]: r for r in json.load(f).get("rows") or []}
        with self._lock:
            self._cache[slug] = (stamp, rows)
        return rows


def _out_normal(poly, e):
    (ax, ay), (bx, by) = e.coords[0], e.coords[-1]
    L = math.dist((ax, ay), (bx, by))
    nx, ny = (by - ay) / L, -(bx - ax) / L
    m = e.interpolate(0.5, normalized=True)
    if poly.contains(Point(m.x + nx * 0.3, m.y + ny * 0.3)):
        nx, ny = -nx, -ny
    return m, nx, ny


def _nearest_street(lines, pt):
    return min(lines, key=lambda k: lines[k].distance(pt)) if lines else None


def other_walls(bundle, b, got, roads):
    """[{street, dist_m, side: 'side' | 'back'}]: the walls other than the chosen front that face a road (module doc)."""
    fr, poly, lines, edge = got
    _, fnx, fny = _out_normal(poly, edge)
    own = lines.get(b.get("street"))
    near = []                                            # (name, line): the analysed streets first, then OSM roads
    for k, ln in lines.items():
        near.append((k, ln))
    for r in roads or []:
        if r.get("type") == "service":
            continue
        for part in r.get("lines") or []:
            if len(part) > 1:
                ln = LineString([fr.xy(la, lo) for la, lo in part])
                if ln.distance(Point(0, 0)) < 150:
                    near.append((r.get("name"), ln))
    others = [Polygon([fr.xy(la, lo) for la, lo in o["footprint"]["polygon_latlon"]]) for o in bundle["buildings"]
              if o["id"] != b["id"] and abs(o["lat"] - b["lat"]) < 0.0006 and abs(o["lon"] - b["lon"]) < 0.0006
              and len((o.get("footprint") or {}).get("polygon_latlon") or []) >= 4]
    out = []
    ring = list(poly.exterior.coords)
    for i in range(len(ring) - 1):
        e = LineString([ring[i], ring[i + 1]])
        if e.length < WALL_MIN_M:
            continue
        m, nx, ny = _out_normal(poly, e)
        turn = math.degrees(math.acos(max(-1.0, min(1.0, nx * fnx + ny * fny))))
        if turn < TURN_DEG:
            continue
        start = (m.x + nx * 0.05, m.y + ny * 0.05)
        ray = LineString([start, (m.x + nx * FACE_M, m.y + ny * FACE_M)])
        hits = [(Point(start).distance(ray.intersection(ln)), name) for name, ln in near if ray.intersects(ln)]
        if not hits:
            continue
        d, name = min(hits, key=lambda h: h[0])
        hp = Point(m.x + nx * d, m.y + ny * d)
        if own is not None and own.distance(hp) < OWN_STREET_M:
            continue                                     # the building's own street (a bend or a street end)
        seg = LineString([start, (hp.x, hp.y)])
        if seg.crosses(poly) or any(seg.crosses(o) or seg.within(o) for o in others):
            continue
        analysed = [k for k, ln in lines.items() if ln.distance(hp) < OWN_STREET_M]
        out.append({"street": analysed[0] if analysed else name, "dist_m": round(d + 0.05, 1),   # from the wall itself
                    "side": "back" if turn > BACK_DEG else "side"})
    return out


def check(bundle, b, rows, roads, target_m, area_stats=None):
    """The drawer's position block for one building record (module doc). `rows` = EvalRows.get(slug) or None,
    `roads` = the mini-map's OpenStreetMap roads or None (then only the analysed streets are checked)."""
    p = b.get("predicted_position") or {}
    method = p.get("method")
    got = frontwall.road_edge(bundle, b)
    res = {"case": "camera" if method in CAMERA else "map", "method": method, "target_m": target_m,
           "distance_m": None, "within": None, "from_trust": False, "reference": REFERENCE, "area_stats": area_stats,
           "front_street": None, "other_walls": [], "corner": False, "back_street": False,
           "roads_checked": "analysed streets and OpenStreetMap roads" if roads is not None
           else "analysed streets only (OpenStreetMap roads not loaded)"}
    if not method:
        res["case"] = "none"
        return res
    if got is not None:
        fr, poly, lines, edge = got
        mid = edge.interpolate(0.5, normalized=True)
        res["front_street"] = b.get("street") if b.get("street") in lines else _nearest_street(lines, mid)
        walls = other_walls(bundle, b, got, roads)
        res["other_walls"] = walls
        res["corner"] = any(w["side"] == "side" for w in walls)
        res["back_street"] = any(w["side"] == "back" for w in walls)
    if res["case"] != "camera":
        return res
    row = (rows or {}).get(b["id"])
    if row is not None and row.get("official_method") == method and row.get("official_front_m") is not None:
        d, res["from_trust"] = row["official_front_m"], True
    elif got is not None and p.get("lat") is not None:
        d = round(mid.distance(Point(fr.xy(p["lat"], p["lon"]))), 2)
    else:
        return res
    res["distance_m"] = d
    res["within"] = d <= target_m
    return res


def area_stats(card, slug):
    """Trust's camera-derived row for this area (model_card), or None when Trust does not cover the area."""
    g = (card or {}).get("gate1_position") or {}
    t = ((g.get("vs OSM front-wall centre") or {}).get(slug) or {}).get("camera-derived (triangulated + wall_hit)")
    return {k: t[k] for k in ("n", "median_m", "within_3_5_m_pct")} if t else None
