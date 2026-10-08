"""D64: M3 at level 2 — the pipeline chooses each building's box with M3 (geo_cascadia.boxpick); the box shown is the box
read and positioned; "none" gives no box and no camera position. The backend's box_choice uses the same functions and,
for a level-2 area, takes the run's own choice. Hidden areas (a re-run kept out of the area list until the switch) and a
re-run that keeps an area's register."""
import json
import os

import pytest
from shapely.geometry import Polygon, box as sbox
from shapely.strtree import STRtree

from app import boxchoice, loader
from app.settings import ROOT
from app.store import JsonStore
from geo_cascadia import boxpick
from geo_cascadia.area import Area
from geo_cascadia.buildloc import predict_positions
from geo_cascadia.config import Config
from geo_cascadia.geometry import building_views
from test_p6 import W, _upload, claim, jobs  # noqa: F401  (fixtures + helpers of the worker protocol tests)


# ------------------------------------------------------------------ the rule, one copy
def test_one_rule_frozen_parameters():
    assert boxchoice.choose is boxpick.choose and boxchoice.first_hits is boxpick.first_hits and boxchoice.span is boxpick.span
    assert (boxpick.STEP, boxpick.MAX_R, boxpick.START_M, boxpick.MIN_OVERLAP) == (4, 60.0, 1.5, 0.4)
    assert Config().box_rule == "m3"


def _area(polys):
    """a real pipeline Area around (lat 11, lon 77) with the given outlines in local metres (camera at the origin)"""
    a = Area(sbox(76.999, 10.999, 77.001, 11.001), "unused", 40.0)
    a.footprints = [Polygon(p) for _, p in polys]
    a.fp_ids = [i for i, _ in polys]
    a.idx_of = {f: i for i, f in enumerate(a.fp_ids)}
    a.tree = STRtree(a.footprints)
    return a


def _det(a, x1, x2, conf, pano="P1"):
    lat, lon = a.frame.ll(0.0, 0.0)
    return {"cls": "building", "geom_ok": True, "pano_id": pano, "heading": 0.0, "pitch": 0.0, "fov": 90.0, "W": 640, "H": 640,
            "u": (x1 + x2) / 2, "x1": x1, "x2": x2, "y1": 100.0, "y2": 500.0, "conf": conf, "camera_lat": lat, "camera_lon": lon}


@pytest.fixture
def small_in_front():
    """a small house 8 m ahead (columns ~240-400) in front of a wide warehouse 20 m ahead (the rest of the photo); the
    detector's warehouse box is wider and the more confident one — today's rule gives it to the house"""
    a = _area([("house", [(-2, 8), (2, 8), (2, 12), (-2, 12)]), ("warehouse", [(-40, 20), (40, 20), (40, 30), (-40, 30)])])
    return a, [_det(a, 60, 520, 0.9), _det(a, 240, 400, 0.5)]


def test_small_building_in_front_gets_its_own_box(small_in_front):
    a, dets = small_in_front
    m3 = boxpick.assign(dets, a)
    assert [(p["fp"], p["status"], p["changed"]) for p in m3["pairs"]] == [("house", "box", True)]
    assert m3["pairs"][0]["box"] == [240, 100.0, 400, 500.0] and m3["pairs"][0]["old_box"] == [60, 100.0, 520, 500.0]
    r = m3["rays"][0]
    assert r["fp"] == "house" and r["x1"] == 240 and r["ray_dist_m"] == pytest.approx(8.0, abs=0.01)
    # the building's evidence view (shown + read by the cloud model) is the same box, with the M3 tag
    v = building_views(dets, a, chosen=m3["rays"])
    assert [(q["fp"], q["x1"], q["box_rule"], q["n_views"]) for q in v] == [("house", 240, "M3", 1)]
    # today's rule: the warehouse box for the house
    assert [(q["fp"], q["x1"]) for q in building_views(dets, a)] == [("house", 60)]


def test_none_gives_no_box_and_no_camera_position(small_in_front):
    a, dets = small_in_front
    dets = [dets[0]]                                                  # only the warehouse box: 0.35 overlap with the house
    m3 = boxpick.assign(dets, a)
    assert m3["pairs"][0]["status"] == "none" and m3["pairs"][0]["score"] < 0.4 and m3["rays"] == []
    assert building_views(dets, a, chosen=m3["rays"]) == []
    bld = [{"building_id": "house", "lat": 11.0, "lon": 77.0, "street": "s",
            "footprint_latlon": [list(a.frame.ll(x, y)) for x, y in [(-2, 8), (2, 8), (2, 12), (-2, 12), (-2, 8)]]}]
    pos = predict_positions(dets, a, bld, {}, Config(), rays=m3["rays"])
    assert pos["house"]["cameras_seen"] == 0 and pos["house"]["n_cameras"] == 0     # the outline still places it


