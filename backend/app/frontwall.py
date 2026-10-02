"""Frontage (P8, D50/D51): how long a building's street-facing wall is, from its OpenStreetMap outline.

The wall is the pipeline's own road-facing edge (`buildloc.road_facing_edge`: the outline edge >= 1 m whose midpoint is
nearest the building's street line), the same wall whose centre is the Gate 1 position (D33), plus the outline edges that
continue it straight (`buildloc.front_wall_length`, shared with the pipeline's export).

Since D51 the export's `footprint.frontage_m` IS this value (`tools/frontage_fix.py` for the saved runs; the pipeline's
export for new ones). The outline's longest side (the old `frontage_m`, the longer side of its minimum rotated rectangle,
whichever way it faces) is `footprint.longest_side_m`.
"""
from geo_cascadia.buildloc import front_wall_length, road_facing_edge
from geo_cascadia.geo import Frame
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from .minimap import street_lines

SOURCE = ("OpenStreetMap outline: its wall facing the street (the edge nearest the street line, the same wall whose centre "
          "is the building's position; straight continuations joined)")


def road_edge(bundle, b):
    """(frame, outline, {street name: line}, road-facing edge) in metres around the building, or None (no usable outline
    or no street line). The same wall as the Gate 1 reference (tools/eval_gate1.py; the backend's value reproduces the
    stored per-building distances to < 0.005 m) and the pipeline's position rule."""
    fp = b.get("footprint") or {}
    ring = fp.get("polygon_latlon") or []
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
    edge = road_facing_edge(poly, lines.get(b.get("street"))) or \
        road_facing_edge(poly, unary_union(list(lines.values())) if lines else None)
    return (fr, poly, lines, edge) if edge is not None else None


def front_wall(bundle, b):
    """{length_m, edge_m, longest_side_m, street, source} for one building record, or None (no usable outline)."""
    got = road_edge(bundle, b)
    if got is None:
        return None
    fr, poly, lines, edge = got
    fp = b.get("footprint") or {}
    # an export from before D51 still carries the longest side under frontage_m
    longest = fp.get("longest_side_m", fp.get("frontage_m") if "longest_side_m" not in fp else None)
    return {"length_m": front_wall_length(poly, edge), "edge_m": round(edge.length, 1), "longest_side_m": longest,
            "street": b.get("street"), "source": SOURCE,
            "longest_note": "the longer side of the outline's rotated rectangle, whichever way it faces; not the front"}
