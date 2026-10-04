"""extras branch: F1 clean-ups remove only their own jobs, F2 the regression script prints UTF-8 anywhere, F4 the street
continuation is measured on the OpenStreetMap road."""
import json
import os
import subprocess
import sys
import uuid

import pytest
from shapely.geometry import LineString, shape

from app import jobs as jobs_mod
from app import streetpick
from app.settings import ROOT, Settings
from app.store import JsonStore
from geo_cascadia.geo import Frame

sys.path.insert(0, os.path.join(ROOT, "tools"))
import regression  # noqa: E402

POLY = {"type": "Polygon", "coordinates": [[[77.3425, 11.1080], [77.3440, 11.1080], [77.3440, 11.1092], [77.3425, 11.1080]]]}


# ------------------------------------------------------------------------------------------------ F1
@pytest.fixture
def bystander(online):
    """a job nobody in this test made, shaped like the one lost in the ui-fixes round: a real (not test) street job,
    cancelled before any worker started it, no area. Exactly what 'clear test jobs' by rule would have taken."""
    jid = str(uuid.uuid4())
    with online.app.state.data.pool.connection() as c:
        c.execute("""insert into jobs (id, kind, input, status, message, finished_at, is_test)
                     values (%s, 'street_click', %s, 'failed', %s, now(), false)""",
                  (jid, json.dumps({"name": "Unnamed road (bystander, extras F1 test)", "street": "bystander"}), jobs_mod.CANCELLED))
    yield jid
    with online.app.state.data.pool.connection() as c:
        c.execute("delete from jobs where id = %s", (jid,))          # the test's own row, by its id


def _exists(online, jid):
    return online.get(f"/jobs/{jid}").status_code == 200


def test_clear_test_jobs_needs_the_ids(online, bystander):
    r = online.post("/jobs/clear-test", json={"dry_run": False})
    assert r.status_code == 422 and "ids" in r.json()["detail"]
    assert _exists(online, bystander)
    dry = online.post("/jobs/clear-test", json={"dry_run": True}).json()
    assert bystander in [j["id"] for j in dry["jobs"]]                 # the rule would list it for a person to confirm…
    assert _exists(online, bystander)                                  # …but a dry run removes nothing


def test_a_pre_existing_job_survives_every_test_clean_up(online, bystander):
    made = []
    for _ in range(3):
        r = online.post("/jobs", json={"polygon": POLY, "name": "pytest extras F1", "test": True})
        assert r.status_code == 201, r.text
        made.append(r.json()["job"]["id"])
    online.post(f"/jobs/{made[0]}/cancel")
    # 1) the app's "clear test jobs" with the ids this test made (the way tests use it)
    r = online.post("/jobs/clear-test", json={"dry_run": False, "ids": [made[0]]}).json()
    assert r["removed"] == [made[0]] and _exists(online, bystander)
    # 2) the regression script's clean-up of left-over jobs (exact recorded ids)
    gone = regression.remove_own_jobs(made[1:2], online)
    assert [g[0] for g in gone] == [made[1]] and not _exists(online, made[1]) and _exists(online, bystander)
    # 3) the pytest fixtures' clean-up (delete by the ids recorded at creation)
    with online.app.state.data.pool.connection() as c:
        c.execute("delete from jobs where id = any(%s::uuid[])", (made[2:],))
    assert not _exists(online, made[2]) and _exists(online, bystander)
    assert regression.remove_own_jobs(made, online) == []             # nothing of ours left; the bystander untouched
    assert _exists(online, bystander)


def test_no_clean_up_deletes_by_name_status_or_pattern():
    """static check over every test and script: job rows are deleted by id only"""
    import re
    bad = []
    roots = [os.path.join(ROOT, "backend", "tests"), os.path.join(ROOT, "tools"), os.path.join(ROOT, "web", "scripts")]
    for root in roots:
        for fn in os.listdir(root):
            if not fn.endswith((".py", ".ts")) or fn == "test_extras.py":
                continue
            text = open(os.path.join(root, fn), encoding="utf-8").read()
            for m in re.finditer(r"delete from jobs where ([^\"']+)", text, re.I):
                if not re.match(r"id\s*(=|= any)", m.group(1).strip()):
                    bad.append(f"{fn}: delete from jobs where {m.group(1)[:60]}")
    assert not bad, bad


