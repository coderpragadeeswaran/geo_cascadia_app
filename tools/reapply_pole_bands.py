r"""D65: re-apply the single-camera pole / streetlight circles (config.single_cam_unc_bands) to the saved areas, from their
own files: every asset not placed by triangulation gets uncertainty_m and uncertainty_basis for its stored camera distance
(poleunc.uncertainty_for, export.single_camera_basis), exactly as a new run would. Hidden areas (a backup) are left as they
were. Writes export.json + export.geojson; then reload the areas (backend/load_area.py --all).

    backend\.venv\Scripts\python tools\reapply_pole_bands.py [--write]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.export import single_camera_basis, to_geojson  # noqa: E402
from geo_cascadia.poleunc import uncertainty_for  # noqa: E402


def main(write):
    cfg, base = Config(), os.path.join(ROOT, "data", "areas")
    for slug in sorted(os.listdir(base)):
        f = os.path.join(base, slug)
        p = os.path.join(f, "export.json")
        if not os.path.isfile(p) or os.path.isfile(os.path.join(f, "hidden.json")):
            continue
        exp = json.load(open(p, encoding="utf-8"))
        changed = 0
        for a in exp.get("assets") or []:
            if a.get("method") == "triangulated" or "camera_distance_m" not in a:
                continue
            u, b = uncertainty_for(a["camera_distance_m"], cfg), single_camera_basis(a["camera_distance_m"], cfg)
            if (a.get("uncertainty_m"), a.get("uncertainty_basis")) != (u, b):
                a["uncertainty_m"], a["uncertainty_basis"] = u, b
                changed += 1
        print(f"{slug:50} {changed} assets changed")
        if write and changed:
            json.dump(exp, open(p, "w", encoding="utf-8"))
            json.dump(to_geojson(exp), open(os.path.join(f, "export.geojson"), "w", encoding="utf-8"))


if __name__ == "__main__":
    main("--write" in sys.argv)
