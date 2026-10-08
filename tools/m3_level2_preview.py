"""D64 offline preview: what M3 at level 2 (the pipeline's boxpick) does to the saved run of an area, from its files only
(no photo, no model call; the map outlines from the run-era cache / the app's local copy). Read-only: writes nothing.

For each building the production position rule (buildloc.predict_positions, unchanged) is run twice: on today's rays
(each box belongs to the outline its centre line of sight hits first) and on the M3 rays (boxpick.assign). Both are scored
like Trust's Gate 1 "camera-derived" row: distance from the predicted point to the centre of the OSM road-facing wall, for
buildings placed by "triangulated" or "wall_hit". The reference is the same OSM wall the positions use (partly circular).

    backend\\.venv\\Scripts\\python tools\\m3_level2_preview.py [slug ...]      (default: ward29 trichy_bharathidasan_salai)
"""
import json
import os
import statistics
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from shapely.geometry import MultiLineString, Point, Polygon  # noqa: E402

from building_positions import area_model, street_lines  # noqa: E402
from geo_cascadia import boxpick  # noqa: E402
from geo_cascadia.buildloc import building_rays, predict_positions, road_facing_edge  # noqa: E402
from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.geometry import building_views  # noqa: E402


def stats(xs):
    v = sorted(xs)
    return {"n": len(v), "median_m": round(statistics.median(v), 2) if v else None,
            "within_3_5_pct": round(100 * sum(x <= 3.5 for x in v) / len(v), 1) if v else None}


def camera_derived(area, pos, blds, sl):
    F = area.frame
    allg = MultiLineString([g for m in sl.values() for g in m.geoms]) if sl else None
    out = []
    for b in blds:
        p = pos.get(b["building_id"])
        if not p or p["method"] not in ("triangulated", "wall_hit"):
            continue
        poly = Polygon([F.xy(q[0], q[1]) for q in b["footprint_latlon"]])
        edge = road_facing_edge(poly, sl.get(b.get("street")) or allg)
        if edge is None:
            continue
        out.append(edge.interpolate(0.5, normalized=True).distance(Point(F.xy(p["lat"], p["lon"]))))
    return out


def preview(slug, cfg):
    area, dets, blds = area_model(slug, cfg)
    sl = street_lines(slug, area.frame)
    today = predict_positions(dets, area, blds, sl, cfg, rays=building_rays(dets, area))
    m3 = boxpick.assign(dets, area)
    level2 = predict_positions(dets, area, blds, sl, cfg, rays=m3["rays"])
    v_old, v_new = building_views(dets, area), building_views(dets, area, chosen=m3["rays"])
    return {"pairs": boxpick.summary(m3["pairs"]),
            "gate1_camera_derived": {"today": stats(camera_derived(area, today, blds, sl)),
                                     "m3_level2": stats(camera_derived(area, level2, blds, sl))},
            "methods": {"today": dict(sorted(Counter(p["method"] for p in today.values()).items())),
                        "m3_level2": dict(sorted(Counter(p["method"] for p in level2.values()).items()))},
            "building_views": {"today": len(v_old), "m3_level2": len(v_new),
                               "reliable_today": sum(v["reliable"] for v in v_old),
                               "reliable_m3": sum(v["reliable"] for v in v_new)}}


if __name__ == "__main__":
    cfg = Config()
    for s in sys.argv[1:] or ("ward29", "trichy_bharathidasan_salai"):
        print(s, json.dumps(preview(s, cfg)))
