"""Detections -> located assets, streetlights, signs per building, building attribute views
(cells 21, 23, 24, 65, 68). Only geom_ok detections (level Google car views) are used."""
import math
from collections import defaultdict
import numpy as np
from .geo import pixel_to_bearing, haversine, triangulate_multiview


def _rough_distance(v_base, H, fov, cfg):
    if v_base >= H - 4: return None
    ratio = (2.0 * v_base / H - 1.0) * math.tan(math.radians(fov) / 2.0)
    if ratio < cfg.min_ratio: return None
    d = cfg.cam_h / ratio
    return d if d <= cfg.rough_max_d else None


def _ray(d, frame, cfg):
    b = pixel_to_bearing(d["heading"], d["u"], d["W"], d["fov"])
    dist = _rough_distance(d["v_base"], d["H"], d["fov"], cfg) if d.get("v_base") is not None else None
    cx, cy = frame.xy(d["camera_lat"], d["camera_lon"])
    if dist is None:
        return {**d, "bearing": b, "dist": None, "x": None, "y": None, "cx": cx, "cy": cy}
    return {**d, "bearing": b, "dist": dist, "cx": cx, "cy": cy,
            "x": cx + dist * math.sin(math.radians(b)), "y": cy + dist * math.cos(math.radians(b))}


def locate_assets(dets, frame, cfg):
    from sklearn.cluster import DBSCAN                    # here, so building_views also runs on the laptop (D64 preview)
    rays, assets = [_ray(d, frame, cfg) for d in dets], []

    def solve(members):
        lat = lon = resid = None; used = len({m["pano_id"] for m in members})
        if len(members) >= 2:
            out = triangulate_multiview([(m["camera_lat"], m["camera_lon"]) for m in members],
                                        [m["bearing"] for m in members])
            if out:
                lat, lon = out["lat"], out["lon"]; resid = float(max(out["residuals_m"])); used = len(out["cameras_used"])
        if lat is None:
            lat, lon = frame.ll(float(np.mean([m["x"] for m in members])), float(np.mean([m["y"] for m in members])))
        return {"members": members, "lat": lat, "lon": lon, "resid": resid, "used": used}

    for cls in sorted({r["cls"] for r in rays}):
        grp = [r for r in rays if r["cls"] == cls]
        seen, placed = set(), []
        for r in sorted([r for r in grp if r["x"] is not None], key=lambda r: -r.get("conf", 0)):
            k = (r["pano_id"], r["heading"], round(r["bearing"] / 3.0))
            if k in seen: continue
            seen.add(k); placed.append(r)
        orphan = [r for r in grp if r["x"] is None]
        solved = []
        if placed:
            labels = DBSCAN(eps=cfg.eps_m, min_samples=1).fit([[r["x"], r["y"]] for r in placed]).labels_
            solved = [solve([r for r, l in zip(placed, labels) if l == lab]) for lab in sorted(set(labels))]
        changed = True
        while changed and len(solved) > 1:
            changed = False
            for i in range(len(solved)):
                for j in range(i + 1, len(solved)):
                    if haversine(solved[i]["lat"], solved[i]["lon"], solved[j]["lat"], solved[j]["lon"]) <= cfg.merge_m:
                        pooled = solve(solved[i]["members"] + solved[j]["members"])
                        solved = [s for k, s in enumerate(solved) if k not in (i, j)] + [pooled]
                        changed = True; break
                if changed: break
        for s in solved:
            conf = "high" if s["used"] >= 2 else ("medium" if len(s["members"]) >= 2 else "low")
            assets.append({"cls": cls, "lat": round(s["lat"], 7), "lon": round(s["lon"], 7),
                           "n_detections": len(s["members"]), "cameras_used": s["used"],
                           "max_residual_m": None if s["resid"] is None else round(s["resid"], 2),
                           "confidence": conf, "method": "triangulated" if s["resid"] is not None else "rough_mean",
                           "pano_ids": sorted({m["pano_id"] for m in s["members"]}),
                           "streets": sorted({m["street"] for m in s["members"]}),
                           "mean_det_conf": round(float(np.mean([m.get("conf", 1.0) for m in s["members"]])), 3)})
        if orphan:
            assets.append({"cls": cls, "lat": None, "lon": None, "n_detections": len(orphan), "cameras_used": 0,
                           "max_residual_m": None, "confidence": "review", "method": "hidden_base_direction_only",
                           "pano_ids": sorted({o["pano_id"] for o in orphan}), "streets": [], "mean_det_conf": None})
    return assets