# ------------------------------------------------------------------------------------------------ F2
def test_regression_output_is_utf8_even_when_redirected(tmp_path):
    out = tmp_path / "out.txt"
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONIOENCODING", "PYTHONUTF8")}
    env["PYTHONUTF8"] = "0"
    code = ("import sys; sys.path.insert(0, r'%s'); import regression; %s regression.say('A → ✓ பதிவேட்டில் இல்லாத')"
            % (os.path.join(ROOT, "tools"), "{fix}"))
    with open(out, "wb") as f:
        p = subprocess.run([sys.executable, "-c", code.format(fix="regression.utf8_io();")], stdout=f, stderr=subprocess.PIPE,
                           env=env, cwd=ROOT, timeout=120)
    assert p.returncode == 0, p.stderr.decode("utf-8", "replace")
    assert "A → ✓ பதிவேட்டில் இல்லாத" in out.read_bytes().decode("utf-8")
    if os.name == "nt":                                               # the control: without it, Windows' code page crashes
        with open(tmp_path / "ctl.txt", "wb") as f:
            q = subprocess.run([sys.executable, "-c", code.format(fix="")], stdout=f, stderr=subprocess.PIPE, env=env, cwd=ROOT,
                               timeout=120)
        assert q.returncode != 0 and b"UnicodeEncodeError" in q.stderr


# ------------------------------------------------------------------------------------------------ F4
LAT, LON = 11.0300, 76.9700
F = Frame(LAT, LON)


def _ll(x, y=0.0):
    la, lo = F.ll(x, y)
    return {"lat": la, "lon": lo}


def _osm(monkeypatch, ways):
    """the named-street query answers these OSM ways (metre coordinates around LAT, LON)"""
    els = [{"type": "way", "id": i + 1, "tags": {"highway": "primary", "name": "Test Road"},
            "geometry": [_ll(x, y) for x, y in w]} for i, w in enumerate(ways)]
    monkeypatch.setattr(streetpick, "overpass", lambda q, cache_dir, deadline, per_call=None: (els, "local"))


def _area_bundle(x0, x1):
    """an analysed area whose street line stops at its outline (x0..x1 m along y = 0)"""
    ring = [F.ll(x, y)[::-1] for x, y in [(x0, -40), (x1, -40), (x1, 40), (x0, 40), (x0, -40)]]
    line = [list(F.ll(x, 0)[::-1]) for x in (x0, x1)]
    return {"slug": "t_area", "name": "Test area", "polygon": {"type": "Polygon", "coordinates": [ring]},
            "streets": [{"name": "Test Road", "osm_name": "Test Road", "way_ids": [1],
                         "geometry": {"type": "LineString", "coordinates": line}}]}


def test_continuation_from_an_area_is_measured_on_osm_and_said_to_be_outside(monkeypatch, tmp_path):
    _osm(monkeypatch, [[(-400, 0), (500, 0)]])                    # OSM: 900 m of one connected road
    b = _area_bundle(-100, 200)                                   # the area holds 300 m of it
    r = streetpick.pick(str(tmp_path), [b], LAT, LON)
    assert r["source"] == "area" and r["length_m"] == 300
    el = r["elsewhere"]
    # the continuation = OSM minus the picked piece (12 m cover at each end), within the 600 m window: 900 - 300 - 24
    assert abs(el["length_m"] - 576) <= 2 and el["joins"] and el["pieces"] == 0 and el["measured_on"] == "OpenStreetMap"
    assert el["outside_area"] == {"slug": "t_area", "name": "Test area"}
    w = streetpick.with_elsewhere(r)                              # include it: the picked piece + the OSM rest
    assert abs(w["length_m"] - 876) <= 2


def test_area_and_osm_give_the_same_continuation(monkeypatch, tmp_path):
    """two pieces of one name with a 60 m gap; the area's own lines hold only 50 m of the far piece"""
    _osm(monkeypatch, [[(-150, 0), (150, 0)], [(210, 0), (410, 0)]])
    b = _area_bundle(-150, 150)
    b["streets"][0]["geometry"]["coordinates"] = [[list(F.ll(x, 0)[::-1]) for x in (-150, 150)],
                                                  [list(F.ll(x, 0)[::-1]) for x in (210, 260)]]
    b["streets"][0]["geometry"]["type"] = "MultiLineString"
    b["polygon"]["coordinates"] = [[F.ll(x, y)[::-1] for x, y in [(-200, -40), (300, -40), (300, 40), (-200, 40), (-200, -40)]]]
    from_area = streetpick.pick(str(tmp_path), [b], LAT, LON)
    assert from_area["source"] == "area" and from_area["length_m"] == 300
    assert from_area["elsewhere"]["length_m"] == 200 and from_area["elsewhere"]["pieces"] == 1   # not the area's 50 m
    assert "outside_area" not in from_area["elsewhere"] or from_area["elsewhere"]["outside_area"]["slug"] == "t_area"
    # the same continuation through the D57 split alone (the area's lines) said 50 m
    assert streetpick.split_pieces(streetpick.pick_local([b], LAT, LON), LAT, LON)["elsewhere"]["length_m"] == 50


