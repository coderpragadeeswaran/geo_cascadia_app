"""D60: stored Street View photos Google no longer serves. Free metadata answers cached 30 days (only definite ones, never
without a key); a gone photo gets Google's current panorama near its camera, aimed at the object, and is never asked for
again; the per-area check, the Hood note, the billing line. No Google call is made here (fake answers)."""
import datetime as dt
import json
import os

import pytest

from app import evidence, photos
from app.settings import ROOT
from app.store import JsonStore

AREAS = os.path.join(ROOT, "data", "areas")
CAM = {"lat": 11.03561906110748, "lon": 76.98019144932174}
GONE_ID = "IzK35muPb34GUZjakVoDOg"          # transport india pvt ltd (w1236978849), 2nd Street, Gandhi Nagar
NEW = {"status": "OK", "pano_id": "NEWPANO", "date": "2026-02", "location": {"lat": CAM["lat"] + 1e-6, "lng": CAM["lon"]}}


def fake(answers):
    """metadata answers by pano id, or answers['near'] for a location look-up; records every call"""
    calls = []

    def fetch(params, key):
        calls.append(dict(params))
        return answers.get(params["pano"]) if "pano" in params else answers.get("near")
    return fetch, calls


def test_cache_keeps_definite_answers_for_30_days(tmp_path):
    fetch, calls = fake({GONE_ID: {"status": "ZERO_RESULTS"}, "near": NEW})
    m = photos.PhotoMeta(str(tmp_path / "c.json"), "k", fetch)
    s = photos.status(m, GONE_ID, CAM)
    m.save()
    assert s["served"] is False and s["current"]["pano_id"] == "NEWPANO" and s["current"]["moved_m"] < 1
    assert len(calls) == 2 and calls[1]["radius"] == photos.NEAR_RADIUS_M and calls[1]["source"] == "outdoor"
    # a new process reads the file: no call at all (the app never asks again about a photo it knows is gone)
    fetch2, calls2 = fake({})
    assert photos.status(photos.PhotoMeta(str(tmp_path / "c.json"), "k", fetch2), GONE_ID, CAM) == s and calls2 == []
    # after 30 days it is asked again
    rows = json.loads((tmp_path / "c.json").read_text())
    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=31)).isoformat(timespec="seconds")
    for r in rows.values():
        r["checked"] = old
    (tmp_path / "c.json").write_text(json.dumps(rows))
    fetch3, calls3 = fake({GONE_ID: {"status": "ZERO_RESULTS"}, "near": NEW})
    photos.status(photos.PhotoMeta(str(tmp_path / "c.json"), "k", fetch3), GONE_ID, CAM)
    assert len(calls3) == 2


@pytest.mark.parametrize("answer", [None, {"status": "REQUEST_DENIED"}, {"status": "OVER_QUERY_LIMIT"}, {"status": "UNKNOWN_ERROR"}])
def test_refused_or_failed_lookups_are_unknown_and_not_cached(tmp_path, answer):
    fetch, calls = fake({GONE_ID: answer})
    m = photos.PhotoMeta(str(tmp_path / "c.json"), "k", fetch)
    assert photos.status(m, GONE_ID, CAM) == {"served": None, "current": None}
    m.save()
    assert not (tmp_path / "c.json").exists()
    photos.status(m, GONE_ID, CAM)
    assert len(calls) == 2                                  # asked again next time


def test_no_key_means_no_network(tmp_path):
    fetch, calls = fake({GONE_ID: {"status": "ZERO_RESULTS"}})
    m = photos.PhotoMeta(str(tmp_path / "c.json"), "", fetch)
    assert photos.status(m, GONE_ID, CAM)["served"] is None and calls == []


def test_gone_with_nothing_nearby(tmp_path):
    fetch, _ = fake({GONE_ID: {"status": "NOT_FOUND"}, "near": {"status": "ZERO_RESULTS"}})
    assert photos.status(photos.PhotoMeta(str(tmp_path / "c.json"), "k", fetch), GONE_ID, CAM) == {"served": False, "current": None}


def test_served_photo_needs_one_call_and_no_location_lookup(tmp_path):
    fetch, calls = fake({"X": {"status": "OK", "pano_id": "X", "date": "2024-01", "location": {"lat": 1, "lng": 2}}})
    assert photos.status(photos.PhotoMeta(str(tmp_path / "c.json"), "k", fetch), "X", CAM) == {"served": True, "current": None}
    assert len(calls) == 1