def fuse_and_vote_streetlights(assets, dets, frame, cfg):
    """pole + lamp_head at one spot = streetlight (cell 21), then lamp rays passing a pole (cell 24)."""
    poles = [a for a in assets if a["cls"] == "pole" and a["lat"]]
    lamps = [a for a in assets if a["cls"] == "lamp_head" and a["lat"]]
    out, used = [], set()
    for p in poles:
        px, py = frame.xy(p["lat"], p["lon"])
        near = [l for l in lamps if math.dist((px, py), frame.xy(l["lat"], l["lon"])) <= cfg.lamp_fuse_m]
        if near:
            used.add(id(near[0])); out.append({**p, "cls": "streetlight", "fused_from": ["pole", "lamp_head"]})
        else:
            out.append(p)
    out += [a for a in assets if a["cls"] not in ("pole", "lamp_head")]
    out += [l for l in lamps if id(l) not in used]
    poles = [a for a in out if a["cls"] == "pole" and a["lat"]]
    pxy = [frame.xy(a["lat"], a["lon"]) for a in poles]
    votes = defaultdict(list)
    for d in dets:
        if d["cls"] != "lamp_head" or not d["geom_ok"]: continue
        b = pixel_to_bearing(d["heading"], d["u"], d["W"], d["fov"])
        cx, cy = frame.xy(d["camera_lat"], d["camera_lon"])
        dx, dy = math.sin(math.radians(b)), math.cos(math.radians(b))
        for i, (px, py) in enumerate(pxy):
            along = (px - cx) * dx + (py - cy) * dy
            if along <= 0 or along > 40: continue
            miss = abs(-dy * (px - cx) + dx * (py - cy))
            if miss <= cfg.lamp_miss_m: votes[i].append(miss)
    for i, v in votes.items():
        poles[i]["cls"] = "streetlight"; poles[i]["light_votes"] = len(v)
        poles[i]["light_miss_m"] = round(float(np.mean(v)), 2)
    return out


def signs_by_building(dets, area):
    """Each signboard ray -> first footprint it hits (cell 23B)."""
    by_fp = defaultdict(list)
    for d in dets:
        if d["cls"] != "signboard" or not d["geom_ok"]: continue
        b = pixel_to_bearing(d["heading"], d["u"], d["W"], d["fov"])
        cx, cy = area.L(d["camera_lat"], d["camera_lon"])
        dist, idx = area.cast(cx, cy, math.sin(math.radians(b)), math.cos(math.radians(b)))
        if idx is not None:
            by_fp[area.fp_ids[idx]].append({**d, "ray_dist_m": round(dist, 1)})
    return dict(by_fp)


def building_views(dets, area, edge=0.02, max_h_m=22.0, chosen=None):
    """Best view per building for the VLM + the box-quality gate (cells 65 + 68).
    chosen (D64): boxpick.assign()'s rays — each building's box per photo chosen by M3, with its distance; the building's
    view is then picked among those boxes only (the box shown = the box read = the box positioned). None: the pre-D64 rule
    (a box belongs to the outline its centre line of sight hits first)."""
    bld = [d for d in dets if d["cls"] == "building" and d["geom_ok"]]
    per_view = defaultdict(int)
    for d in bld: per_view[(d["pano_id"], d["heading"], d["pitch"])] += 1
    by_fp = defaultdict(list)
    shape = lambda d, dist: {"ray_dist_m": round(dist, 1), "w_frac": round((d["x2"] - d["x1"]) / d["W"], 3),
                             "h_frac": round((d["y2"] - d["y1"]) / d["H"], 3),
                             "boxes_in_view": per_view[(d["pano_id"], d["heading"], d["pitch"])]}
    if chosen is not None:
        for r in chosen:
            if r.get("ray_dist_m") is None: continue
            d = {k: v for k, v in r.items() if k not in ("bearing", "cx", "cy", "hit_m", "fp", "ray_dist_m")}
            by_fp[r["fp"]].append({**d, **shape(d, r["ray_dist_m"]), "box_rule": "M3"})
    for d in (bld if chosen is None else []):
        b = pixel_to_bearing(d["heading"], d["u"], d["W"], d["fov"])
        cx, cy = area.L(d["camera_lat"], d["camera_lon"])
        dist, idx = area.cast(cx, cy, math.sin(math.radians(b)), math.cos(math.radians(b)))
        if idx is not None:
            by_fp[area.fp_ids[idx]].append({**d, **shape(d, dist)})
    rank = lambda d: (0 if (d["w_frac"] >= 0.92 and d["h_frac"] >= 0.92) else 1,
                      0 if d["y1"] <= d["H"] * edge else 1, -abs(d["w_frac"] - 0.55), d["conf"])
    out = []
    for fp, ds in by_fp.items():
        ds.sort(key=rank, reverse=True); q = ds[0]
        focal = (q["W"] / 2) / math.tan(math.radians(q["fov"]) / 2)
        h_px, w_px = q["y2"] - q["y1"], max(q["x2"] - q["x1"], 1)
        h_m = q["ray_dist_m"] * h_px / focal
        full = q["w_frac"] >= 0.92 and q["h_frac"] >= 0.92
        top_cut, bottom_cut = q["y1"] <= q["H"] * edge, q["y2"] >= q["H"] * (1 - edge)
        side_cut = q["x1"] <= q["W"] * 0.03 or q["x2"] >= q["W"] * 0.97
        sliver = side_cut and h_px / w_px >= 1.1
        out.append({"fp": fp, **{k: q[k] for k in ("pano_id", "heading", "pitch", "fov", "W", "H",
                                                  "x1", "y1", "x2", "y2", "ray_dist_m", "w_frac", "h_frac")},
                    "det_conf": q["conf"], "n_views": len(ds), "full_frame": full, "top_cut": top_cut,
                    "bottom_cut": bottom_cut, "sliver": sliver,
                    "reliable": not (top_cut or bottom_cut or full or sliver or h_m > max_h_m),
                    **({"box_rule": "M3", "m3_score": q.get("m3_score")} if q.get("box_rule") else {})})
    return out
