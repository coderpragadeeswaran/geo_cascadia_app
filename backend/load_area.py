"""Load area folders into the database (idempotent) and check row counts against export.json meta.counts.

Usage (from the repo root):
    backend/.venv/Scripts/python backend/load_area.py data/areas/ward29
    backend/.venv/Scripts/python backend/load_area.py --all
Exit code 1 if any row count differs from meta.counts.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.db import connect  # noqa: E402
from app.loader import ROOT, db_counts, load_area  # noqa: E402

KEYS = ["buildings", "assets", "missing_asset_records", "streetlight_gaps_60m", "review_items", "unmapped_businesses"]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("folders", nargs="*")
    ap.add_argument("--all", action="store_true", help="every data/areas/<slug> with an export.json")
    ap.add_argument("--report", help="write every added / removed review item to this JSON file")
    a = ap.parse_args()
    areas_dir = os.path.join(ROOT, "data", "areas")
    folders = a.folders or ([os.path.join(areas_dir, d) for d in sorted(os.listdir(areas_dir))
                             if os.path.isfile(os.path.join(areas_dir, d, "export.json"))] if a.all else [])
    if not folders:
        ap.error("give area folders or --all")

    bad, reports = 0, []
    with connect() as conn:
        for folder in folders:
            res = load_area(conn, folder)
            with open(os.path.join(folder, "export.json"), encoding="utf-8") as f:
                expected = json.load(f)["meta"]["counts"]
            got = db_counts(conn, res["area_id"])
            print(f"\n{res['slug']}  (area_id {res['area_id']}, polygon: {res['polygon_source']}, "
                  f"streets {got['streets']}, use not classified {got['use_not_classified']})")
            print(f"  {'table':24} {'meta.counts':>11} {'db rows':>8}")
            for k in KEYS:
                ok = expected.get(k) == got[k]
                bad += not ok
                print(f"  {k:24} {expected.get(k, '-'):>11} {got[k]:>8}  {'ok' if ok else 'MISMATCH'}")
            rd = res.get("review_diff") or {}
            print(f"  review items: {len(rd.get('added', []))} added, {len(rd.get('removed_pending', []))} removed (were waiting), "
                  f"{len(rd.get('kept_decided_not_in_queue', []))} decided items no longer in the queue (kept with their decision)")
            for x in rd.get("kept_decided_not_in_queue", []):
                print(f"    kept #{x['id']} {x['item_type']} {x['ref_id']}: {x['status']} by {x['reviewer']}" + (f" ({x['note']})" if x['note'] else ""))
            if a.report:
                reports.append({"slug": res["slug"], **rd})
            if res["review_unjoined"]:
                bad += 1
                print(f"  ! {res['review_unjoined']} review_queue rows could not be linked to a building/asset")
    if a.report:
        with open(a.report, "w", encoding="utf-8") as f:
            json.dump(reports, f, indent=1, default=str)
    print("\nall row counts match meta.counts" if not bad else f"\n{bad} problem(s)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
