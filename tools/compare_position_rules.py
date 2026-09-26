"""Compare two variants of the building-position rule (D28), recomputed from saved run files only (detections.json,
buildings.json, streets.json + the cached OSM footprints). No YOLO, OCR, VLM, Street View or Places calls.
The official output (export.json predicted_position) is NOT changed.

  A) triangulated if >= 3 camera positions (D27)
  B) triangulated if >= 2 camera positions (chosen by the owner: the production rule since D28)
Both use the plausibility check (> 10 m from the road-facing wall -> rejected -> wall_hit -> footprint_centre).
Scored against the road-facing OSM wall (buildloc.road_facing_edge): distance of each triangulated point.

Usage:  python tools/compare_position_rules.py [slug ...]
Writes: data/areas/<slug>/rule_variants.json
"""
import json
import math
import os
import statistics
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from shapely.geometry import Point, Polygon  # noqa: E402

from building_positions import area_model, area_slugs, load, street_lines  # noqa: E402
from geo_cascadia.buildloc import building_rays, predict_positions, road_facing_edge  # noqa: E402
from geo_cascadia.config import Config  # noqa: E402

GATE_M = 3.5


def stats(xs):
    xs = sorted(xs)
    if not xs:
        return {"n": 0, "median_m": None, "p90_m": None, "within_3_5_m_pct": None}
    return {"n": len(xs), "median_m": round(statistics.median(xs), 2), "p90_m": round(xs[min(len(xs) - 1, math.ceil(0.9 * len(xs)) - 1)], 2),
            "within_3_5_m_pct": round(100 * sum(x <= GATE_M for x in xs) / len(xs), 1)}


def compare(slug, cfg):
    area, dets, blds = area_model(slug, cfg)
    F = area.frame
    sl = street_lines(slug, F)
    rays = [r for r in building_rays(dets, area) if r["cls"] == "building"]
    V = {k: predict_positions(dets, area, blds, sl, cfg, rays=rays, min_cameras=n) for k, n in (("A", 3), ("B", 2))}
    from shapely.ops import unary_union
    allsl = unary_union(list(sl.values())) if sl else None
    wall = {}
    for b in blds:
        poly = area.footprints[area.idx_of[b["building_id"]]] if b["building_id"] in area.idx_of else \
            Polygon([F.xy(p[0], p[1]) for p in b["footprint_latlon"]])
        wall[b["building_id"]] = road_facing_edge(poly, sl.get(b.get("street"))) or road_facing_edge(poly, allsl)
    out = {"slug": slug, "buildings": len(blds)}
    for k, P in V.items():
        tri = {bid: p for bid, p in P.items() if p["method"] == "triangulated"}
        d = {bid: wall[bid].distance(Point(F.xy(p["lat"], p["lon"]))) for bid, p in tri.items() if wall[bid] is not None}
        counts = Counter(p["method"] for p in P.values())
        out[k] = {"method_counts": {"triangulated": counts["triangulated"], "wall_hit": counts["wall_hit"],
                                    "footprint_centre": counts["footprint_centre"],
                                    "rejected": sum(bool(p["reason"]) for p in P.values())},
                  "triangulated_vs_osm_wall": stats(list(d.values()))}
        if k == "B":
            out[k]["two_camera_only_vs_osm_wall"] = stats([d[b] for b, p in tri.items() if p["n_cameras"] == 2 and b in d])
    # A with the fixed check vs the current official output (export.json, made with the footprint-polygon check)
    off = {b["id"]: (b.get("predicted_position") or {}).get("method") for b in load(slug, "export.json")["buildings"]}
    out["A_vs_official_changes"] = sorted(bid for bid, p in V["A"].items() if p["method"] != off.get(bid))
    with open(os.path.join(ROOT, "data", "areas", slug, "rule_variants.json"), "w", encoding="utf-8") as f:
        json.dump({**out, "reasons": {k: {b: p["reason"] for b, p in P.items() if p["reason"]} for k, P in V.items()}}, f, indent=1)
    return out


if __name__ == "__main__":
    cfg = Config()
    for s in sys.argv[1:] or area_slugs():
        print(json.dumps(compare(s, cfg)))
