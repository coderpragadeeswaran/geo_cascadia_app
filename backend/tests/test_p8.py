"""P8: routing & cost recount, imagery age, front-wall length, Tamil questions, worker photo-crop cleanup."""
import datetime as dt
import os
import types

import pytest

from app import frontwall, hood, imagery, queryparse
from app.settings import ROOT, Settings
from app.store import JsonStore

S = Settings()
JS = JsonStore(S.areas_dir)
RF = hood.RunFiles(S.areas_dir)


def _mc():
    import json
    return json.load(open(os.path.join(S.data_dir, "model_card.json"), encoding="utf-8"))


# ------------------------------------------------------------------------------------------------ 1/2 routing and cost
def test_ward29_cost_recount_explains_the_model_card():
    """model_card: $0.056 / 339 calls with the router, $0.089 / 782 without. The run files show 339 = 73 use + 266 floors
    calls only (a resumed run re-used the 166 name and 84 business-sign checks); 782 = all four kinds, every use call
    to the cloud. Recounted like for like, the without-router figure is reproduced."""
    b = JS.bundle("ward29")
    r = hood.hood(b, RF.get("ward29"), _mc())["routing"]
    kinds = {t["key"]: t for t in r["tasks"]}
    use = {x["route"]: x for x in kinds["use"]["routes"]}
    assert (use["local"]["n"], use["cloud"]["n"]) == (193, 73)
    assert kinds["floors"]["routes"][0]["n"] == 266 and kinds["floors"]["routes"][0]["usd_status"] == "derived"
    assert kinds["signs"]["routes"][1]["n"] == 166 and kinds["unmapped"]["routes"][0]["n"] == 84
    assert use["cloud"]["n"] + kinds["floors"]["routes"][0]["n"] == 339 == b["meta"]["run"]["vlm_calls"]
    assert r["totals"]["calls"] == 589
    assert r["all_cloud"]["calls"] == 782
    assert abs(r["all_cloud"]["usd"] - 0.089) < 0.0005            # the model card's "without router", reproduced
    assert abs(r["totals"]["usd"] - 0.0702) < 0.0005
    assert r["model_card_check"]["stored_with"] == 0.056 and r["model_card_check"]["computed_calls_with"] == 589
    assert r["every_view"]["photos"] == 1154 and r["every_view"]["status"] == "estimate"
    assert [a["n"] for a in r["accuracy"]] == [31, 31]


def test_live_run_counter_equals_recount():
    """A full live run (not resumed) counts every call: the recount must equal its own counter."""
    b = JS.bundle("vadakku_masi_veethi_f17937")
    r = hood.hood(b, RF.get("vadakku_masi_veethi_f17937"), _mc())["routing"]
    run = b["meta"]["run"]
    assert r["totals"]["calls"] == run["vlm_calls"]
    assert abs(r["totals"]["usd"] - run["vlm_cost_usd"]) < 1e-4


def test_trust_lists_the_model_card_cost_row(client):
    rows = client.get("/trust/consistency").json()["rows"]
    row = next(x for x in rows if x["field"] == "model_card.cost_time.ward29_vlm_usd_with_router")
    assert row["stored"] == "$0.056" and row["jump"] == {"page": "hood", "section": "routing"}


# ------------------------------------------------------------------------------------------------ 3 imagery age
def test_imagery_dates_and_outdated_flags():
    b = JS.bundle("ward29")
    r = imagery.imagery(b, RF.get("ward29"), today=dt.date(2026, 10, 2))
    s = r["summary"]
    assert (s["oldest"], s["newest"], s["cutoff"]) == ("2018-06", "2026-02", "2023-10")
    # only "missing" / "not in register" findings are marked, and only when their NEWEST photo is older than the cutoff
    for x in b["buildings"]:
        o = r["objects"][f"building:{x['id']}"]
        assert o["outdated"] == (x["match_status"] == "no_record" and o["newest"] is not None and o["newest"] < "2023-10")
    assert s["outdated_findings"]["building"] == 4


def test_evidence_photos_carry_their_date(client):
    v = client.get("/areas/ward29/evidence/building/w1252505151").json()["views"]
    assert v and all(isinstance(x["date"], str) and len(x["date"]) == 7 for x in v)
    im = client.get("/areas/ward29/imagery").json()
    assert im["objects"]["building:w1252505151"]["newest"] == "2022-11"


# ------------------------------------------------------------------------------------------------ 5 front wall
def test_front_wall_is_the_road_facing_edge():
    b = JS.bundle("ward29")
    rows = [frontwall.front_wall(b, x) for x in b["buildings"]]
    assert all(r and r["length_m"] > 0 for r in rows)
    # never shorter than the edge the position uses, never longer than the outline's longer side + joins
    assert all(r["length_m"] >= r["edge_m"] for r in rows)