def test_one_piece_osm_pick_still_has_no_continuation(monkeypatch, tmp_path):
    _osm(monkeypatch, [[(-300, 0), (300, 0)]])
    res = {"street": "Test Road", "name_source": "osm", "osm_name": "Test Road", "length_m": 600, "way_ids": [1],
           "source": "cache", "polygon": {},
           "lines": {"type": "MultiLineString", "coordinates": [[list(F.ll(x, 0)[::-1]) for x in (-300, 300)]]}}
    out = streetpick.osm_continuation(res, [], LAT, LON, str(tmp_path))
    assert "elsewhere" not in out and out["length_m"] == 600


def test_osm_busy_keeps_the_area_answer_and_says_so(monkeypatch, tmp_path):
    def busy(*a, **k):
        raise streetpick.OverpassBusy("busy")
    monkeypatch.setattr(streetpick, "overpass", busy)
    b = _area_bundle(-100, 200)
    b["streets"][0]["geometry"] = {"type": "MultiLineString", "coordinates": [
        [list(F.ll(x, 0)[::-1]) for x in (-100, 200)], [list(F.ll(x, 0)[::-1]) for x in (300, 380)]]}
    r = streetpick.pick(str(tmp_path), [b], LAT, LON)
    assert r["elsewhere"]["length_m"] == 80 and "busy" in r["elsewhere"]["measured_on"]


def test_rathinapuri_real_data(online):
    """the real case: the analysed area's lines gave 65 m, OpenStreetMap 222 m. Now both give OSM's 222 m."""
    from app import mapdata
    mapdata.configure(online.app.state.data.pool)               # the session's offline app re-points the module
    mapdata._DOWN["until"] = 0
    S = Settings()
    js = JsonStore(S.areas_dir)
    bundles = [js.bundle(s) for s in js.slugs()]
    cache = os.path.join(S.data_dir, "cache", "streetpick")
    la, lo = 11.035838810963222, 76.96165158517604
    a = streetpick.pick(cache, bundles, la, lo)
    o = streetpick.pick(cache, [], la, lo)
    assert (a["source"], a["length_m"], a["elsewhere"]["length_m"]) == ("area", 327, 222)
    assert (o["length_m"], o["elsewhere"]["length_m"]) == (327, 222)
    assert a["elsewhere"]["measured_on"] == o["elsewhere"]["measured_on"] == "OpenStreetMap"


# ------------------------------------------------------------------------------------------------ extras 2: projection
def test_city_projection_is_a_range_from_our_runs(online):
    from app import projection
    p = online.get("/projection").json()
    assert p["available"] and p["is_estimate"] and {c["name"] for c in p["cities"]} == {"Coimbatore", "Tiruchirappalli", "Tiruppur", "Madurai"}
    runs = p["inputs"]["runs"]
    lo, hi = min(r["per_km"] for r in runs), max(r["per_km"] for r in runs)
    assert p["inputs"]["photos_per_km"]["low"] == lo and p["inputs"]["photos_per_km"]["high"] == hi
    for c in p["cities"]:
        assert c["km"] > 100
        assert c["photos"]["low"] == pytest.approx(c["km"] * lo) and c["photos"]["high"] == pytest.approx(c["km"] * hi)
        assert c["photos"]["low"] <= c["photos"]["mid"] <= c["photos"]["high"]
        assert c["usd"]["low"] <= c["usd"]["mid"] <= c["usd"]["high"]
        assert c["gpu_hours"]["low"] < c["gpu_hours"]["high"]
    assert any("list price" in a for a in p["assumptions"]) and any("Not checked" in a for a in p["assumptions"])
    # the road filter is the area stage's own (no service lanes, no bridges / tunnels)
    from geo_cascadia.area import ROAD_TYPES
    assert "service" not in ROAD_TYPES and "residential" in ROAD_TYPES
    assert projection.TTL_S > 0


# ------------------------------------------------------------------------------------------------ extras 3: OSM shops
def _shop_bundle():
    ring = lambda x0, y0: [list(F.ll(x, y)) for x, y in [(x0, y0), (x0 + 10, y0), (x0 + 10, y0 + 10), (x0, y0 + 10), (x0, y0)]]
    bld = lambda i, x, name=None, use=None: {"id": i, "street": "Test Road", "lat": F.ll(x + 5, 5)[0], "lon": F.ll(x + 5, 5)[1],
                                             "footprint": {"polygon_latlon": [[la, lo] for la, lo in ring(x, 0)]},
                                             "attributes": {"name": {"value": name, "quality": "good" if name else None},
                                                            "use": {"value": use}}}
    return {"slug": "t", "bbox": [LON - 0.01, LAT - 0.01, LON + 0.01, LAT + 0.01], "streets": [],
            "buildings": [bld("w1", 0, "Lala Sweets"), bld("w2", 40, None, "commercial"), bld("w3", 80, None, "residential")],
            "unmapped_businesses": [{"id": "ub-1", "street": "Test Road", "lat": F.ll(300, 5)[0], "lon": F.ll(300, 5)[1],
                                     "name": "Ruchi Hotel", "ocr_text": "RUCHI HOTEL"}]}


