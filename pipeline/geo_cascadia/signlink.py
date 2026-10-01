"""Signs linked to buildings by their OWN line of sight (D44).

Before D44 a sign crop inherited the outline its photo was planned to face (`footprint_faced`), so a neighbour's sign in
the same 90° photo was credited to the aimed building. Now each sign box casts its own ray from the camera, exactly as
building boxes do (2 m to ray_max_range_m, outline hits >= 1.5 m away).

Safer rule (P7a validation, tools/validate_sign_links.py): moving every sign to the first outline its ray hits moved 47%
of Ward 29's sign crops and, against Google's pins for the same business names, made the building FURTHER from the pin
more often than closer. So a sign moves only when it clearly belongs elsewhere: its ray and the rays
cfg.sign_link_margin_deg either side all hit the same other outline first, and none of the three touches the aimed
outline anywhere along its length. Otherwise it keeps the aimed outline (which may be None: a photo aimed at no mapped
building). A sign with no outline at all (fp None) can become a "business with no analysed building" (unmapped.py).

The ray's direction is the horizontal bearing of the box centre, computed with the photo's pitch (tilted roofline photos
and level photos alike), so every sign photo can be linked. No image, model or network call.
"""
import math
import os

import numpy as np
from shapely.geometry import LineString, Point

from .geo import pixel_to_bearing


def box_bearing(d):
    """Compass bearing (deg) of the centre of a detection box, taking the photo's pitch into account (pinhole camera)."""
    W, H = d.get("W") or 640, d.get("H") or 640
    fov, pitch = float(d.get("fov") or 90), float(d.get("pitch") or 0)
    if not pitch:
        return pixel_to_bearing(d["heading"], d["u"] if d.get("u") is not None else (d["x1"] + d["x2"]) / 2, W, fov)
    h, p = math.radians(d["heading"]), math.radians(pitch)
    fwd = (math.sin(h) * math.cos(p), math.cos(h) * math.cos(p), math.sin(p))       # east, north, up
    right = (math.cos(h), -math.sin(h), 0.0)
    up = (-math.sin(h) * math.sin(p), -math.cos(h) * math.sin(p), math.cos(p))
    F = (W / 2) / math.tan(math.radians(fov) / 2)
    u = (d["x1"] + d["x2"]) / 2
    v = (d["y1"] + d["y2"]) / 2
    dx, dy = (u - W / 2) / F, (H / 2 - v) / F
    e = fwd[0] + dx * right[0] + dy * up[0]
    n = fwd[1] + dx * right[1] + dy * up[1]
    return (math.degrees(math.atan2(e, n)) + 360) % 360


def crop_key(path):
    return os.path.basename(path or "")


def ray_hits(area, x, y, bearing, start_m=2.0, min_hit=1.5):
    """{outline id: distance} for every outline a ray from (x, y) along `bearing` crosses (start_m to area.max_range),
    the same geometry as Area.cast but keeping all hits, not only the first."""
    if area.tree is None:
        return {}
    nx, ny = math.sin(math.radians(bearing)), math.cos(math.radians(bearing))
    ray = LineString([(x + start_m * nx, y + start_m * ny), (x + area.max_range * nx, y + area.max_range * ny)])
    o, out = Point(x, y), {}
    for c in area.tree.query(ray):
        i = int(c) if isinstance(c, (int, np.integer)) else area.footprints.index(c)
        it = ray.intersection(area.footprints[i])
        if not it.is_empty and (d := o.distance(it)) >= min_hit:
            out[area.fp_ids[i]] = min(d, out.get(area.fp_ids[i], d))
    return out


def link_signs(dets, area, margin_deg=4.0):
    """{crop file name: {"fp": outline id or None, "dist_m": hit distance or None, "planned": footprint_faced,
    "bearing", "rule": "own_ray" | "kept_aimed"}} for every signboard detection that has a crop (see the module note)."""
    out = {}
    for d in dets:
        if d.get("cls") != "signboard" or not d.get("crop"):
            continue
        b = box_bearing(d)
        planned = d.get("footprint_faced")
        cx, cy = area.L(d["camera_lat"], d["camera_lon"])
        hits = [ray_hits(area, cx, cy, b + s * margin_deg) for s in (-1, 0, 1)]
        first = [min(h, key=h.get) if h else None for h in hits]
        clear = first[1] is not None and first[0] == first[1] == first[2] and first[1] != planned
        move = clear and not any(planned in h for h in hits)
        fp = first[1] if move else planned
        dist = hits[1].get(fp) if fp else None
        out[crop_key(d["crop"])] = {"fp": fp, "dist_m": round(dist, 1) if dist is not None else None,
                                    "planned": planned, "bearing": round(b, 2), "rule": "own_ray" if move else "kept_aimed"}
    return out


def relink_ocr(ocr_res, links):
    """Copy of the OCR records with `fp` = the outline link_signs credits the sign to (None = no outline) and `fp_planned` = the
    outline the photo was aimed at. Records whose crop has no link (should not happen) keep their fp."""
    out = []
    for r in ocr_res:
        k = crop_key(r.get("file"))
        r = dict(r)
        planned = r.get("fp_planned", r.get("fp"))
        r["fp_planned"] = planned
        if k in links:
            r["fp"] = links[k]["fp"]
            r["sign_dist_m"] = links[k]["dist_m"]
            r["sign_bearing"] = links[k]["bearing"]
        out.append(r)
    return out


def ocr_names(ocr_res):
    """Best tier-2 read per building (the same rule as ocr.run_ocr's names), from (re-linked) OCR records."""
    names = {}
    for r in ocr_res:
        if r.get("tier") == 2 and r.get("fp") and r.get("best"):
            if r["fp"] not in names or r["best_conf"] > names[r["fp"]][1]:
                names[r["fp"]] = (r["best"], r["best_conf"])
    return names


def relink_vlm_names(vlm_names, ocr_res):
    """The cloud model's sign readings follow their crop to its new building (no new call): fp = the re-linked OCR
    record's fp for the same crop file. A reading whose sign now hits no outline is dropped from building names."""
    by_file = {crop_key(r.get("file")): r.get("fp") for r in ocr_res}
    out = []
    for w in vlm_names:
        k = crop_key(w.get("file"))
        if k in by_file:
            if by_file[k] is None:
                continue
            w = {**w, "fp_planned": w.get("fp_planned", w.get("fp")), "fp": by_file[k]}
        out.append(w)
    return out
