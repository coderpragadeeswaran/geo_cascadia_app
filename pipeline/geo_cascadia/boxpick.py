"""Which building box is "this building" in a photo: M3, occlusion-aware visible span (D62 rule; level 2 since D64).

The detector finds building boxes in a photo; it does not say which building each box is. Before D64 the pipeline gave a
building the box whose CENTRE line of sight hit its outline first (geometry.building_views, buildloc.building_rays). That
picks a wrong box on about a quarter of photos (Part 2 experiment: a small building in front of a big one takes the big
one's box; a compound wall gets the house's box). M3 instead compares each box's horizontal extent with the part of the
building's outline the camera can SEE, after nearer outlines hide what is behind them:
  - one line of sight per 4 px image column (161 per 640 px photo), cast into every outline within 60 m (from 1.5 m out;
    outlines the camera stands in are skipped); the first outline each line meets is what that column sees;
  - the building's visible columns V = columns whose first outline is the building;
  - each building box's columns S = columns between its left and right edge (the nearest column for a sliver);
  - score = |S ∩ V| / |S ∪ V| (3 decimals); the box with the highest score (ties: detector confidence) is the building's,
    unless the best score is below 0.4: then "none" (can't tell which box is this building in this photo).
Parameters frozen in the Part 2 experiment (development half only; test half scored once: n = 33, 84.8 % correct, 12.1 %
wrong box; today's rule 75.8 % / 24.2 %). Not re-tuned.

Level 2 (D64): the chosen box is the one the analysis USES — the building's evidence photo and its box (attribute view),
the box the cloud model reads use and floors from, and the camera ray for the building's position. "none" = that photo
gives the building no box and no camera position (its other photos, or the map outline, still apply).

Which (building, photo) pairs are decided: every pair today's rule makes (a building box's centre line of sight meets the
building first), exactly as the experiment's Gate 1 what-if did; the photo's candidates are all its building boxes.
The backend's box_choice (D62) imports first_hits / span / choose from here: one rule.
"""
import math
from collections import defaultdict

from .geo import pixel_to_bearing

STEP = 4
COLS = list(range(0, 641, STEP))
MAX_R = 60.0
START_M = 1.5
MIN_OVERLAP = 0.4
RULE = ("M3 visible span: per 4 px image column, the first building outline the camera's line of sight meets (60 m, "
        "outlines the camera stands in skipped); the box whose columns best overlap the building's visible columns "
        f"(IoU; ties by detector confidence); none below {MIN_OVERLAP}")


def view_of(d):
    """one photo: (panorama, heading, pitch, fov)"""
    return (d["pano_id"], float(d["heading"]), float(d.get("pitch") or 0), float(d.get("fov") or 90))


def first_hits(a, cam, heading, pitch, fov, with_dist=False):
    """per image column: the first outline id its line of sight meets (None: nothing within 60 m); with_dist: (id, metres)"""
    from shapely.geometry import LineString, Point, box as sbox
    near = [int(i) for i in a.tree.query(sbox(cam[0] - MAX_R, cam[1] - MAX_R, cam[0] + MAX_R, cam[1] + MAX_R))]
    polys = [(a.fp_ids[i], a.footprints[i]) for i in near]
    P = Point(cam)
    own = {fp for fp, p in polys if p.contains(P)}
    out = []
    for u in COLS:
        r = math.radians(pixel_to_bearing(heading, u, 640, fov))
        ray = LineString([(cam[0] + START_M * math.sin(r), cam[1] + START_M * math.cos(r)),
                          (cam[0] + MAX_R * math.sin(r), cam[1] + MAX_R * math.cos(r))])
        best = None
        for fp, p in polys:
            if fp in own:
                continue
            it = ray.intersection(p)
            if it.is_empty:
                continue
            d = P.distance(it)
            if best is None or d < best[0]:
                best = (d, fp)
        out.append(((best[1], best[0]) if best else (None, None)) if with_dist else (best[1] if best else None))
    return out


def span(x1, x2):
    s = [i for i, u in enumerate(COLS) if x1 <= u <= x2]
    return s or [min(range(len(COLS)), key=lambda i: abs(COLS[i] - (x1 + x2) / 2))]


def choose(first, target, boxes):
    """M3 on one photo: (the chosen box or None, its score, every box's score)"""
    V = {i for i, fp in enumerate(first) if fp == target}
    scored = []
    for b in boxes:
        S = set(span(b["x1"], b["x2"]))
        scored.append((round(len(S & V) / len(S | V), 3) if S | V else 0.0, b))      # rounded as in the experiment
    if not scored:
        return None, 0.0, []
    s, b = max(scored, key=lambda t: (t[0], t[1]["conf"]))
    return (b if s >= MIN_OVERLAP else None), s, scored


