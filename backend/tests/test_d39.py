"""D39: mini-map context (roads around, camera stops), the key measurements on the examples, and the fixes from the real
Colab run (TensorFlow warning, browser-key check, OpenStreetMap retries). No network: Overpass and Google are stubbed.
"""
import json
import math
import os
import re
import types

import pytest

from app.settings import ROOT


@pytest.fixture(autouse=True)
def no_local_map_data(monkeypatch):
    """these tests fake Overpass: D53's local copy of the covered cities must not answer in its place"""
    import geo_cascadia.area as pipeline_area
    from app import mapdata
    monkeypatch.setattr(mapdata, "answer", lambda q: None)
    monkeypatch.setattr(mapdata, "ms_rings", lambda *a: None)
    monkeypatch.setattr(pipeline_area, "MAP_SOURCE", None)

AREAS = ["ward29", "trichy_bharathidasan_salai", "tiruppur_uthukuli_road"]


def _metres(a, b):
    return math.hypot((b["lon"] - a["lon"]) * 111320 * math.cos(math.radians(a["lat"])), (b["lat"] - a["lat"]) * 110540)


@pytest.fixture
def fake_osm(monkeypatch):
    """Overpass answers from a stub: one named road and one building around any point; `busy` makes it fail."""
    from app import minimap, streetpick
    state = {"busy": False, "calls": 0}

    def overpass(query, cache_dir, deadline, per_call=None):
        state["calls"] += 1
        if state["busy"]:
            raise streetpick.OverpassBusy("busy")
        if '"building"' in query:
            lat, lon = (float(x) for x in re.search(r"around:\d+,([-\d.]+),([-\d.]+)", query).groups())
            d = 0.0001
            return [{"geometry": [{"lat": lat - d, "lon": lon - d}, {"lat": lat - d, "lon": lon + d}, {"lat": lat + d, "lon": lon + d},
                                  {"lat": lat + d, "lon": lon - d}, {"lat": lat - d, "lon": lon - d}]}], False
        return [{"tags": {"highway": "residential", "name": "test road"}, "geometry": [{"lat": 11.0, "lon": 77.0}, {"lat": 11.001, "lon": 77.001}]},
                {"tags": {"highway": "service"}, "geometry": [{"lat": 11.0, "lon": 77.0}]}], False    # too short: skipped
    monkeypatch.setattr(streetpick, "overpass", overpass)
    minimap._failed.clear()
    yield state
    minimap._failed.clear()


@pytest.mark.parametrize("slug", AREAS)
def test_minimap_context_roads_and_every_camera_stop(client, fake_osm, slug):
    j = client.get(f"/areas/{slug}/minimap").json()
    plan = json.load(open(os.path.join(ROOT, "data", "areas", slug, "plan.json"), encoding="utf-8"))
    assert j["roads_available"] is True and j["roads"] == [{"name": "Test Road", "type": "residential", "lines": [[[11.0, 77.0], [11.001, 77.001]]]}]
    assert j["stops_available"] is True and len(j["stops"]) == len(plan)
    names = {s["name"] for s in client.get(f"/areas/{slug}").json().get("streets", [])} or None
    s0 = j["stops"][0]
    assert set(s0) == {"lat", "lon", "street", "headings"} and all(0 <= h < 360 for h in s0["headings"])
    if names:
        assert {s["street"] for s in j["stops"]} <= names | {None} | {s["street"] for s in j["stops"] if s["street"].startswith("(")}


def test_minimap_says_when_openstreetmap_is_busy_and_does_not_hammer_it(online, fake_osm):
    fake_osm["busy"] = True
    a = online.get("/areas/ward29/minimap").json()
    n = fake_osm["calls"]
    b = online.get("/areas/ward29/minimap").json()
    assert a["roads_available"] is False and a["roads"] == [] and len(a["stops"]) > 0
    assert b["roads_available"] is False and fake_osm["calls"] == n          # remembered for 2 minutes: no second wait


def test_area_bounds_come_from_the_street_geometry():
    from app import minimap
    b = {"streets": [{"geometry": {"type": "MultiLineString", "coordinates": [[[77.0, 11.0], [77.01, 11.01]]]}}], "buildings": []}
    s, w, n, e = minimap.area_bounds(b, None)
    assert s < 11.0 < 11.01 < n and w < 77.0 < 77.01 < e
    assert minimap.street_lines({"lines_latlon": [[[11.0, 77.0]]]}) == [[[11.0, 77.0]]]


