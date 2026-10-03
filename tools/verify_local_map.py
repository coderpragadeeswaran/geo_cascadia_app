r"""verify_local_map.py — does the local map copy (D53) give the same answers as Overpass?

    backend\.venv\Scripts\python tools\verify_local_map.py [--only ward29,demo:Sakthi] [--out data/exports/local_map_check.json]

For every analysed area (its polygon in the database) and every demo street in tools/demo_streets.json (its job
polygon, resolved by the street picker), runs the pipeline's own area-stage code (geo_cascadia.area.Area:
load_footprints + load_streets) twice with empty caches:
  local    = area.MAP_SOURCE answering from PostGIS only (no network),
  overpass = MAP_SOURCE unset: OpenStreetMap's live Overpass servers, and Microsoft's own tiles when the pipeline
             fetches them (the tiles already downloaded by import_osm_local.py are reused: same release).
Compares every road row (name, type, length) and the outlines counted per street (OSM / Microsoft, centre within 45 m
of the street line). Prints a table; a difference above 5 % is listed with the roads or outlines behind it.
"""
import argparse
import json
import os
import shutil
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]
from shapely.geometry import Point, shape  # noqa: E402

from app import mapdata, streetpick  # noqa: E402
from app.db import Pool, database_url  # noqa: E402
import geo_cascadia.area as A  # noqa: E402
from geo_cascadia.config import Config  # noqa: E402

MS_DIR = os.path.join(ROOT, "data", "cache", "osm_import", "microsoft")


def local_only(kind, arg):
    if kind == "overpass":
        loc = mapdata.answer(arg)
        if loc is None:
            raise RuntimeError(f"not answered locally: {arg[:90]}")
        return loc[0]
    minx, miny, maxx, maxy = arg
    rings = mapdata.ms_rings(miny, minx, maxy, maxx)
    if rings is None:
        raise RuntimeError("Microsoft not answered locally")
    return rings


def run(poly, way_ids, panos, src, cache):
    A.MAP_SOURCE = src
    if src is None:                                     # Microsoft: reuse the imported tiles (same release), no 35 MB download
        os.makedirs(os.path.join(cache, "ms_cache", "tiles"), exist_ok=True)
        for f in os.listdir(MS_DIR):
            if f.endswith(".csv.gz"):
                shutil.copy(os.path.join(MS_DIR, f), os.path.join(cache, "ms_cache", "tiles", f))
    t = time.time()
    area = A.Area(poly, os.path.join(cache, "overpass_cache"), Config().ray_max_range_m)
    real_get = A.requests.get

    def get(url, *a, **k):                              # dataset-links.csv from the import folder (same file)
        if url.endswith("dataset-links.csv"):
            class R:
                text = open(os.path.join(MS_DIR, "dataset-links.csv"), encoding="utf-8").read()
            return R()
        return real_get(url, *a, **k)
    A.requests.get = get
    try:
        area.load_footprints(ms_fill=True)
        area.load_streets(panos, Config(), None, way_ids)
    finally:
        A.requests.get = real_get
        A.MAP_SOURCE = None
    secs = time.time() - t
    rows = {r["name"]: r for r in area.all_street_rows}
    fps = [(area.fp_ids[i], area.fp_source[i], area.footprints[i].centroid) for i in range(len(area.footprints))]
    per = {}
    for name, r in rows.items():
        per[name] = {"osm": sorted(f for f, s, c in fps if s == "osm" and r["geom"].distance(c) <= 45),
                     "microsoft": sum(1 for f, s, c in fps if s == "microsoft" and r["geom"].distance(c) <= 45)}
    return {"seconds": round(secs, 1), "fp": dict(area.fp_counts), "rows": rows, "per": per,
            "fp_ids": sorted(f for f, s, _ in fps if s == "osm")}


def pct(a, b):
    return 0.0 if a == b else 100.0 * abs(a - b) / max(a, b, 1)


