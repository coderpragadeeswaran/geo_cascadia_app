"""Front-wall length (P8): how long a building's street-facing wall is, from its OpenStreetMap outline.

The wall is the pipeline's own road-facing edge (`buildloc.road_facing_edge`: the outline edge >= 1 m whose midpoint is
nearest the building's street line), the same wall whose centre is the Gate 1 position (D33). Outlines often draw one
straight wall as several short edges, so neighbouring edges that continue it in the same direction (within
STRAIGHT_DEG, both ends within ONLINE_M of its line) are joined to it.

The export's `footprint.frontage_m` is NOT this: it is the longer side of the outline's minimum rotated rectangle
(`plan.building_register`), whichever way that side faces. Both are returned, labelled.
"""
import math

from geo_cascadia.buildloc import ROAD_EDGE_MIN_M, road_facing_edge
from geo_cascadia.geo import Frame
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from .minimap import street_lines

STRAIGHT_DEG = 12.0
ONLINE_M = 0.6


def _dir(a, b):
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180


def front_wall(bundle, b):
    ring = ((b.get("footprint") or {}).get("polygon_latlon")) or []
    if len(ring) < 4:
        return None
    fr = Frame(b["lat"], b["lon"])
    poly = Polygon([fr.xy(la, lo) for la, lo in ring])
    if not poly.is_valid or poly.area <= 0:
        return None
    lines = {}
    for st in bundle["streets"]:
        ls = [LineString([fr.xy(la, lo) for la, lo in part]) for part in street_lines(st) if len(part) > 1]
        if ls:
            lines[st["name"]] = unary_union(ls)
    own = lines.get(b.get("street"))
    edge = road_facing_edge(poly, own) or road_facing_edge(poly, unary_union(list(lines.values())) if lines else None)
    if edge is None:
        return None
    (ax, ay), (bx, by) = edge.coords[0], edge.coords[-1]
    d0, L = _dir((ax, ay), (bx, by)), edge.length
    ux, uy = (bx - ax) / L, (by - ay) / L
    pts = list(poly.exterior.coords)[:-1]
    n = len(pts)
    i0 = next(i for i in range(n) if math.dist(pts[i], (ax, ay)) < 1e-6 and math.dist(pts[(i + 1) % n], (bx, by)) < 1e-6)
    off = lambda p: abs((p[0] - ax) * uy - (p[1] - ay) * ux)       # distance from the wall's own line

    def walk(step):
        """extend from the wall along the ring while the next edge continues it (same direction, on its line)"""
        i, extra = (i0 + 1) % n if step > 0 else i0, 0.0
        for _ in range(n - 1):
            p, q = (pts[i], pts[(i + 1) % n]) if step > 0 else (pts[i], pts[(i - 1) % n])
            dd = abs(_dir(p, q) - d0)
            # a jog shorter than the pipeline's 1 m minimum edge only has to stay on the wall's line
            if (min(dd, 180 - dd) > STRAIGHT_DEG and math.dist(p, q) >= ROAD_EDGE_MIN_M) or off(q) > ONLINE_M:
                break
            extra += math.dist(p, q)
            i = (i + step) % n
        return extra

    total = L + walk(1) + walk(-1)
    rect = (b.get("footprint") or {}).get("frontage_m")
    return {"length_m": round(total, 1), "edge_m": round(L, 1), "rect_long_side_m": rect,
            "street": b.get("street"),
            "source": "OpenStreetMap outline: its wall facing the street (the edge nearest the street line, the same wall "
                      "whose centre is the building's position; straight continuations joined)",
            "rect_note": "the export's frontage figure is the longer side of the outline's rotated rectangle, whichever way it faces"}