def test_cameras_and_panoramas_examples_carry_the_key_measurement(client, fake_osm):
    for key in ("panos.thinned", "panos.off_street"):
        for ex in client.get(f"/areas/ward29/hood/examples?key={key}").json()["examples"]:
            m = ex["measure"]
            assert m and m["what"]
            said = re.match(r"(\d+) m from|on the street, but a camera stop (\d+) m", ex["reason"])
            if said:                                                        # the line's length is the number in the sentence
                assert abs(_metres(m["a"], m["b"]) - int(said.group(1) or said.group(2))) <= 1
    for ex in client.get("/areas/ward29/hood/examples?key=cameras.kept").json()["examples"]:
        assert ex["street"] and (ex["measure"] is None or _metres(ex["measure"]["a"], ex["measure"]["b"]) > 0)


def test_photo_examples_know_where_the_camera_stood(client, fake_osm):
    for key in ("det.pole", "signs.ocr", "views.mapped"):
        exs = client.get(f"/areas/ward29/hood/examples?key={key}").json()["examples"]
        assert exs and all(len(e["rays"]) == 1 and {"lat", "lon", "heading", "fov"} <= set(e["rays"][0]) for e in exs)


def test_dropped_camera_example_draws_the_building_it_stands_in(client, fake_osm):
    exs = client.get("/areas/ward29/hood/examples?key=cameras.inside").json()["examples"]
    assert exs and all(len(e["outline"]) == 5 and e["note"] is None for e in exs)
    fake_osm["busy"] = True
    from app import minimap
    minimap._failed.clear()
    assert minimap.building_at(11.0, 77.0, os.path.join(ROOT, "data", "cache", "streetpick")) is None


def test_job_minimap_before_and_after_the_run(online, fake_osm):
    poly = {"type": "Polygon", "coordinates": [[[77.3425, 11.1080], [77.3440, 11.1080], [77.3440, 11.1092], [77.3425, 11.1080]]]}
    j = online.post("/jobs", json={"polygon": poly, "name": "pytest d39", "test": True}).json()["job"]
    try:
        r = online.get(f"/jobs/{j['id']}/minimap").json()
        assert r["stops"] == [] and r["stops_available"] is False                # stops are planned when a worker runs it
    finally:
        with online.app.state.data.pool.connection() as c:
            c.execute("delete from jobs where id = %s", (j["id"],))


# ------------------------------------------------------------------------------------------ the worker cell
@pytest.fixture
def W(tmp_path, monkeypatch):
    src = open(os.path.join(ROOT, "worker", "colab_worker.py"), encoding="utf-8").read()
    for v in ("HOME", "USERPROFILE"):
        monkeypatch.setenv(v, str(tmp_path))
    for v in ("USE_TF", "TRANSFORMERS_NO_TF"):
        monkeypatch.delenv(v, raising=False)                               # restored after the test
    g = {"__name__": "colab_worker_test"}
    exec(compile(src.rstrip()[:-len("main()")], "colab_worker.py", "exec"), g)
    g["WORK_DIR"] = str(tmp_path / "work")
    os.makedirs(g["WORK_DIR"])
    return types.SimpleNamespace(g=g, tmp=tmp_path)


def test_transformers_is_told_not_to_load_tensorflow(W):
    assert os.environ["USE_TF"] == "0" and os.environ["TRANSFORMERS_NO_TF"] == "1"


def test_tensorflow_is_detected_with_the_exact_fix(W, monkeypatch, capsys):
    import importlib.metadata as md
    monkeypatch.setattr(md, "version", lambda p: {"tensorflow": "2.19.0", "tf-keras": "2.19.0"}.get(p) or (_ for _ in ()).throw(md.PackageNotFoundError(p)))
    assert W.g["check_tensorflow"]() == ["tensorflow 2.19.0", "tf-keras 2.19.0"]
    out = capsys.readouterr().out
    assert "pip uninstall -y tensorflow tf-keras tensorflow-hub" in out and "USE_TF=0" in out and "TRANSFORMERS_NO_TF=1" in out
    monkeypatch.setattr(md, "version", lambda p: (_ for _ in ()).throw(md.PackageNotFoundError(p)))
    assert W.g["check_tensorflow"]() == [] and capsys.readouterr().out == ""


