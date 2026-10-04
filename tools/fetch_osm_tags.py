r"""OpenStreetMap names and building tags for the analysed areas (extras 3 + 4).

The app's local OpenStreetMap copy (D53) keeps geometry only. This looks up, by id, once per area:
- the shop / amenity / office points within 30 m of the area's analysed streets (positions from the local copy):
  their name and tags, for the "businesses not in OpenStreetMap" comparison;
- the area's analysed buildings (their own OSM ids): building:levels, for the floors cross-check.
One Overpass query per area (OpenStreetMap's public servers, free; no Google call). Output:
data/areas/<slug>/osm_tags.json (with the fetch time). New areas delivered by the worker get it automatically.

    backend\.venv\Scripts\python tools\fetch_osm_tags.py            # every area without the file
    backend\.venv\Scripts\python tools\fetch_osm_tags.py --all      # refresh every area
    backend\.venv\Scripts\python tools\fetch_osm_tags.py ward29     # one area
"""
import argparse
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from app import osmref  # noqa: E402
from app.db import Pool  # noqa: E402
from app.settings import Settings  # noqa: E402
from app.store import JsonStore  # noqa: E402


def main():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--all", action="store_true", help="refresh areas that already have the file")
    a = ap.parse_args()
    S = Settings()
    pool = Pool(S.database_url)
    js = JsonStore(S.areas_dir)
    cache = os.path.join(S.data_dir, "cache", "streetpick")
    slugs = a.slugs or js.slugs()
    for slug in slugs:
        if not a.slugs and not a.all and osmref.load(slug, S.areas_dir):
            print(f"{slug}: already fetched (use --all to refresh)")
            continue
        b = js.bundle(slug)
        t = time.time()
        out = osmref.fetch(b, S.areas_dir, cache, pool)
        biz = sum(1 for p in out["pois"] if osmref.poi_kind(p["tags"]))
        lv = sum(1 for v in out["buildings"].values() if v.get("levels") is not None)
        print(f"{slug}: {len(out['pois'])} OSM points in scope ({biz} businesses, "
              f"{sum(1 for p in out['pois'] if not p['found'])} not found by id); "
              f"{len(out['buildings'])} OSM buildings, {lv} with building:levels "
              f"({sum(1 for v in out['buildings'].values() if not v['found'])} not found by id) — {time.time() - t:.1f} s")
    pool.close()


if __name__ == "__main__":
    main()
