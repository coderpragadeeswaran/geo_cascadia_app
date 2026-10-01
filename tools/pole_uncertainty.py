r"""pole_uncertainty.py — measure single-camera pole error by camera distance (D45) from the saved run files of every area.

    backend\.venv\Scripts\python tools\pole_uncertainty.py [--write]

For every pole triangulated from 2+ camera positions, each single camera's own estimate (direction + rough distance
from where the base meets the ground) is compared with the triangulated point, grouped by that camera's rough distance
(poleunc.single_camera_errors / measure). A consistency check, not surveyed truth; each band's circle is the larger of
its 80th percentile and the notebook's surveyed median (poleunc.SURVEYED_MEDIAN_M). --write stores the table in
data/model_card.json "single_camera_by_distance" (before "gate1_position") (the Trust page reads it). The uncertainty the pipeline uses is
config.single_cam_unc_bands; this tool checks it equals the table's 80th percentiles made non-decreasing with distance.
"""
import argparse
import datetime
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.poleunc import BANDS, measure, single_camera_errors, surveyed_median  # noqa: E402


def fitted(rows):
    """per band: the larger of the 80th percentile and the surveyed median rounded up to 0.5 m, non-decreasing"""
    out, hi = [], 0.0
    for r in rows:
        s = surveyed_median(r["band_m"])
        hi = max(hi, round(r["p80_m"] or 0, 1), math.ceil(s * 2) / 2 if s is not None else 0.0)
        out.append((float(r["band_m"][1]), hi))
    return tuple(out)


def basis(row, used):
    s = surveyed_median(row["band_m"])
    return "surveyed median (notebook)" if s is not None and used > round(row["p80_m"] or 0, 1) else "80th percentile (consistency)"


def main(write):
    cfg, areas, samples = Config(), {}, []
    base = os.path.join(ROOT, "data", "areas")
    for slug in sorted(os.listdir(base)):
        f = os.path.join(base, slug)
        if not all(os.path.isfile(os.path.join(f, n)) for n in ("assets.json", "detections.json")):
            continue
        with open(os.path.join(f, "detections.json"), encoding="utf-8") as fh:
            dets = json.load(fh)
        with open(os.path.join(f, "assets.json"), encoding="utf-8") as fh:
            assets = json.load(fh)
        s = single_camera_errors(dets, assets, cfg)
        areas[slug] = len(s)
        samples += s
    rows = measure(samples, BANDS)
    fit = fitted(rows)
    for r in rows:
        r["surveyed_median_m"] = surveyed_median(r["band_m"])
    block = {"_note": ("Single-camera pole/streetlight position error by camera distance: for poles triangulated from 2+ "
                       "cameras, each camera's own estimate vs the triangulated point (a consistency check, not surveyed "
                       "truth). Only poles two cameras agreed on are in the sample, so far-off single estimates are "
                       "under-represented and real errors can be larger. tools/pole_uncertainty.py."),
             "generated": datetime.date.today().isoformat(), "n": len(samples), "samples_per_area": areas, "bands": rows,
             "used_uncertainty_m": [{"up_to_m": u, "plus_minus_m": v, "basis": basis(r, v)} for r, (u, v) in zip(rows, fit)],
             "rule": ("the map circle = the larger of the band's 80th percentile (consistency check) and the notebook's "
                      "surveyed median for that distance rounded up to 0.5 m, made non-decreasing with distance. The "
                      "surveyed check is larger at 8-15 m (median 4.55 m), so those circles are ±5 m and hold about half "
                      "of such estimates, not 8 in 10"),
             "notebook_surveyed_check": "history chat 1: 0-8 m median 1.64 m (86% within 3.5 m); 8-15 m median 4.55 m (n=1469 detections)"}
    print(json.dumps(block, indent=1))
    if fit != tuple(cfg.single_cam_unc_bands):
        print(f"! config.single_cam_unc_bands {cfg.single_cam_unc_bands} != measured {fit}: update pipeline/geo_cascadia/config.py")
    if write:
        # splice the key in just before "gate1_position" (which tools/eval_gate1.py keeps LAST) without reformatting
        p = os.path.join(ROOT, "data", "model_card.json")
        text = open(p, encoding="utf-8").read()
        key, g = '\n "single_camera_by_distance":', ',\n "gate1_position":'
        if key in text:
            a = text.index(key) - 1                       # the comma before it
            text = text[:a] + text[text.index(g):]
        cut = text.index(g)
        piece = json.dumps(block, indent=1, ensure_ascii=False).replace("\n", "\n ")
        text = text[:cut] + ',\n "single_camera_by_distance": ' + piece + text[cut:]
        json.loads(text)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(text)
        print("model_card.json single_camera_by_distance written")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    main(ap.parse_args().write)
