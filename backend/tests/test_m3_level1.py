"""D62: the orange "this building" box on a building's Front / Best photo is chosen by M3 (visible span) from
box_choice.json — display only. The rule itself, the evidence API wiring, and that nothing else changes."""
import json
import os

import pytest

from app import boxchoice, evidence
from app.settings import ROOT
from app.store import JsonStore

AREAS = os.path.join(ROOT, "data", "areas")
OLD = "ward29_v1"           # D64: the Sep 2026 Ward 29 run (display-only M3, level 1), a hidden backup since the switch


def box(x1, x2, conf=0.5):
    return {"cls": "building", "conf": conf, "x1": x1, "y1": 100, "x2": x2, "y2": 400}


def test_rule_visible_span_iou_ties_and_none():
    cols = len(boxchoice.COLS)
    first = ["T" if 40 <= i < 80 else "X" for i in range(cols)]          # target visible in columns 160..316 px
    near = box(160, 316)
    b, s, _ = boxchoice.choose(first, "T", [box(0, 150, 0.9), near, box(330, 640)])
    assert b is near and s == 1.0
    b, s, _ = boxchoice.choose(first, "T", [box(100, 640)])               # 40 / 136 columns: below 0.4
    assert b is None and s < boxchoice.MIN_OVERLAP
    a1, a2 = box(160, 316, 0.3), box(160, 316, 0.8)                        # tie: the more confident box
    assert boxchoice.choose(first, "T", [a1, a2])[0] is a2
    assert boxchoice.choose(["X"] * cols, "T", [near])[0] is None         # hidden: can't tell
    assert boxchoice.span(300.0, 301.0) == [75]                           # a sliver: its nearest column


def test_frozen_parameters():
    assert (boxchoice.STEP, boxchoice.MAX_R, boxchoice.START_M, boxchoice.MIN_OVERLAP) == (4, 60.0, 1.5, 0.4)


def test_committed_choices_cover_every_building_photo():
    for slug in os.listdir(AREAS):
        p = os.path.join(AREAS, slug, "box_choice.json")
        if not os.path.isfile(os.path.join(AREAS, slug, "detections.json")):
            continue
        assert os.path.isfile(p), slug
        c = json.load(open(p, encoding="utf-8"))
        exp = json.load(open(os.path.join(AREAS, slug, "export.json"), encoding="utf-8"))
        bv = {q["fp"]: q for q in json.load(open(os.path.join(AREAS, slug, "building_views.json"), encoding="utf-8"))}
        photos = boxchoice.building_photos(exp, bv)
        rows = [v for vs in c["buildings"].values() for v in vs.values()]
        assert len(rows) == len(photos) == sum(c["counts"].values()), slug
        for v in rows:
            assert (v["status"] == "cant_tell") == (v.get("box") is None and v["status"] != "not_computed"), (slug, v)
            if v["status"] != "not_computed":
                assert (v["score"] >= 0.4) == (v["status"] != "cant_tell"), (slug, v)


@pytest.fixture(scope="module")
def ward29():
    return JsonStore(AREAS).bundle(OLD), evidence.Detections(AREAS)       # D64: the pre-D64 run (level 1) is ward29_v1


def _one(D, status):
    for bid, vs in D.box_choice(OLD).items():
        for k, v in vs.items():
            if v["status"] == status:
                return bid, k, v
    raise AssertionError(status)


def test_evidence_draws_the_m3_box(ward29):
    b, D = ward29
    bid, k, ch = _one(D, "changed")
    v = next(x for x in evidence.evidence(D, b, "building", bid) if x["key"] == ch["view"])
    t = [x for x in v["boxes"] if x["target"]]
    assert v["box_choice"] == "changed" and v["target"] == "box" and len(t) == 1
    assert [t[0][c] for c in ("x1", "y1", "x2", "y2")] == pytest.approx(ch["box"], abs=0.06)


def test_cant_tell_marks_no_box_and_keeps_the_rest(ward29):
    b, D = ward29
    bid, k, ch = _one(D, "cant_tell")
    v = next(x for x in evidence.evidence(D, b, "building", bid) if x["key"] == ch["view"])
    assert v["box_choice"] == "cant_tell" and v["target"] == "none" and not any(x["target"] for x in v["boxes"])
    plain = evidence._evidence(D, b, "building", bid)                      # without the choice the box set is the same
    assert len(v["boxes"]) >= len([x for x in plain[0]["boxes"] if not (plain[0]["target"] == "record_box" and x["target"])])


def test_linked_signs_unchanged(ward29):
    b, D = ward29
    bid, _k, ch = _one(D, "changed")
    D2 = evidence.Detections(AREAS)
    D2.box_choice = lambda slug: {}                                        # as before D62
    old = {(x["cls"], x["x1"], x["y1"]): x.get("linked", False) for v in evidence.evidence(D2, b, "building", bid) for x in v["boxes"]}
    new = {(x["cls"], x["x1"], x["y1"]): x.get("linked", False) for v in evidence.evidence(D, b, "building", bid) for x in v["boxes"]}
    assert {k: v for k, v in new.items() if k[0] == "signboard"} == {k: v for k, v in old.items() if k[0] == "signboard"}


def test_no_file_means_the_analysis_box(ward29):
    b, D = ward29
    D2 = evidence.Detections(AREAS)
    D2.box_choice = lambda slug: {}
    bid, _k, _ch = _one(D, "changed")
    v = evidence.evidence(D2, b, "building", bid)[0]
    assert "box_choice" not in v and v["target"] in ("box", "record_box")


def test_numbers_do_not_change(client):
    """display only: the dashboard and the review queue are computed from the records, never from box_choice"""
    d = client.get("/areas/ward29").json()["dashboard"]["kpi"]
    assert d["buildings_analysed"] == 373                                 # the D64 re-run
    rq = client.get("/review?area=ward29").json()
    assert len(rq.get("rows") or rq.get("items") or []) >= 1