def _poi(i, x, y, **tags):
    la, lo = F.ll(x, y)
    return {"osm_type": "n", "osm_id": i, "lat": la, "lon": lo, "tags": tags, "found": True}


def test_shop_comparison_rules():
    from app import osmref
    b = _shop_bundle()
    tags = {"fetched": "x", "pois": [
        _poi(1, 24, 5, shop="confectionery", name="Lala Sweet Shop"),     # 14 m from w1, 16 m from w2: both in reach
        _poi(2, 45, 5, shop="clothes", name="Textiles"),                   # inside w2 (another name)
        _poi(3, 600, 0, amenity="restaurant", name="Far Away"),           # nobody within 25 m: OSM only
        _poi(4, 85, 5, amenity="place_of_worship", name="Koil"),          # not a business: left out
    ], "buildings": {}}
    sh = osmref.shops(b, tags)
    n = sh["counts"]
    assert (n["camera"], n["osm"], n["osm_other_points"]) == (3, 3, 1)            # w3 (a home, no sign) is not a business
    pairs = {m["camera"]["id"]: (m["osm"]["osm_id"], m["same_name"]) for m in sh["matched"]}
    assert pairs == {"w1": ("n1", True), "w2": ("n2", False)}                     # the same name is taken first
    assert [o["osm_id"] for o in sh["osm_only"]] == ["n3"]
    assert [c["id"] for c in sh["camera_only"]] == ["ub-1"]
    assert n["matched"] + n["camera_only"] == n["camera"] and n["matched"] + n["osm_only"] == n["osm"]
    assert "not an official register" in sh["note"]
    assert osmref.shops(b, None)["available"] is False


def test_osm_question_modes():
    from app import osmref
    assert osmref.extract_question("Businesses not in OpenStreetMap")[0] == "camera_only"
    assert osmref.extract_question("shops missing from OSM")[0] == "camera_only"
    assert osmref.extract_question("OpenStreetMap shops not seen by the camera")[0] == "osm_only"
    assert osmref.extract_question("businesses in OpenStreetMap")[0] == "matched"
    assert osmref.extract_question("Show commercial buildings with more than two visible floors")[0] is None


def test_osm_question_on_ward29(online):
    sh = online.get("/areas/ward29/osm").json()["shops"]
    r = online.post("/query", json={"area": "ward29", "text": "Businesses not in OpenStreetMap"}).json()
    assert r["intent"] == "osm_businesses" and r["understanding"]["status"] == "ok"
    assert r["total"] == sh["counts"]["camera_only"] == len(r["rows"])
    assert len(r["osm"]["points"]) == sh["counts"]["osm"]
    f = online.post("/query", json={"area": "ward29", "filters": {"intent": "osm_businesses", "osm": "osm_only"}}).json()
    assert f["total"] == sh["counts"]["osm_only"] and all(x["kind"] == "osm" for x in f["rows"])
    s = online.post("/query", json={"area": "ward29", "text": "Businesses not in OpenStreetMap on Sathy Main Road"}).json()
    assert s["parsed_filters"]["street"] == "Sathy Main Road" and all(x["street"] == "Sathy Main Road" for x in s["rows"])
    # the spec questions are untouched
    q = online.post("/query", json={"area": "ward29", "text": "Chart of unmatched buildings by street"}).json()
    assert q["intent"] == "buildings" and q["total"] == 27


# ------------------------------------------------------------------------------------------------ extras 4: floors
def test_floor_confidence_rule_and_levels(online):
    from app import osmref
    assert osmref.floor_confidence({"value": 2, "status": "measured"})["level"] == "high"
    assert osmref.floor_confidence({"value": 3, "status": "measured"})["level"] == "medium"
    assert osmref.floor_confidence({"value": 2, "status": "low_confidence"})["level"] == "low"
    assert osmref.floor_confidence({"value": None, "status": "not_measured"})["level"] is None
    assert osmref.parse_levels("3") == 3 and osmref.parse_levels("2;3") is None and osmref.parse_levels(None) is None
    lv = online.get("/areas/ward29/osm").json()["levels"]
    assert lv["available"] and lv["tagged"] == len(lv["rows"]) and lv["compared"] <= lv["tagged"]
    assert lv["exact"] <= lv["within_1"] <= lv["compared"]
    d = online.get("/buildings/ward29/w1247745270").json()
    assert d["floor_confidence"]["word"] in ("High", "Medium", "Low", "Not counted") and "rule" in d["floor_confidence"]
    assert d["osm_levels"]["loaded"] and d["osm_levels"]["osm_levels"] == "10"
    assert d["building"]["attributes"]["floors"]["value"] == 1                      # our count is never changed by OSM
