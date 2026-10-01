r"""validate_sign_links.py — check D44's sign moves against Google, from saved files only (no API call).

    backend\.venv\Scripts\python tools\validate_sign_links.py data/areas/<slug> [...] [--plain] [--json out.json]

For every READ sign (OCR tier 2 or the cloud model's reading, tier 3) whose name matches a Google business listing in the
run's cached Nearby searches (textmatch.same_business, the app's Google check; listing within 60 m of the camera, the
nearest such listing if several), the Google pin is used as an independent reference: is the sign's building under the
aimed-photo rule (old, pre-D44) or under its own line of sight (new) nearer to the pin?
Distance = metres from the pin to the outline (0 inside it); "no outline" signs are counted, not measured.
Also per moved sign: the gap between the old and new outline (adjacent < 5 m) and the angle between the sign's ray and
the photo's aim. Pins are Google's, not surveyed: an agreement check, not ground truth.
Default: the pipeline's rule (signlink.link_signs with cfg.sign_link_margin_deg). --plain: the first D44 rule (every sign
to the first outline its ray hits, None when it hits nothing), for the before/after comparison.
"""
import argparse
import json
import math
import os
import statistics
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from shapely.geometry import Point  # noqa: E402

from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.reference import _kept, places_from_cache  # noqa: E402
from geo_cascadia.signlink import box_bearing, crop_key, link_signs  # noqa: E402
from geo_cascadia.textmatch import same_business  # noqa: E402
from p7a_reapply import area_model, load  # noqa: E402

SAME_M = 1.0          # |Δ distance| below this counts as "same"
ADJ_M = 5.0           # outlines closer than this are "adjacent"
PIN_RADIUS_M = 60.0


def angle_diff(a, b):
    return abs((a - b + 180) % 360 - 180)


def plain_rule(dets, area):
    """the first D44 rule: the first outline the sign's own ray hits (Area.cast), None when it hits none"""
    out = {}
    for d in dets:
        if d.get("cls") == "signboard" and d.get("crop"):
            b = box_bearing(d)
            x, y = area.L(d["camera_lat"], d["camera_lon"])
            _, i = area.cast(x, y, math.sin(math.radians(b)), math.cos(math.radians(b)))
            out[crop_key(d["crop"])] = {"fp": area.fp_ids[i] if i is not None else None, "planned": d.get("footprint_faced")}
    return out


def sign_rows(folder, cfg, rule=None):
    """one row per signboard crop: old (planned) and new (rule) outline, read name, ray and aim angles."""
    dets, ocr = load(folder, "detections"), load(folder, "ocr")
    vn = {crop_key(w.get("file")): (w.get("vlm") or {}) for w in load(folder, "vlm_names", [])}
    area = area_model(folder, dets, cfg)
    links = rule(dets, area) if rule else link_signs(dets, area, cfg.sign_link_margin_deg)
    by_crop = {crop_key(d["crop"]): d for d in dets if d.get("cls") == "signboard" and d.get("crop")}
    rows = []
    for r in ocr:
        k = crop_key(r.get("file"))
        d, l = by_crop.get(k), links.get(k)
        if d is None or l is None:
            continue
        name = r.get("best") if r.get("tier") == 2 else ((vn.get(k) or {}).get("business_name") if r.get("tier") == 3 else None)
        rows.append({"crop": k, "tier": r.get("tier"), "name": name or None, "old": r.get("fp_planned", r.get("fp")),
                     "new": l["fp"], "ray_vs_aim_deg": round(angle_diff(box_bearing(d), d["heading"]), 1),
                     "cam": area.L(d["camera_lat"], d["camera_lon"])})
    return rows, area


def outline(area, fid):
    return area.footprints[area.fp_ids.index(fid)] if fid in area.fp_ids else None


