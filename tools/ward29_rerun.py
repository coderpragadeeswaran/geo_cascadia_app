r"""D64: re-run Ward 29 as a NEW, HIDDEN area "ward29_v2" — same boundary (data/study_area), same streets (the OSM way ids of
ward29's streets.json), same synthetic register (ward29's records + planted list, paired by location), M3 box choice.

    backend\.venv\Scripts\python tools\ward29_rerun.py estimate     # the real planner (free Street View metadata only)
    backend\.venv\Scripts\python tools\ward29_rerun.py create --yes # queue the job (approved: the owner said "yes run")
    backend\.venv\Scripts\python tools\ward29_rerun.py status       # the job's state

The job is hidden (not in the Jobs list or the top bar) and its area gets a hidden.json marker: it is not in the area list
until the switch; /areas/ward29_v2 answers for checks. Nothing about ward29 is changed.
"""
import json
import os
import sys
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from shapely.geometry import mapping, shape  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

SLUG, SOURCE = "ward29_v2", "ward29"
NAME = "Ward 29, Coimbatore (re-run, Oct 2026)"
STATE = os.path.join(ROOT, "data", "cache", "ward29_rerun_job.json")


def job_input():
    with open(os.path.join(ROOT, "data", "study_area", "Study_area.geojson"), encoding="utf-8") as f:
        poly = unary_union([shape(x["geometry"]) for x in json.load(f)["features"]])
    with open(os.path.join(ROOT, "data", "areas", SOURCE, "streets.json"), encoding="utf-8") as f:
        streets = json.load(f)
    ways = sorted({w for s in streets for w in (json.loads(s["way_ids"]) if isinstance(s["way_ids"], str) else s["way_ids"])})
    return {"polygon": mapping(poly), "name": NAME, "street": NAME, "slug": SLUG, "way_ids": ways,
            "streets": [s["name"] for s in streets], "hidden": True,
            "hidden_why": "Ward 29 re-run (D64): hidden until the owner approves the switch", "register_from": SOURCE}


def estimate():
    from app import planest
    from app.settings import Settings
    st = Settings()
    inp = job_input()
    res = planest.plan_street(inp["polygon"], inp["way_ids"], st.data_dir, st.google_server_key)
    mc = json.load(open(os.path.join(ROOT, "data", "model_card.json"), encoding="utf-8"))
    rates = planest.measured_rates(st.areas_dir, mc)
    est = planest.cost_of_plan(res["plan"], rates)
    out = {"panoramas": res["panoramas"], "footprints": res.get("footprints"), "buildings_registered": len(res["buildings"]),
           "streets_selected": len({e.get("street") for e in res["plan"]}), "seconds": res.get("seconds"), **est,
           "rates": {k: rates.get(k) for k in ("sv_price", "cloud_usd_per_image", "places_per_image")},
           "gpu_basis": (rates.get("gpu") or {}).get("basis"), "cloud_basis": rates.get("cloud_basis")}
    print(json.dumps(out, indent=1))
    return out


def create():
    from app.db import connect
    from app.settings import Settings
    from app import planest
    st = Settings()
    inp = job_input()
    mc = json.load(open(os.path.join(ROOT, "data", "model_card.json"), encoding="utf-8"))
    rates = planest.measured_rates(st.areas_dir, mc)
    inp["rates"] = {"sv_price": rates.get("sv_price"), "cloud_usd_per_image": rates.get("cloud_usd_per_image")}
    inp["cost_cap_usd"] = 20.0
    job_id = str(uuid.uuid4())
    with connect() as c:
        if c.execute("select 1 from areas where slug = %s", (SLUG,)).fetchone():
            raise SystemExit(f"{SLUG} already exists in the database: nothing queued")
        busy = c.execute("select id, status from jobs where input->>'slug' = %s and status not in ('done', 'failed')",
                         (SLUG,)).fetchone()
        if busy:
            raise SystemExit(f"a {SLUG} job is already {busy[1]}: {busy[0]}")
        c.execute("insert into jobs (id, kind, input, status, is_test, approved) values (%s, 'polygon', %s, 'queued', false, true)",
                  (job_id, json.dumps(inp)))
        c.commit()
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump({"job_id": job_id}, f)
    print("queued", job_id)


def status():
    from app.db import connect
    job_id = json.load(open(STATE, encoding="utf-8"))["job_id"]
    with connect() as c:
        r = c.execute("""select status, stage, done, total, message, note, started_at, finished_at, heartbeat_at, worker_id, device
                         from jobs where id = %s""", (job_id,)).fetchone()
    print(json.dumps(dict(zip(("status", "stage", "done", "total", "message", "note", "started_at", "finished_at",
                                "heartbeat_at", "worker_id", "device"), r)), default=str))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "estimate":
        estimate()
    elif cmd == "create" and "--yes" in sys.argv:
        create()
    elif cmd == "status":
        status()
    else:
        print(__doc__)
