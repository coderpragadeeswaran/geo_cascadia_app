r"""D62: which box is drawn as "this building" on each building's evidence photo (M3, backend/app/boxchoice.py), for every
analysed area (or the given ones) -> data/areas/<slug>/box_choice.json. Saved run files + building outlines only (the
run-era Overpass cache, else the app's local OpenStreetMap / Microsoft copy, else Overpass); no photo, no model call.
New worker areas get it automatically after delivery. Display only: no number in the app changes.

    backend\.venv\Scripts\python tools\box_choice.py [slug ...]
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from app import boxchoice, db, mapdata  # noqa: E402
from app.settings import Settings  # noqa: E402


def main(slugs):
    st = Settings()
    if st.local_map_data and st.database_url:
        mapdata.configure(db.Pool(st.database_url))
    import geo_cascadia.area as A
    A.MAP_SOURCE = mapdata.pipeline_source(os.path.join(st.data_dir, "cache", "streetpick")) if st.local_map_data else None
    cache = os.path.join(st.data_dir, "cache", "p45_overpass")
    for slug in slugs or sorted(os.listdir(st.areas_dir)):
        folder = os.path.join(st.areas_dir, slug)
        if not os.path.isfile(os.path.join(folder, "detections.json")):
            continue
        r = boxchoice.write(folder, cache)
        print(f"{slug:<48} {r['counts'] if r else 'no run files'}  (outlines {r['outlines'] if r else '-'})", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
