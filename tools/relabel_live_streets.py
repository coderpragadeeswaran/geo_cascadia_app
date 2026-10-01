r"""relabel_live_streets.py — P7.1: one label for an unnamed street analysed from the app.

    backend\.venv\Scripts\python tools\relabel_live_streets.py            (dry run: prints old -> new)
    backend\.venv\Scripts\python tools\relabel_live_streets.py --write    (applies it)

For each area made by a job (data/areas/<slug>/live_run.json) whose clicked street has no name on OpenStreetMap, the
street picker names it again with the P7.1 rule (named cross streets at its ends: "Unnamed road between A and B" /
"Unnamed road near A" / "Unnamed road"; OpenStreetMap names, then Google's name for an unnamed end road). With --write:
- the run's street_names.json and export.json records get that name for the clicked street (jobs.fill_street_names,
  which replaces the pipeline's Google route name for it), as do export.json meta.area / dashboard.streets and
  live_run.json when they held an old name; run_report.json is rebuilt (it repeats the area name);
- the area is reloaded into the database (loader.load_area, idempotent; review decisions are kept) and the job's
  input street / name are updated. The slug (folder name) does not change.
Display names only: no count, finding or position changes. Needs the database and (for Google names) the server key.
"""
import argparse
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from app import jobs, streetpick  # noqa: E402
from app.db import connect  # noqa: E402
from app.loader import load_area  # noqa: E402
from app.settings import Settings  # noqa: E402


def resolve(cache, lat, lon, key, tries=12):
    """the picker's full answer (never a partial one: OpenStreetMap may be slow, so wait for the background lookup)"""
    for _ in range(tries):
        try:
            r = streetpick.pick(cache, [], lat, lon, google_key=key)
            if r.get("osm_details") is not False:
                return r
        except streetpick.OverpassBusy:
            pass
        while streetpick._INFLIGHT or streetpick._FINISHING:
            time.sleep(1)
    raise SystemExit(f"OpenStreetMap did not answer for {lat:.5f},{lon:.5f}; try again later")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    st = Settings()
    cache = os.path.join(st.data_dir, "cache", "streetpick")
    with connect() as conn:
        for slug in sorted(os.listdir(st.areas_dir)):
            folder = os.path.join(st.areas_dir, slug)
            p = os.path.join(folder, "live_run.json")
            if not os.path.isfile(p):
                continue
            with open(p, encoding="utf-8") as f:
                lr = json.load(f)
            row = conn.execute("select input from jobs where id = %s", (lr["job_id"],)).fetchone()
            if not row or lr.get("kind") != "street_click":
                print(f"{slug}: no street-click job in the database, skipped")
                continue
            ji = row[0]
            if ji.get("osm_name"):
                print(f"{slug}: '{ji.get('street')}' has a name on OpenStreetMap, unchanged")
                continue
            click = ji.get("click") or {}
            r = resolve(cache, click["lat"], click["lon"], st.google_server_key)
            if set(r["way_ids"]) != set(ji.get("way_ids") or []) or r.get("name_source") != "unnamed":
                print(f"{slug}: the click now resolves to another road ({r['street']}), skipped")
                continue
            new, old = streetpick.plain_name(r["street"]), ji.get("street")
            with open(os.path.join(folder, "street_names.json"), encoding="utf-8") as f:
                names = json.load(f)
            print(f"{slug}: job / area name '{old}' -> '{new}'; street names now {names}")
            if not a.write:
                continue
            ji2 = {**ji, "street": new, "name": new if ji.get("name") == old else ji.get("name")}
            jobs.fill_street_names(folder, ji2)
            ep = os.path.join(folder, "export.json")
            with open(ep, encoding="utf-8") as f:
                exp = json.load(f)
            # the clicked street's old display names (the job's, the pipeline's Google name) -> the new one
            olds = {old} | {v for k, v in names.items() if set(r["way_ids"]) & set(next((x.get("way_ids") or []
                    for x in json.load(open(os.path.join(folder, "streets.json"), encoding="utf-8")) if x["name"] == k), []))}
            if exp["meta"].get("area") in olds:
                exp["meta"]["area"] = new
            d = exp.get("dashboard") or {}
            if isinstance(d.get("streets"), list):
                d["streets"] = [new if x in olds else x for x in d["streets"]]
            with open(ep, "w", encoding="utf-8") as f:
                json.dump(exp, f)
            if lr.get("street") in olds:
                lr["street"] = new
                with open(p, "w", encoding="utf-8") as f:
                    json.dump(lr, f)
            # the run report repeats the area name: rebuilt from the files (tools/build_run_report.py)
            os.remove(os.path.join(folder, "run_report.json"))
            with open(os.path.join(folder, "street_names.json"), encoding="utf-8") as f:
                print(f"   street_names.json: {json.load(f)}")
            load_area(conn, folder, source_job_id=lr["job_id"])
            conn.execute("update jobs set input = %s where id = %s", (json.dumps(ji2), lr["job_id"]))
            conn.commit()
            print("   reloaded into the database; job input updated")


if __name__ == "__main__":
    main()