class Resp:
    def __init__(self, j):
        self.j = j

    def json(self):
        return self.j


def test_browser_key_is_caught_by_one_free_call(W, monkeypatch):
    rq = W.g["requests"]
    monkeypatch.setattr(rq, "get", lambda *a, **k: Resp({"status": "REQUEST_DENIED", "error_message": "API keys with referer restrictions cannot be used with this API."}))
    assert W.g["google_key_problem"]("k") == W.g["BROWSER_KEY"]
    monkeypatch.setattr(rq, "get", lambda *a, **k: Resp({"status": "OK"}))
    assert W.g["google_key_problem"]("k") is None
    monkeypatch.setattr(rq, "get", lambda *a, **k: (_ for _ in ()).throw(ConnectionError()))
    assert W.g["google_key_problem"]("k") is None                           # no answer: never blocks the worker
    assert "only works in a browser" in W.g["BROWSER_KEY"] and "Enter keeps the one from the setup cells" in W.g["BROWSER_KEY"]


def test_keys_ask_again_for_a_server_key(W, monkeypatch, capsys):
    W.g["google_key_problem"] = lambda key: W.g["BROWSER_KEY"] if key == "BROWSERKEY" else None
    answers = iter(["", " SERVER KEY \n"])                                  # Enter keeps the setup key (browser) → asked again
    monkeypatch.setattr(W.g["getpass"], "getpass", lambda p: next(answers))
    cfg = types.SimpleNamespace(maps_key="BROWSERKEY")
    W.g["keys"](cfg, only_google=True)
    assert cfg.maps_key == "SERVERKEY" and "only works in a browser" in capsys.readouterr().out


def test_mid_job_errors_are_named_plainly(W):
    classify = W.g["classify"]
    code, msg = classify(RuntimeError('Places HTTP 403: {"error": {"message": "Requests from referer <empty> are blocked."}}'))
    assert code == "GOOGLE_BROWSER_KEY" and msg == W.g["BROWSER_KEY"]
    code, msg = classify(RuntimeError("Overpass unavailable on all mirrors — retry in a few minutes"))
    assert code == "FAILED" and "Retry" in msg and "OpenStreetMap" in msg


def _job(W, fails, capsys):
    W.g["OVERPASS_RETRY_S"] = (0, 0, 0)
    calls = {"n": 0}

    def run_area(poly, out, cfg, **k):
        calls["n"] += 1
        if calls["n"] <= fails:
            raise RuntimeError("Overpass unavailable on all mirrors — retry in a few minutes")
        json.dump({}, open(os.path.join(out, "export.json"), "w"))
        return {"meta": {"run": {}}}, None

    notes = []

    class Api:
        def call(self, path, body=None, **k):
            if path == "/worker/progress":
                notes.append(body.get("note"))
            return {"job_status": "running"}

        def call_or_ask(self, *a, **k):
            return {}
    cfg = types.SimpleNamespace(device="gpu", ocr_mode="full", places_max_calls=10, sv_price=0.007)
    import dataclasses

    @dataclasses.dataclass
    class C:
        device: str = "gpu"
        ocr_mode: str = "full"
        places_max_calls: int = 10
        sv_price: float = 0.007
    W.g["run_job"](Api(), {"id": "11111111-2222-3333-4444-555555555555", "input": {"slug": "pytest_d39", "name": "T"}}, C(), run_area,
                   {"id": "w", "cancel": False})
    return calls["n"], [n for n in notes if n]


def test_openstreetmap_outage_is_retried_by_the_worker(W, capsys):
    n, notes = _job(W, 2, capsys)
    assert n == 3
    assert "Map server busy (OpenStreetMap), retrying in 0 s… (try 1 of 3)" in notes
    assert notes[-1] == "Map server was busy (OpenStreetMap); continuing after 2 retries."


def test_openstreetmap_outage_fails_after_the_last_try(W, capsys):
    with pytest.raises(RuntimeError, match="Overpass"):
        _job(W, 4, capsys)
