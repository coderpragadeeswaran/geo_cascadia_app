"""P4 API additions: editable filter chips run through QueryEngine, gap rows carry the along-road fields (D13),
job estimate from model_card, job cancel."""
import os
import shutil

import pytest

from app.settings import ROOT, Settings
from conftest import AREAS, raw_export

Q1 = "Show commercial buildings with more than two visible floors that do not have a matching property record"
Q2 = "Show streets where no streetlight is detected within 60 m"


def q(client, **body):
    return client.post("/query", json={"area": body.pop("area", "ward29"), **body})


def test_chips_round_trip_through_queryengine(client):
    """Editing chips = the same QueryEngine answer as the equivalent text; every street of every area round-trips."""
    t = q(client, text=Q1).json()
    f = q(client, filters=t["parsed_filters"]).json()
    assert f["parsed_filters"] == t["parsed_filters"] and f["total"] == t["total"] == 0
    assert [s["count"] for s in f["why_empty"]] == [381, 27, 5, 2, 0]      # after D42-D44 + the safer sign rule (was 381, 19, 1, 1, 0)
    relaxed = q(client, filters={**t["parsed_filters"], "floors_op": ">=", "floors_n": 1}).json()   # edit a chip
    assert relaxed["parsed_filters"]["floors_op"] == ">=" and relaxed["total"] == 2          # 1 before D42-D44
    for slug in AREAS:
        streets = {b["street"] for b in raw_export(slug)["buildings"]} | {g["street"] for g in raw_export(slug)["streetlight_gaps"]}
        for st in streets:
            for filt in ({"intent": "buildings", "street": st, "match_status": "no_record"},
                         {"intent": "buildings", "street": st, "use": "residential", "floors_op": ">", "floors_n": 1},
                         {"intent": "streetlight_gaps", "street": st, "interval_m": 60},
                         {"intent": "assets", "asset_type": "pole", "street": st},
                         {"intent": "review", "street": st, "reason_has": "floor count low confidence"}):
                r = q(client, area=slug, filters=filt)
                assert r.status_code == 200, (slug, filt, r.text)
                assert r.json()["parsed_filters"] == filt, (slug, filt, r.json()["text"])
    assert q(client, filters={"intent": "buildings", "floors_op": "~", "floors_n": 2}).status_code == 422
    assert q(client).status_code == 422 and q(client, text="x y", filters={"intent": "buildings"}).status_code == 422


def test_gap_query_rows_show_recorded_and_along_road(client):
    rows = {r["id"]: r for r in q(client, text=Q2).json()["rows"]}
    assert rows["gap60-001"]["length_m"] == 376 and rows["gap60-001"]["along_road_m"] == 424 and rows["gap60-001"]["length_differs"]
    assert rows["gap60-006"]["display_mode"] == "check" and "4 lit camera stops" in rows["gap60-006"]["note"]
    assert [r["length_m"] for r in rows.values()] == sorted((r["length_m"] for r in rows.values()), reverse=True)


def test_plan_estimate_prices_the_real_plan():
    """P7.2: images = planned views + one building photo per building faced (the worker's cap rule); dollars and minutes
    from the recorded rates, nothing scaled by length."""
    from app import planest
    plan = [{"views": [{"footprint": "w1"}, {"footprint": "w1"}, {"footprint": None}]}, {"views": [{"footprint": "w2"}]}]
    rates = {"sv_price": 0.007, "cloud_usd_per_image": 0.0001, "places_per_image": 0.2, "gpu": {"sec_per_image": 3.0, "basis": "x"}}
    e = planest.cost_of_plan(plan, rates, cap_usd=2.0)
    assert (e["views"], e["buildings_faced"], e["street_view_images"], e["cameras"]) == (4, 2, 6, 2)
    assert e["street_view_usd"] == 0.04 and e["cloud_ai_usd"] == 0.0006 and e["total_usd"] == 0.04
    assert e["gpu_minutes"] == 0.3 and e["cpu_minutes"] is None
    assert planest.cost_of_plan(plan, {**rates, "gpu": {"sec_per_image": 3.0, "startup_s": 120, "basis": "x"}})["gpu_minutes"] == 2.3 and e["places_calls"] == 1 and not e["over_cap"]
    big = [{"views": [{"footprint": f"b{i}"}]} for i in range(200)]                     # 200 views + 200 buildings
    assert planest.cost_of_plan(big, rates, cap_usd=2.0)["over_cap"]


def test_measured_rates_come_from_full_live_runs():
    """seconds and cloud dollars per image: completed live jobs that ran from the start (never resumed or replayed)"""
    import json
    from app import planest
    from app.settings import Settings
    st = Settings()
    with open(os.path.join(st.data_dir, "model_card.json"), encoding="utf-8") as f:
        mc = json.load(f)
    r = planest.measured_rates(st.areas_dir, mc)
    used = {j["slug"] for j in r["jobs"]}
    assert "vadakku_masi_veethi_f17937" in used and "sanganur_road_086d14" not in used      # resumed: not a rate
    # P7 R2 (F1): per-image rate from the Ward 29 full run; start-up = median of (job time - images x rate)
    rate = mc["cost_time"]["ward29_full_run_gpu_minutes"] * 60 / 1420
    assert abs(r["gpu"]["sec_per_image"] - rate) < 1e-9
    starts = sorted(j["seconds"] - j["images"] * rate for j in r["jobs"])
    med = starts[len(starts) // 2] if len(starts) % 2 else (starts[len(starts) // 2 - 1] + starts[len(starts) // 2]) / 2
    assert abs(r["gpu"]["startup_s"] - med) < 1e-9
    assert r["sv_price"] == mc["cost_time"]["street_view_price_usd_per_image"]
    # Ward 29's photos from its run files: 1,154 views fetched + 266 building crops = 1,420 (the owner's full run)
    assert planest.photos_of_run(os.path.join(st.areas_dir, "ward29")) == {"views": 1154, "crops": 266, "photos": 1420}


def test_cancel_job(online):
    poly = {"type": "Polygon", "coordinates": [[[77.3425, 11.1080], [77.3440, 11.1080], [77.3440, 11.1092], [77.3425, 11.1080]]]}
    j = online.post("/jobs", json={"polygon": poly, "name": "pytest cancel", "test": True}).json()["job"]
    try:
        c = online.post(f"/jobs/{j['id']}/cancel").json()["job"]
        assert c["status"] == "failed" and c["message"] == "cancelled by user"
        assert online.post(f"/jobs/{j['id']}/cancel").status_code == 409
        # asked for by its id, so a real queued job is never taken by this test
        nxt = online.post("/worker/next", json={"worker_id": "pytest", "job": j["id"]},
                          headers={"X-Worker-Token": Settings().worker_token}).json()
        assert nxt["job"] is None
    finally:
        online.app.state.workers.pop("pytest", None)          # don't leave a "worker online" for later tests
        with online.app.state.data.pool.connection() as c:
            c.execute("delete from jobs where id = %s", (j["id"],))
        shutil.rmtree(os.path.join(ROOT, "data", "areas", j["input"]["slug"]), ignore_errors=True)


def test_unmapped_endpoint(client):
    r = client.get("/areas/tiruppur_uthukuli_road/unmapped").json()
    assert r["total"] == 14 and {"name", "ocr_text", "evidence"} <= set(r["rows"][0])
