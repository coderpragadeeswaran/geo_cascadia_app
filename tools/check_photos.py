"""D60: which stored Street View photos Google still serves, per area (free metadata calls only; no photo is requested).

    backend\\.venv\\Scripts\\python tools\\check_photos.py [slug ...]

For every evidence photo the app shows (the evidence API's own views: buildings, poles / lights, businesses) it asks the
metadata endpoint for the stored panorama id; for a gone one, it looks for Google's current panorama within 25 m of the
original camera. Answers go to the app's 30-day cache (data/cache/streetview_meta.json), so the app reads them instead of
asking again; the per-area summary goes to data/areas/<slug>/photo_check.json (Under the Hood's data note).
Needs GOOGLE_PLACES_SERVER_KEY in backend/.env (the key must allow the Street View Static API).
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from app import evidence, photos  # noqa: E402
from app.settings import Settings  # noqa: E402
from app.store import JsonStore  # noqa: E402


def main(slugs):
    st = Settings()
    if not st.google_server_key:
        sys.exit("GOOGLE_PLACES_SERVER_KEY is not set in backend/.env")
    meta = photos.PhotoMeta(os.path.join(st.data_dir, "cache", "streetview_meta.json"), st.google_server_key)
    store, D = JsonStore(st.areas_dir), evidence.Detections(st.areas_dir)
    rows = []
    for slug in slugs or store.slugs():
        res = photos.check_area(meta, D, store.bundle(slug))
        with open(os.path.join(st.areas_dir, slug, "photo_check.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(res, f, indent=1)
            f.write("\n")
        rows.append((slug, res))
        print(f"{slug:<48} refs {res['photo_refs']:>4}  served {res['served']:>4}  gone {res['gone']:>4}  "
              f"gone+current {res['gone_current_available']:>4} (newer {res['gone_current_newer']}, same month {res['gone_current_same_month']})  unknown {res['unknown']:>3}  |  panoramas {res['panoramas']:>4}, "
              f"gone {res['panoramas_gone']:>4}, gone+current {res['panoramas_gone_current_available']:>4}, max moved {res['max_moved_m']} m", flush=True)
    print(f"metadata calls made: {meta.calls} (the rest came from the 30-day cache)")


if __name__ == "__main__":
    main(sys.argv[1:])
