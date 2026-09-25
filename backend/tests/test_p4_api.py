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
    assert [s["count"] for s in f["why_empty"]] == [381, 19, 1, 1, 0]
    relaxed = q(client, filters={**t["parsed_filters"], "floors_op": ">=", "floors_n": 1}).json()   # edit a chip
    assert relaxed["parsed_filters"]["floors_op"] == ">=" and relaxed["total"] == 1
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


def test_job_estimate_scales_ward29_by_length(online):
    from app import views
    b = online.app.state.data.db.bundle("ward29")
    mc = online.app.state.model_card.get()
    e = views.job_estimate(1000, b, mc)
    ref_len = sum(s["length_m"] for s in b["streets"])
    assert e["street_view_images"] == round(1000 * 1154 / ref_len)
    assert e["gpu_minutes"] == round(11.5 * 1000 / ref_len, 1) and e["cpu_minutes_full_ocr"] == 18 and e["is_estimate"]
    assert views.job_estimate(1000, None, mc) is None


def test_cancel_job(online):
    poly = {"type": "Polygon", "coordinates": [[[77.3425, 11.1080], [77.3440, 11.1080], [77.3440, 11.1092], [77.3425, 11.1080]]]}
    j = online.post("/jobs", json={"polygon": poly, "name": "pytest cancel"}).json()["job"]
    try:
        c = online.post(f"/jobs/{j['id']}/cancel").json()["job"]
        assert c["status"] == "failed" and c["message"] == "cancelled by user"
        assert online.post(f"/jobs/{j['id']}/cancel").status_code == 409
        nxt = online.post("/worker/next", json={"worker_id": "pytest"}, headers={"X-Worker-Token": Settings().worker_token}).json()
        assert not nxt["job"] or nxt["job"]["id"] != j["id"]
    finally:
        online.app.state.workers.pop("pytest", None)          # don't leave a "worker online" for later tests
        with online.app.state.data.pool.connection() as c:
            c.execute("delete from jobs where id = %s", (j["id"],))
        shutil.rmtree(os.path.join(ROOT, "data", "areas", j["input"]["slug"]), ignore_errors=True)


def test_unmapped_endpoint(client):
    r = client.get("/areas/tiruppur_uthukuli_road/unmapped").json()
    assert r["total"] == 14 and {"name", "ocr_text", "evidence"} <= set(r["rows"][0])