def _centre_cast(d, area):
    b = pixel_to_bearing(d["heading"], d["u"], d["W"], d["fov"])
    cx, cy = area.L(d["camera_lat"], d["camera_lon"])
    dist, idx = area.cast(cx, cy, math.sin(math.radians(b)), math.cos(math.radians(b)))
    return b, cx, cy, dist, (area.fp_ids[idx] if idx is not None else None)


def _distance_to(area, d, fp, hits, bearing, cx, cy, own_fp, own_dist):
    """metres from the camera to building `fp` as seen in box d: the box centre's own hit when it IS this building (the
    pre-D64 value); else where the centre line of sight crosses this outline; else the nearest visible column in the box"""
    from shapely.geometry import LineString, Point
    if own_fp == fp and own_dist is not None:
        return own_dist
    r = math.radians(bearing)
    ray = LineString([(cx + START_M * math.sin(r), cy + START_M * math.cos(r)),
                      (cx + MAX_R * math.sin(r), cy + MAX_R * math.cos(r))])
    it = ray.intersection(area.footprints[area.idx_of[fp]])
    if not it.is_empty:
        return Point(cx, cy).distance(it)
    ds = [hits[i][1] for i in span(d["x1"], d["x2"]) if hits[i][0] == fp]
    return min(ds) if ds else None


def assign(dets, area):
    """M3 for every (building, photo) pair today's rule makes.
    Returns {"rays": [...], "pairs": [...]}:
      rays  — one per pair with a chosen box: the chosen detection as buildloc.building_rays makes it (bearing / cx / cy /
              hit_m of its own centre line of sight) with "fp" = the building, "ray_dist_m" = metres to this building
              (see _distance_to) and "m3_score"; the input of buildloc.predict_positions and geometry.building_views;
      pairs — every decision, for the record (box_pairs.json): building, photo, status "box" | "none", score, the chosen
              box and the box today's rule would have used."""
    by_view = defaultdict(list)
    for i, d in enumerate(dets):
        by_view[view_of(d)].append(i)
    cast = {}
    pairs = {}                                           # (fp, photo) -> today's box (highest confidence), insertion order
    for i, d in enumerate(dets):
        if d["cls"] != "building" or not d.get("geom_ok"):
            continue
        cast[i] = _centre_cast(d, area)
        fp = cast[i][4]
        if fp is None:
            continue
        k = (fp, view_of(d))
        if k not in pairs or d["conf"] > dets[pairs[k]]["conf"]:
            pairs[k] = i
    hits_of, rays, out = {}, [], []
    for (fp, vk), i0 in pairs.items():
        if fp not in area.idx_of:
            continue
        ids = by_view[vk]
        bld = [j for j in ids if dets[j]["cls"] == "building"]
        d0 = dets[i0]
        if vk not in hits_of:
            hits_of[vk] = first_hits(area, area.L(d0["camera_lat"], d0["camera_lon"]), vk[1], vk[2], vk[3], with_dist=True)
        hits = hits_of[vk]
        boxes = [{**dets[j], "_j": j} for j in bld]
        b, s, _ = choose([h[0] for h in hits], fp, boxes)
        j = b["_j"] if b is not None else None
        if j is not None and j not in cast:              # a box that is not a level Google-car box gives no ray
            j = None
        rec = {"fp": fp, "pano_id": vk[0], "heading": vk[1], "pitch": vk[2], "fov": vk[3], "score": s,
               "status": "box" if j is not None else "none",
               "box": [dets[j][k] for k in ("x1", "y1", "x2", "y2")] if j is not None else None,
               "old_box": [d0[k] for k in ("x1", "y1", "x2", "y2")], "changed": j is not None and j != i0}
        out.append(rec)
        if j is None:
            continue
        d = dets[j]
        bearing, cx, cy, dist, own = cast[j]
        rays.append({**d, "bearing": bearing, "cx": cx, "cy": cy, "hit_m": dist, "fp": fp, "m3_score": s,
                     "ray_dist_m": _distance_to(area, d, fp, hits, bearing, cx, cy, own, dist)})
    return {"rays": rays, "pairs": out}


def summary(pairs):
    """counts for the run report: pairs decided, given a box, none, box changed from today's rule"""
    n = len(pairs)
    box = sum(p["status"] == "box" for p in pairs)
    return {"rule": "M3", "pairs": n, "box": box, "none": n - box, "changed": sum(bool(p["changed"]) for p in pairs)}
