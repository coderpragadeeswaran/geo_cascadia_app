r"""sign_spotcheck.py — P7.4: a random sample of sign moves (D44) for a person (or an AI first pass) to check by eye.

    backend\.venv\Scripts\python tools\sign_spotcheck.py data/areas/ward29 [--n 20] [--seed 2026]

A "move" is a sign crop whose building under D44 (its own line of sight, 4° margin) differs from the building its photo
was aimed at. Samples are drawn uniformly at random (fixed seed, so the sample is reproducible) from ALL moves, including
moves to or from "no outline". Per sample: the photo (panorama, heading, pitch, fov — the browser fetches it from Google;
nothing is stored), the sign box, the camera, the line of sight (bearing), the old outline (aimed at) and the new outline
(linked), each with its centre ("pin"). Writes <area>/sign_spotcheck.json; reads saved files only (OSM outlines from the
local cache, as tools/p7a_reapply.py), no API call.
"""
import argparse
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "pipeline"), os.path.join(ROOT, "tools")]

from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.signlink import box_bearing, crop_key  # noqa: E402
from p7a_reapply import area_model, load  # noqa: E402


def outline(area, fp):
    if not fp or fp not in area.idx_of:
        return None
    poly = area.footprints[area.idx_of[fp]]
    ring = [list(map(lambda v: round(v, 7), area.frame.ll(x, y)))[::-1] for x, y in poly.exterior.coords]   # [lon, lat]
    c = poly.centroid
    la, lo = area.frame.ll(c.x, c.y)
    return {"id": fp, "ring": ring, "pin": [round(lo, 7), round(la, 7)]}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=2026)
    a = ap.parse_args()
    folder = os.path.abspath(a.folder)
    links = load(folder, "sign_links")
    dets = load(folder, "detections")
    by_crop = {crop_key(d.get("crop")): d for d in dets if d.get("cls") == "signboard" and d.get("crop")}
    moves = sorted(k for k, v in links.items() if (v or {}).get("fp") != (v or {}).get("planned") and k in by_crop)
    rng = random.Random(a.seed)
    pick = rng.sample(moves, min(a.n, len(moves)))
    area = area_model(folder, dets, Config())
    samples = []
    for i, k in enumerate(pick):
        d, v = by_crop[k], links[k]
        samples.append({"n": i + 1, "crop": k, "pano_id": d["pano_id"], "heading": d["heading"], "pitch": d.get("pitch") or 0,
                        "fov": d.get("fov") or 90, "box": {q: round(float(d[q]), 1) for q in ("x1", "y1", "x2", "y2")},
                        "conf": round(float(d.get("conf") or 0), 2), "camera": [d["camera_lon"], d["camera_lat"]],
                        "bearing": round(box_bearing(d), 1), "dist_m": v.get("dist_m"),
                        "old": outline(area, v.get("planned")), "new": outline(area, v.get("fp")),
                        "old_id": v.get("planned"), "new_id": v.get("fp")})
    doc = {"area": os.path.basename(folder), "seed": a.seed, "moves_total": len(moves), "sign_crops": len(links),
           "rule": "a sign belongs to the outline its own line of sight hits; it moves off the outline the photo was aimed at "
                   "only when that ray and the rays 4° either side all hit the same other outline and none touches the aimed one",
           "samples": samples}
    with open(os.path.join(folder, "sign_spotcheck.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    print(f"{doc['area']}: {len(samples)} of {len(moves)} moves sampled (seed {a.seed}); "
          f"{sum(1 for s in samples if s['new'] is None)} to no outline, {sum(1 for s in samples if s['old'] is None)} from no outline")


if __name__ == "__main__":
    main()