def measure(folder, cfg, rule=None):
    rows, area = sign_rows(folder, cfg, rule)
    biz = [p for p in _kept(area, places_from_cache(load(folder, "places_cache", {}))) if p["cat"] != "home"]
    moved = [r for r in rows if r["new"] != r["old"]]
    read_moved = [r for r in moved if r["name"]]
    out = {"area": os.path.basename(os.path.normpath(folder)), "sign_crops": len(rows), "moved": len(moved),
           "read_signs": sum(1 for r in rows if r["name"]), "read_moved": len(read_moved)}
    # adjacency + ray angle over every moved crop with both outlines
    gaps, adj = [], Counter()
    for r in moved:
        a, b = outline(area, r["old"]), outline(area, r["new"])
        if a is None or b is None:
            adj["to_or_from_no_outline"] += 1
            continue
        g = a.distance(b)
        gaps.append(g)
        adj["adjacent_<5m" if g < ADJ_M else "distant_>=5m"] += 1
    out["moves_by_gap"] = dict(adj)
    out["gap_median_m"] = round(statistics.median(gaps), 1) if gaps else None
    ang = [r["ray_vs_aim_deg"] for r in moved]
    out["ray_vs_aim_deg"] = {"moved_median": round(statistics.median(ang), 1) if ang else None,
                             "unmoved_median": round(statistics.median([r["ray_vs_aim_deg"] for r in rows if r["new"] == r["old"]]), 1),
                             "moved_<10": sum(a < 10 for a in ang), "moved_10-25": sum(10 <= a < 25 for a in ang),
                             "moved_>=25": sum(a >= 25 for a in ang)}

    # Google check: every read sign whose name is a Google listing near its camera
    def pin_for(r):
        c = [p for p in biz if math.dist(r["cam"], (p["x"], p["y"])) <= PIN_RADIUS_M and same_business(r["name"], p["name"])]
        return min(c, key=lambda p: math.dist(r["cam"], (p["x"], p["y"]))) if c else None

    def dist(fid, pin):
        o = outline(area, fid)
        return None if o is None else o.distance(Point(pin["x"], pin["y"]))

    res, deltas, nearest = Counter(), [], Counter()
    unmoved_hits = Counter()
    for r in rows:
        if not r["name"]:
            continue
        pin = pin_for(r)
        if pin is None:
            continue
        if r["new"] == r["old"]:
            d = dist(r["old"], pin)
            unmoved_hits["n"] += 1
            if d is not None:
                unmoved_hits["pin_within_5m_of_outline"] += d <= 5
            continue
        do, dn = dist(r["old"], pin), dist(r["new"], pin)
        if do is None or dn is None:
            res["to_or_from_no_outline"] += 1
            continue
        delta = dn - do                                       # < 0: new building nearer the Google pin
        deltas.append(delta)
        res["closer" if delta < -SAME_M else "further" if delta > SAME_M else "same_±1m"] += 1
        # which outline is nearest to the Google pin at all
        best = min(area.tree.query(Point(pin["x"], pin["y"]).buffer(30)), default=None,
                   key=lambda i: area.footprints[int(i)].distance(Point(pin["x"], pin["y"])))
        bid = area.fp_ids[int(best)] if best is not None else None
        nearest["pin_nearest_is_new" if bid == r["new"] else "pin_nearest_is_old" if bid == r["old"] else "pin_nearest_is_other"] += 1
    out["google"] = {"read_moved_with_google_pin": sum(res.values()), **dict(res),
                     "median_change_m": round(statistics.median(deltas), 1) if deltas else None,
                     "changes_m": sorted(round(x, 1) for x in deltas), **dict(nearest),
                     "unmoved_with_google_pin": unmoved_hits["n"],
                     "unmoved_pin_within_5m": unmoved_hits["pin_within_5m_of_outline"]}
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("folders", nargs="+")
    ap.add_argument("--plain", action="store_true", help="the first D44 rule instead of the pipeline's rule")
    ap.add_argument("--json")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    cfg = Config()
    res = [measure(f, cfg, plain_rule if a.plain else None) for f in a.folders]
    for r in res:
        print(json.dumps({**r, "google": {k: v for k, v in r["google"].items() if k != "changes_m"}}, ensure_ascii=False))
    pooled = [x for r in res for x in r["google"]["changes_m"]]
    if len(res) > 1 and pooled:
        print(json.dumps({"all_areas": {"measured": len(pooled), "closer": sum(x < -SAME_M for x in pooled),
                                        "further": sum(x > SAME_M for x in pooled), "same_±1m": sum(abs(x) <= SAME_M for x in pooled),
                                        "median_change_m": round(statistics.median(pooled), 1)}}, ensure_ascii=False))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(res, f, indent=1, ensure_ascii=False)
