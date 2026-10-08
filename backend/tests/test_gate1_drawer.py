"""Gate 1 per building in the drawer (backend/app/gate1pos.py): the same set and reference point as Trust's table."""
import json
import math
import os
import statistics

import pytest
from app import gate1pos, minimap
from app.settings import Settings
from app.store import JsonStore

S = Settings()
JS = JsonStore(S.areas_dir)
ER = gate1pos.EvalRows(S.areas_dir)
TRUST_AREAS = ("ward29", "trichy_bharathidasan_salai", "tiruppur_uthukuli_road")
CAM_ROW = "camera-derived (triangulated + wall_hit)"


def _mc():
    return json.load(open(os.path.join(S.data_dir, "model_card.json"), encoding="utf-8"))


def _checks(slug, roads=None):
    b = JS.bundle(slug)
    return b, [gate1pos.check(b, x, ER.get(slug), roads, 3.5, gate1pos.area_stats(_mc(), slug)) for x in b["buildings"]]


def _stats(v):
    v = sorted(v)
    return {"n": len(v), "median_m": round(statistics.median(v), 2),
            "within_3_5_m_pct": round(100 * sum(x <= 3.5 for x in v) / len(v), 1)}


@pytest.mark.parametrize("slug", TRUST_AREAS)
def test_camera_case_is_trusts_set_with_trusts_numbers(slug):
    """case 1 = Trust's camera-derived row: same buildings, same distances, same n / median / % (Ward 29 n = 240 since the D64 re-run)"""
    b, res = _checks(slug)
    cam = [r for r in res if r["case"] == "camera"]
    trust = _mc()["gate1_position"]["vs OSM front-wall centre"][slug][CAM_ROW]
    assert len(cam) == trust["n"] and all(r["from_trust"] for r in cam)
    assert _stats([r["distance_m"] for r in cam]) == {k: trust[k] for k in ("n", "median_m", "within_3_5_m_pct")}
    assert all(r["area_stats"] == {k: trust[k] for k in ("n", "median_m", "within_3_5_m_pct")} for r in res)
    if slug == "ward29":
        assert len(cam) == 240


def test_backend_wall_reproduces_the_stored_distances():
    """the drawer computes a live area's distance with the same wall: on Ward 29 it reproduces every stored row"""
    b = JS.bundle("ward29")
    for x in b["buildings"]:
        r = gate1pos.check(b, x, None, None, 3.5)                    # no stored rows: computed
        if r["case"] == "camera":
            assert abs(r["distance_m"] - ER.get("ward29")[x["id"]]["official_front_m"]) <= 0.01


def test_map_case_never_shows_a_distance():
    for slug in TRUST_AREAS:
        _, res = _checks(slug)
        for r in res:
            if r["case"] == "map":
                assert r["distance_m"] is None and r["within"] is None
            else:
                assert r["within"] == (r["distance_m"] <= 3.5)


def test_ward29_cases_and_corners():
    b = JS.bundle("ward29")
    roads = minimap.roads(b, None, os.path.join(S.data_dir, "cache", "streetpick"), bb=minimap.area_bounds(
        b, json.load(open(os.path.join(S.areas_dir, "ward29", "plan.json")))))
    _, res = _checks("ward29", roads["roads"] if roads["available"] else None)
    assert sum(r["case"] == "camera" for r in res) == 240 and sum(r["case"] == "map" for r in res) == 133
    assert all(r["front_street"] for r in res)
    for r in res:                                                       # corner ⇔ a side wall; street behind ⇔ a back wall
        assert r["corner"] == any(w["side"] == "side" for w in r["other_walls"])
        assert r["back_street"] == any(w["side"] == "back" for w in r["other_walls"])
        assert all(0 < w["dist_m"] <= gate1pos.FACE_M for w in r["other_walls"])
    assert any(r["corner"] for r in res) and not all(r["corner"] for r in res)


def test_corner_rule_on_a_synthetic_block():
    """a square building on the corner of two streets: the front is the own street, the other street is a side wall"""
    from geo_cascadia.geo import Frame
    fr = Frame(11.0, 77.0)
    ll = lambda x, y: list(fr.ll(x, y))
    ring = [ll(-5, -5), ll(5, -5), ll(5, 5), ll(-5, 5), ll(-5, -5)]
    st = lambda name, pts: {"name": name, "lines_latlon": [[ll(*p) for p in pts]]}
    bundle = {"streets": [st("Front St", [(-50, -9), (50, -9)]), st("Side St", [(9, -50), (9, 50)])],
              "buildings": [{"id": "x", "lat": 11.0, "lon": 77.0, "street": "Front St", "footprint": {"polygon_latlon": ring},
                             "predicted_position": {"method": "wall_centre", "lat": ll(0, -5)[0], "lon": ll(0, -5)[1]}}]}
    r = gate1pos.check(bundle, bundle["buildings"][0], None, None, 3.5)
    assert r["case"] == "map" and r["distance_m"] is None and r["front_street"] == "Front St"
    assert r["corner"] and not r["back_street"] and r["other_walls"] == [{"street": "Side St", "dist_m": 4.0, "side": "side"}]


def test_detail_endpoint_carries_the_check(client):
    c = client
    _, res = _checks("ward29")
    b = JS.bundle("ward29")
    cam = next(x["id"] for x, r in zip(b["buildings"], res) if r["case"] == "camera")
    pc = c.get(f"/buildings/ward29/{cam}").json()["position_check"]
    assert pc["case"] == "camera" and pc["from_trust"] and math.isclose(pc["distance_m"], ER.get("ward29")[cam]["official_front_m"])
    assert pc["area_stats"]["n"] == 240
