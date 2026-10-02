"""P8 follow-up (D51): in every saved export.json, `footprint.frontage_m` becomes the building's frontage (its road-facing
wall on the OSM outline, `buildloc.front_wall_length`); the old value (the outline's longest side) moves to
`footprint.longest_side_m`. Saved files only: no model, Street View, Places or OSM call.

    backend\\.venv\\Scripts\\python tools\\frontage_fix.py            # dry run: what would change
    backend\\.venv\\Scripts\\python tools\\frontage_fix.py --write    # write (originals in data/cache/p8fix_before/<slug>/)

Idempotent: a file that already has longest_side_m keeps it. Reload the database afterwards (backend/load_area.py).
"""
import argparse
import json
import os
import shutil
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from app.frontwall import front_wall  # noqa: E402
from app.settings import Settings  # noqa: E402
from app.store import JsonStore  # noqa: E402

SOURCE = "road-facing wall of the OSM outline"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    S = Settings()
    JS = JsonStore(S.areas_dir)
    for slug in sorted(os.listdir(S.areas_dir)):
        path = os.path.join(S.areas_dir, slug, "export.json")
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as f:
            exp = json.load(f)
        bundle = JS.bundle(slug)
        walls = {b["id"]: front_wall(bundle, b) for b in bundle["buildings"]}
        changed, ratios, missing = 0, [], 0
        for b in exp.get("buildings", []):
            fp = b.setdefault("footprint", {})
            longest = fp["longest_side_m"] if "longest_side_m" in fp else fp.get("frontage_m")
            w = walls.get(b["id"])
            new = w["length_m"] if w else None
            missing += new is None
            if new and longest:
                ratios.append(new / longest)
            out = {}
            for k, v in fp.items():                          # keep the key order; insert the two new keys after frontage_m
                if k == "frontage_m":
                    out.update(frontage_m=new, longest_side_m=longest, frontage_source=SOURCE)
                elif k not in ("longest_side_m", "frontage_source"):
                    out[k] = v
            out.setdefault("frontage_m", new)
            out.setdefault("longest_side_m", longest)
            out.setdefault("frontage_source", SOURCE)
            if out != fp:
                changed += 1
            b["footprint"] = out
        short = sum(r < 0.6 for r in ratios)
        print(f"{slug}: {len(exp.get('buildings', []))} buildings, {changed} changed, frontage not found {missing}; "
              f"frontage / longest side median {statistics.median(ratios):.2f}, < 0.6 for {short}" if ratios else f"{slug}: no buildings")
        if a.write and changed:
            bak = os.path.join(ROOT, "data", "cache", "p8fix_before", slug)
            os.makedirs(bak, exist_ok=True)
            if not os.path.exists(os.path.join(bak, "export.json")):
                shutil.copy2(path, os.path.join(bak, "export.json"))
            with open(path, "w", encoding="utf-8") as f:
                json.dump(exp, f)
    if not a.write:
        print("dry run: nothing written (--write to apply)")


if __name__ == "__main__":
    main()