def test_aimed_from_the_new_position_at_the_target():
    cur = {"pano_id": "N", "date": "2026-02", "lat": 11.0, "lon": 77.0, "moved_m": 3.0}
    east = photos.aimed(cur, {"heading": 10, "pitch": 22, "fov": 90}, (11.0, 77.0002))
    assert round(east["heading"]) == 90 and east["pitch"] == 22 and east["fov"] == 90
    assert photos.aimed(cur, {"heading": 10, "pitch": 0, "fov": 60}, None)["heading"] == 10       # no target: same heading


@pytest.fixture(scope="module")
def ward29():
    return JsonStore(AREAS).bundle("ward29"), evidence.Detections(AREAS)


def test_transport_india_gets_the_current_photo_aimed_at_its_front(tmp_path, ward29):
    b, D = ward29
    fetch, _ = fake({GONE_ID: {"status": "ZERO_RESULTS"}, "near": NEW})
    m = photos.PhotoMeta(str(tmp_path / "c.json"), "k", fetch)
    views = photos.annotate(m, b, "building", "w1236978849", evidence.evidence(D, b, "building", "w1236978849"))
    assert [v["key"] for v in views] == ["attr", "sign"] and all(v["served"] is False for v in views)
    front = photos.front_centre(b, next(x for x in b["buildings"] if x["id"] == "w1236978849"))
    attr, sign = views
    assert attr["current"]["pano_id"] == "NEWPANO" and attr["current"]["fov"] == attr["fov"]
    assert abs(attr["current"]["heading"] - photos.bearing_between(NEW["location"]["lat"], NEW["location"]["lng"], *front)) < 0.1
    # the sign view stays aimed at the sign (its stored sight line), with its tilt
    assert abs(sign["current"]["heading"] - sign["heading"]) < 3 and sign["current"]["pitch"] == sign["pitch"]
    # the analysis' boxes stay with the analysis photo; nothing moves them onto the new one
    assert "boxes" not in attr["current"]


def test_check_area_counts_and_hood_note(tmp_path, ward29):
    b, D = ward29
    refs = photos.photo_refs(D, b)
    pano_ids = {v["pano_id"] for _k, _i, v in refs}
    gone = sorted(pano_ids)[:3]
    ok = {p: {"status": "OK", "pano_id": p, "date": "2025-01", "location": {"lat": 1, "lng": 1}} for p in pano_ids}
    fetch, _ = fake({**ok, **{p: {"status": "ZERO_RESULTS"} for p in gone}, "near": {**NEW, "date": "2099-01"}})
    c = photos.check_area(photos.PhotoMeta(str(tmp_path / "c.json"), "k", fetch), D, b)
    n_gone = sum(v["pano_id"] in gone for _k, _i, v in refs)
    assert c["photo_refs"] == len(refs) and c["gone"] == n_gone == c["gone_current_available"] == c["gone_current_newer"]
    assert c["served"] == len(refs) - n_gone and c["panoramas"] == len(pano_ids) and c["panoramas_gone"] == 3
    d = tmp_path / "areas" / "x"
    d.mkdir(parents=True)
    (d / "photo_check.json").write_text(json.dumps(c))
    note = photos.area_note(str(tmp_path / "areas"), "x")["text"]
    assert note.startswith(f"{n_gone} of {len(refs)} analysis photos are no longer served by Google") and "(newer photos)" in note
    assert photos.area_note(str(tmp_path / "areas"), "missing") is None


def test_committed_ward29_check_and_hood(client):
    """the one-off check's file (tools/check_photos.py, 7 Oct 2026) and what the Hood serves from it"""
    with open(os.path.join(AREAS, "ward29", "photo_check.json"), encoding="utf-8") as f:
        c = json.load(f)
    assert c["photo_refs"] == c["served"] + c["gone"] + c["unknown"] and c["gone_current_available"] <= c["gone"]
    h = client.get("/areas/ward29/hood").json()
    assert h["photo_check"]["text"].startswith(f"{c['gone']} of {c['photo_refs']} analysis photos")
    assert h["billing"]["line"].startswith("Billed under Google's India pricing: ₹0 so far") and "17,747" in h["billing"]["line"]


def test_evidence_and_photo_endpoints_carry_the_answer(client):
    """cache only here (conftest blanks the server key): served is true / false / null, never an error"""
    v = client.get("/areas/ward29/evidence/building/w1236978849").json()["views"]
    assert all("served" in x and "current" in x for x in v)
    r = client.get(f"/photos/{GONE_ID}?heading=129.8").json()
    assert r["pano_id"] == GONE_ID and r["served"] in (True, False, None) and r["date"] == "2026-02"
    if r["served"] is False and r["current"]:
        assert r["current"]["heading"] == 129.8                         # no target given: the same heading