def compare(name, L, O):
    names = set(L["rows"]) | set(O["rows"])
    only_l = sorted(n for n in names if n not in O["rows"])
    only_o = sorted(n for n in names if n not in L["rows"])
    both = sorted(n for n in names if n in L["rows"] and n in O["rows"])
    len_diff = [(n, L["rows"][n]["length_m"], O["rows"][n]["length_m"]) for n in both
                if pct(L["rows"][n]["length_m"], O["rows"][n]["length_m"]) > 5]
    fp_diff = []
    for n in both:
        lo, oo = L["per"][n]["osm"], O["per"][n]["osm"]
        lm, om = L["per"][n]["microsoft"], O["per"][n]["microsoft"]
        if pct(len(lo), len(oo)) > 5 or pct(lm, om) > 5:
            fp_diff.append({"street": n, "osm_local": len(lo), "osm_overpass": len(oo), "ms_local": lm, "ms_overpass": om,
                            "only_local": sorted(set(lo) - set(oo))[:6], "only_overpass": sorted(set(oo) - set(lo))[:6]})
    # shop points decide a street's kind (commercial / residential) in the pipeline
    kind_diff = [(n, L["rows"][n]["kind"], O["rows"][n]["kind"], L["rows"][n]["pois"], O["rows"][n]["pois"]) for n in both
                 if L["rows"][n]["kind"] != O["rows"][n]["kind"] or L["rows"][n]["pois"] != O["rows"][n]["pois"]]
    return {"target": name, "roads_local": len(L["rows"]), "roads_overpass": len(O["rows"]), "kind_or_shops_diff": kind_diff,
            "length_local_m": sum(r["length_m"] for r in L["rows"].values()),
            "length_overpass_m": sum(r["length_m"] for r in O["rows"].values()),
            "fp_local": L["fp"], "fp_overpass": O["fp"], "seconds_local": L["seconds"], "seconds_overpass": O["seconds"],
            "roads_only_local": only_l, "roads_only_overpass": only_o, "length_diff_gt5": len_diff, "footprint_diff_gt5": fp_diff,
            "outlines_only_local": sorted(set(L["fp_ids"]) - set(O["fp_ids"]))[:10],
            "outlines_only_overpass": sorted(set(O["fp_ids"]) - set(L["fp_ids"]))[:10],
            "n_outlines_only_local": len(set(L["fp_ids"]) - set(O["fp_ids"])),
            "n_outlines_only_overpass": len(set(O["fp_ids"]) - set(L["fp_ids"]))}


def targets(pool):
    out = []
    with pool.connection() as c:
        for slug, gj in c.execute("select slug, ST_AsGeoJSON(polygon) from areas where slug not like 'pytest%' order by slug"):
            p = os.path.join(ROOT, "data", "areas", slug)
            panos = json.load(open(os.path.join(p, "panos.json"))) if os.path.exists(os.path.join(p, "panos.json")) else []
            streets = json.load(open(os.path.join(p, "streets.json"))) if os.path.exists(os.path.join(p, "streets.json")) else []
            way_ids = sorted({w for s in streets for w in s.get("way_ids", [])}) if slug != "ward29" else None
            out.append((slug, shape(json.loads(gj)), way_ids, panos))
    demo = json.load(open(os.path.join(ROOT, "tools", "demo_streets.json"), encoding="utf-8"))["streets"]
    cache = tempfile.mkdtemp(prefix="pick_")
    for d in demo:
        res = streetpick.pick(cache, [], d["lat"], d["lon"])
        out.append((f"demo: {d['label']}", shape(res["polygon"]), res["way_ids"], []))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma list of target name prefixes")
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "exports", "local_map_check.json"))
    a = ap.parse_args()
    pool = Pool(database_url())
    mapdata.configure(pool)
    res = []
    for name, poly, way_ids, panos in targets(pool):
        if a.only and not any(name.startswith(x) for x in a.only.split(",")):
            continue
        with tempfile.TemporaryDirectory(prefix="vl_") as tl, tempfile.TemporaryDirectory(prefix="vo_") as to:
            L = run(poly, way_ids, panos, local_only, tl)
            for k in range(3):
                try:
                    O = run(poly, way_ids, panos, None, to)
                    break
                except RuntimeError as e:
                    print(f"  {name}: Overpass failed ({e}); retry {k + 1}", flush=True)
                    time.sleep(30)
            else:
                print(f"{name}: Overpass unavailable, skipped"); continue
        r = compare(name, L, O)
        res.append(r)
        print(f"{name}: roads {r['roads_local']}/{r['roads_overpass']}, length {r['length_local_m']}/{r['length_overpass_m']} m, "
              f"outlines {r['fp_local']}/{r['fp_overpass']}, >5%: lengths {len(r['length_diff_gt5'])}, outlines {len(r['footprint_diff_gt5'])}, "
              f"outline ids only-local/only-overpass {r['n_outlines_only_local']}/{r['n_outlines_only_overpass']}, "
              f"street kind/shop differences {r['kind_or_shops_diff']}, "
              f"only-local roads {r['roads_only_local']}, only-overpass roads {r['roads_only_overpass']}, "
              f"time {r['seconds_local']} s / {r['seconds_overpass']} s", flush=True)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    print(f"written {a.out}")


if __name__ == "__main__":
    main()