def test_summary_counts():
    s = boxpick.summary([{"status": "box", "changed": True}, {"status": "none", "changed": False}, {"status": "box", "changed": False}])
    assert s == {"rule": "M3", "pairs": 3, "box": 2, "none": 1, "changed": 1}


# ------------------------------------------------------------------ the backend takes a level-2 run's own choice
def test_level2_area_box_choice_is_the_runs_own(tmp_path):
    av = {"pano_id": "P1", "heading": 10.0, "pitch": 0.0, "fov": 90, "x1": 240, "y1": 100, "x2": 400, "y2": 500}
    exp = {"buildings": [{"id": "w1", "evidence": {"attribute_view": av}}, {"id": "w2", "evidence": {}}]}
    bv = [{"fp": "w1", **av, "box_rule": "M3", "m3_score": 0.9},
          {"fp": "w2", **{**av, "x1": 0, "x2": 200}, "box_rule": "M3", "m3_score": 0.55}]
    for n, o in (("export.json", exp), ("building_views.json", bv), ("detections.json", [{"cls": "building"}])):
        (tmp_path / n).write_text(json.dumps(o), encoding="utf-8")
    c = boxchoice.compute(str(tmp_path), str(tmp_path / "no-cache"))
    assert c["level"] == 2 and c["counts"] == {"same": 2}
    rows = {b: next(iter(v.values())) for b, v in c["buildings"].items()}
    assert rows["w1"]["status"] == "same" and rows["w1"]["box"] == rows["w1"]["analysis_box"] == [240, 100, 400, 500]
    assert rows["w2"]["view"] == "best" and rows["w2"]["score"] == 0.55


# ------------------------------------------------------------------ hidden areas
def test_hidden_marker_keeps_an_area_out_of_the_offline_list(tmp_path):
    for s in ("a1", "a2"):
        os.makedirs(tmp_path / s)
        (tmp_path / s / "export.json").write_text("{}", encoding="utf-8")
    (tmp_path / "a2" / loader.HIDDEN_FILE).write_text("{}", encoding="utf-8")
    assert JsonStore(str(tmp_path)).slugs() == ["a1"] and loader.is_hidden(str(tmp_path / "a2"))


def test_hidden_rerun_job_end_to_end(online, W, jobs):  # noqa: F811
    """a hidden job: not in the Jobs list or the top bar; the worker gets the named area's register; its area is
    delivered hidden (not in /areas, its own address answers)"""
    j = jobs("pytest d64 hidden")
    with online.app.state.data.pool.connection() as c:
        c.execute("""update jobs set input = input || '{"hidden": true, "hidden_why": "pytest",
                     "register_from": "tiruppur_uthukuli_road"}'::jsonb where id = %s""", (j["id"],))
    assert all(x["id"] != j["id"] for x in online.get("/jobs").json()["jobs"])
    assert online.get(f"/jobs/{j['id']}").status_code == 200
    claim(online, W, j["id"])
    assert online.get("/jobs?active=1").json()["worker"]["job"] is None              # not named in the top bar
    reg = online.post("/worker/register", headers=W, json={"job": j["id"]})
    src = os.path.join(ROOT, "data", "areas", "tiruppur_uthukuli_road")
    assert reg.status_code == 200 and reg.json()["from"] == "tiruppur_uthukuli_road"
    assert reg.json()["records"] == json.load(open(os.path.join(src, "register_synthetic.json"), encoding="utf-8"))
    r = _upload(online, W, j["id"], resumed=False)
    assert r.status_code == 200, r.text
    slug = r.json()["job"]["area_slug"]
    assert os.path.isfile(os.path.join(ROOT, "data", "areas", slug, loader.HIDDEN_FILE))
    assert all(a["slug"] != slug for a in online.get("/areas").json()["areas"])
    assert online.get(f"/areas/{slug}").status_code == 200
    with online.app.state.data.pool.connection() as c:
        assert c.execute("select hidden from areas where slug = %s", (slug,)).fetchone()[0] is True


def test_register_endpoint_needs_a_named_area(online, W, jobs):  # noqa: F811
    j = jobs("pytest d64 no register")
    assert online.post("/worker/register", headers=W, json={"job": j["id"]}).status_code == 404
    assert online.post("/worker/register", json={"job": j["id"]}).status_code == 401
