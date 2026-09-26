"""Official building positions (D27) for areas already analysed, recomputed on the laptop from the saved run files.

Usage:  python tools/building_positions.py [slug ...]        (default: every area folder with run files)

Same code as a live run (pipeline/geo_cascadia/buildloc.py predict_positions), same inputs:
  detections.json, buildings.json (the building register), streets.json (street lines), and the OSM footprints for ray
  grouping. The run folders do not keep the footprint set, so it is fetched once from Overpass (public OSM data, cached
  in data/cache/p45_overpass/). No YOLO, OCR, VLM or Street View calls.
Writes (like run_area):  data/areas/<slug>/building_positions.json  and  export.json buildings[].predicted_position.
Then load the area into the database:  python backend/load_area.py data/areas/<slug>
"""
import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

from shapely.geometry import LineString, MultiLineString, box  # noqa: E402

from geo_cascadia.area import Area  # noqa: E402
from geo_cascadia.buildloc import building_rays, locate_unmapped_buildings, predict_positions  # noqa: E402
from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.export import PREDICTED_KEYS  # noqa: E402

PAD_DEG = 0.0007            # ~75 m around the cameras: every footprint a 40 m ray can reach


def folder(slug):
    return os.path.join(ROOT, "data", "areas", slug)


def load(slug, name):
    with open(os.path.join(folder(slug), name), encoding="utf-8") as f:
        return json.load(f)


def area_slugs():
    """Every area folder with the run files this step needs (no hard-coded list)."""
    base = os.path.join(ROOT, "data", "areas")
    need = ("detections.json", "buildings.json", "export.json", "streets.json")
    return sorted(s for s in os.listdir(base) if all(os.path.isfile(os.path.join(base, s, n)) for n in need))


def area_model(slug, cfg):
    """The saved run files of an area + an Area with the OSM footprints around its cameras (ray grouping only)."""
    dets, blds = load(slug, "detections.json"), load(slug, "buildings.json")
    la = [d["camera_lat"] for d in dets] or [b["lat"] for b in blds]
    lo = [d["camera_lon"] for d in dets] or [b["lon"] for b in blds]
    poly = box(min(lo) - PAD_DEG, min(la) - PAD_DEG, max(lo) + PAD_DEG, max(la) + PAD_DEG)
    area = Area(poly, os.path.join(ROOT, "data", "cache", "p45_overpass"), cfg.ray_max_range_m)
    area.load_footprints(ms_fill=False)
    return area, dets, blds


def street_lines(slug, F):
    """{raw street label: MultiLineString in area-local metres} from streets.json (the names buildings.json uses)."""
    out = {}
    for s in load(slug, "streets.json"):
        lines = json.loads(s["lines_latlon"]) if isinstance(s["lines_latlon"], str) else s["lines_latlon"]
        ls = [LineString([F.xy(p[0], p[1]) for p in ln]) for ln in lines if len(ln) >= 2]
        if ls:
            out[s["name"]] = MultiLineString(ls)
    return out


def positions(slug, cfg):
    area, dets, blds = area_model(slug, cfg)
    rays = building_rays(dets, area, ("building", "signboard"))
    pos = predict_positions(dets, area, blds, street_lines(slug, area.frame), cfg, rays=[r for r in rays if r["cls"] == "building"])
    free, free_stats = locate_unmapped_buildings(dets, area, cfg, rays=rays)
    return pos, free, free_stats


def write(slug, pos, free, free_stats):
    with open(os.path.join(folder(slug), "building_positions.json"), "w", encoding="utf-8") as f:
        json.dump({"by_building": pos, "no_footprint": free, "no_footprint_stats": free_stats}, f)
    path = os.path.join(folder(slug), "export.json")
    exp = load(slug, "export.json")
    for b in exp["buildings"]:
        p = pos.get(b["id"])
        b["predicted_position"] = {k: p[k] for k in PREDICTED_KEYS} if p else None
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(exp, f)
    os.replace(tmp, path)


if __name__ == "__main__":
    cfg = Config()
    for slug in sys.argv[1:] or area_slugs():
        pos, free, stats = positions(slug, cfg)
        write(slug, pos, free, stats)
        print(slug, dict(Counter(p["method"] for p in pos.values())), "| no-footprint points:", len(free))
