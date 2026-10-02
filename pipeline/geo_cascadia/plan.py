"""Capture plan (cell 19) + building register from footprints (cell 20, first half)."""
import math
from collections import defaultdict
from shapely.geometry import Point, MultiLineString
from shapely.ops import linemerge, unary_union
from .area import lines_of


def capture_plan(area, panos, cfg):
    segments = []
    for r in area.streets:
        parts = lines_of(r["geom"])
        merged = parts[0] if len(parts) == 1 else linemerge(MultiLineString(parts))
        for k, ln in enumerate(lines_of(merged)):
            if ln.length >= cfg.min_seg_m:
                segments.append({"street": r["name"], "carriageway": k, "line": ln})
    pano_pts = [Point(area.L(p["camera_lat"], p["camera_lon"])) for p in panos]
    assigned = defaultdict(list)
    for p, pt in zip(panos, pano_pts):
        d, si = min(((s["line"].distance(pt), i) for i, s in enumerate(segments)), default=(999, None))
        if d <= 15:
            assigned[si].append((p, pt))

    plan, anomalies, kept = [], [], defaultdict(list)
    for si, cams in assigned.items():
        seg = segments[si]; line = seg["line"]
        cams.sort(key=lambda c: line.project(c[1]))
        last = -1e9
        for p, pt in cams:
            s = line.project(pt)
            if s - last < cfg.thin_m: continue
            if any(pt.distance(q) < cfg.min_sep_m for q in kept[seg["street"]]): continue
            last = s
            p0 = line.interpolate(min(s, max(line.length - 1, 0))); p1 = line.interpolate(min(s + 1, line.length))
            dx, dy = p1.x - p0.x, p1.y - p0.y
            m = math.hypot(dx, dy) or 1.0
            road_bearing = (math.degrees(math.atan2(dx / m, dy / m)) + 360) % 360
            if area.inside_footprint(pt.x, pt.y):
                anomalies.append({"pano_id": p["pano_id"], "lat": p["camera_lat"], "lon": p["camera_lon"],
                                  "street": seg["street"], "reason": "camera_inside_footprint"}); continue
            views = []
            for side, sgn in (("left", -1), ("right", +1)):
                nx, ny = -sgn * dy / m, sgn * dx / m
                d1, i1 = area.cast(pt.x, pt.y, nx, ny)
                perp = (math.degrees(math.atan2(nx, ny)) + 360) % 360
                if d1 is None or d1 > cfg.side_range_m:
                    # no mapped footprint on this side: still photograph it (poles, lamps, signs, unmapped buildings)
                    views.append({"heading": round(perp, 1), "pitch": 0, "fov": 90, "side": side + "_unmapped",
                                  "footprint": None, "dist_m": None})
                    continue
                views.append({"heading": round(perp, 1), "pitch": 0, "fov": 90, "side": side,
                              "footprint": area.fp_ids[i1], "dist_m": round(d1, 1)})
                if d1 <= cfg.tilt_if_closer_m:
                    views.append({"heading": round(perp, 1), "pitch": cfg.tilt_pitch, "fov": 90,
                                  "side": side + "_tilt", "footprint": area.fp_ids[i1], "dist_m": round(d1, 1)})
                for o in (-cfg.oblique_deg, cfg.oblique_deg):
                    b = (perp + o) % 360
                    d2, i2 = area.cast(pt.x, pt.y, math.sin(math.radians(b)), math.cos(math.radians(b)))
                    if d2 is not None and d2 <= cfg.side_range_m:
                        views.append({"heading": round(b, 1), "pitch": 0, "fov": 90, "side": side + "_oblique",
                                      "footprint": area.fp_ids[i2], "dist_m": round(d2, 1)})
            if not views:
                anomalies.append({"pano_id": p["pano_id"], "lat": p["camera_lat"], "lon": p["camera_lon"],
                                  "street": seg["street"], "reason": "no_footprint_within_40m"}); continue
            kept[seg["street"]].append(pt)
            plan.append({"pano_id": p["pano_id"], "camera_lat": p["camera_lat"], "camera_lon": p["camera_lon"],
                         "source": p.get("source", "google"), "street": seg["street"],
                         "carriageway": seg["carriageway"], "road_bearing": round(road_bearing, 1), "views": views})
    return plan, anomalies


def building_register(area, plan):
    """One record per footprint faced by at least one planned view (cell 20)."""
    faced = defaultdict(list)
    for e in plan:
        for v in e["views"]:
            if v["footprint"] is None: continue
            faced[v["footprint"]].append({"pano_id": e["pano_id"], "heading": v["heading"], "pitch": v["pitch"],
                                          "dist_m": v["dist_m"], "street": e["street"], "side": v["side"]})
    street_line = {r["name"]: unary_union(lines_of(r["geom"])) for r in area.streets}
    out = []
    for fid, views in faced.items():
        poly = area.footprints[area.idx_of[fid]]
        c = poly.centroid
        lat, lon = area.frame.ll(c.x, c.y)
        st = min(street_line.items(), key=lambda kv: kv[1].distance(c))
        xs, ys = poly.minimum_rotated_rectangle.exterior.xy
        sides = [math.dist((xs[i], ys[i]), (xs[i + 1], ys[i + 1])) for i in range(4)]
        out.append({"building_id": fid, "footprint_source": area.fp_source[area.idx_of[fid]],
                    "lat": round(lat, 7), "lon": round(lon, 7),
                    # NB "frontage_m" here is the outline's LONGEST SIDE (internal name kept for saved runs); the export
                    # writes it as footprint.longest_side_m and the real frontage (road-facing wall) as frontage_m (D51)
                    "area_m2": round(poly.area, 1), "frontage_m": round(max(sides[0], sides[1]), 1),
                    "depth_m": round(min(sides[0], sides[1]), 1), "street": st[0],
                    "dist_to_street_m": round(st[1].distance(c), 1), "n_views": len(views),
                    "has_tilt_view": any(v["pitch"] > 0 for v in views), "views": views,
                    "footprint_latlon": [list(area.frame.ll(x, y)) for x, y in poly.exterior.coords]})
    out.sort(key=lambda b: (b["street"], -b["area_m2"]))
    return out