def test_front_wall_joins_a_split_wall():
    from geo_cascadia.geo import Frame
    fr = Frame(11.0, 77.0)
    ring = [list(fr.ll(x, y)) for x, y in [(0, 0), (8, 0), (8.2, 0.05), (20, 0), (20, 15), (0, 15), (0, 0)]]
    street = [list(reversed(fr.ll(-50, -10))), list(reversed(fr.ll(50, -10)))]
    B = {"streets": [{"name": "S", "geometry": {"type": "LineString", "coordinates": street}}]}
    r = frontwall.front_wall(B, {"lat": 11.0, "lon": 77.0, "street": "S", "footprint": {"polygon_latlon": ring, "frontage_m": 20}})
    assert r["length_m"] == 20.0 and r["edge_m"] == 11.8


# ------------------------------------------------------------------------------------------------ 6 Tamil
TAMIL = [
    ("Show commercial buildings with more than two visible floors that do not have a matching property record",
     "இரண்டு மாடிகளுக்கு மேல் உள்ள, சொத்து பதிவேட்டில் இல்லாத வணிகக் கட்டிடங்களைக் காட்டு"),
    ("Show streets where no streetlight is detected within 60 m", "60 மீட்டருக்குள் தெருவிளக்கு இல்லாத தெருக்களைக் காட்டு"),
    ("Display only low-confidence floor-count predictions and create a review queue",
     "குறைந்த நம்பகத்தன்மை கொண்ட மாடி எண்ணிக்கை கணிப்புகளை மட்டும் காட்டு, மறுஆய்வு வரிசை உருவாக்கு"),
    ("Chart of unmatched buildings by street", "தெரு வாரியாக பொருந்தாத கட்டிடங்களின் வரைபடம்"),
    ("poles on Sathy Main Road", "Sathy Main Road இல் உள்ள கம்பங்களைக் காட்டு"),
]


@pytest.mark.parametrize("en,ta", TAMIL)
def test_tamil_question_reads_like_english(offline, en, ta):
    E = offline.post("/query", json={"area": "ward29", "text": en}).json()
    T = offline.post("/query", json={"area": "ward29", "text": ta}).json()
    assert T["parsed_filters"] == E["parsed_filters"]
    assert T["understanding"]["status"] == "ok" and T["understanding"]["ignored"] == []
    assert any(s.get("tamil") for s in T["understanding"]["synonyms"])
    assert (T.get("rows") is None) == (E.get("rows") is None)
    assert len(T.get("rows") or T.get("groups") or []) == len(E.get("rows") or E.get("groups") or [])


def test_tamil_negation_is_never_dropped():
    # இல் ("in") is matched as a whole word only: இல்லாத ("not having") must not become "on"
    text, applied = queryparse.tamil("கட்டிடங்கள் இல்லாத")
    assert "on" not in text.split() and "இல்லாத" in text


# ------------------------------------------------------------------------------------------------ 7 worker cleanup
@pytest.fixture
def W(tmp_path, monkeypatch):
    src = open(os.path.join(ROOT, "worker", "colab_worker.py"), encoding="utf-8").read()
    g = {"__name__": "colab_worker_test"}
    monkeypatch.chdir(tmp_path)
    for v in ("HOME", "USERPROFILE"):
        monkeypatch.setenv(v, str(tmp_path))
    exec(compile(src.rstrip()[:-len("main()")], "colab_worker.py", "exec"), g)
    g["time"] = types.SimpleNamespace(sleep=lambda s: None, time=__import__("time").time, monotonic=__import__("time").monotonic)
    return g


def test_forget_deletes_every_photo_crop(W, tmp_path):
    out = tmp_path / "job"
    for sub, n in (("crops_signboard", 3), ("crops_building", 2)):
        (out / sub).mkdir(parents=True)
        for i in range(n):
            (out / sub / f"{i}.jpg").write_bytes(b"\xff\xd8" + b"x" * 100)
    (out / "export.json").write_text("{}")
    W["drive_dir"] = lambda job: None
    assert W["forget"]({"id": "x"}, str(out)) == 5
    assert not out.exists()


# ------------------------------------------------------------------------------------------------ D51 frontage
def test_saved_exports_carry_frontage_and_longest_side():
    """footprint.frontage_m = the road-facing wall (same function as the drawer); the old value is longest_side_m."""
    for slug in ("ward29", "trichy_bharathidasan_salai", "vadakku_masi_veethi_f17937"):
        b = JS.bundle(slug)
        for x in b["buildings"]:
            fp = x["footprint"]
            assert fp["frontage_source"] == "road-facing wall of the OSM outline" and fp["longest_side_m"] > 0
            assert fp["frontage_m"] == frontwall.front_wall(b, x)["length_m"]


def test_pipeline_front_wall_length_matches_the_backend():
    from geo_cascadia.buildloc import front_wall_length, road_facing_edge
    from shapely.geometry import LineString, Polygon
    poly = Polygon([(0, 0), (8, 0), (8.2, 0.05), (20, 0), (20, 15), (0, 15)])
    edge = road_facing_edge(poly, LineString([(-50, -10), (50, -10)]))
    assert front_wall_length(poly, edge) == 20.0 and front_wall_length(poly, None) is None
