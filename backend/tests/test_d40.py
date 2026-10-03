"""D40: streets with gaps (MultiPolygon job areas) and "no Street View" vs a refused / failed Street View request.

1. A street whose OSM ways leave gaps buffers into several pieces: the picker, a trimmed stretch, the preview and the
   job input keep every piece (a MultiPolygon, 2 or 3 parts here); the worker and the pipeline's discovery accept it.
2. An unhandled server error is a JSON 500 that carries CORS headers (the browser showed "API not reachable").
3. The worker tells "no imagery" (Google answered ZERO_RESULTS) from a refused key, a quota, a network failure or an
   empty area, using the pipeline's own StreetView.discover with a fake HTTP layer. Never the key in any message.
No network, no GPU; Overpass and Google are faked. The backend tests use test jobs only.
"""
import dataclasses
import importlib
import json
import os
import sys
import types

import pytest
import requests
from shapely.geometry import MultiLineString, Point, mapping, shape

from app import streetpick
from app.settings import ROOT
from geo_cascadia.geo import Frame


@pytest.fixture(autouse=True)
def no_local_map_data(monkeypatch):
    """these tests fake Overpass: D53's local copy of the covered cities must not answer in its place"""
    import geo_cascadia.area as pipeline_area
    from app import mapdata
    monkeypatch.setattr(mapdata, "answer", lambda q: None)
    monkeypatch.setattr(mapdata, "ms_rings", lambda *a: None)
    monkeypatch.setattr(pipeline_area, "MAP_SOURCE", None)

LAT0, LON0 = 13.4321, 79.1234                  # nowhere near an analysed area or a cached click
SEGMENTS = [(0, 200), (350, 550), (700, 900)]  # metres east; 150 m gaps (> 2 × the 45 m buffer)
NAME = "Gap Test Road"
F0 = Frame(LAT0, LON0)


def ll(x, y=0.0):
    la, lo = F0.ll(x, y)
    return la, lo


def way(i, a, b):
    return {"type": "way", "id": 990000 + i, "tags": {"highway": "residential", "name": NAME},
            "geometry": [{"lat": ll(x)[0], "lon": ll(x)[1]} for x in range(a, b + 1, 50)]}


def stretch(*ranges):
    """GeoJSON MultiLineString (lon/lat) of the given x ranges on the street."""
    return {"type": "MultiLineString", "coordinates": [[[ll(x)[1], ll(x)[0]] for x in (a, (a + b) / 2, b)] for a, b in ranges]}


@pytest.fixture
def gap_road(monkeypatch):
    """Overpass answers with the named road in pieces; returns a function setting how many pieces exist."""
    state = {"n": 3}
    monkeypatch.setattr(streetpick, "overpass",
                        lambda q, cache_dir, deadline, per_call=None: ([way(i, *SEGMENTS[i]) for i in range(state["n"])], False))
    return state


def parts(geojson):
    g = shape(geojson)
    return list(g.geoms) if g.geom_type == "MultiPolygon" else [g]


def covers_every_piece(poly_geojson, ranges):
    g = shape(poly_geojson)
    return all(g.contains(Point(ll((a + b) / 2)[::-1])) for a, b in ranges)


# ------------------------------------------------------------------------------------------ 1. streets with gaps
@pytest.mark.parametrize("n, click_x", [(2, 100), (3, 450)])
def test_whole_street_with_gaps_keeps_every_piece(gap_road, tmp_path, n, click_x):
    gap_road["n"] = n
    la, lo = ll(click_x)
    res = streetpick.pick(str(tmp_path), [], la, lo)
    g = shape(res["polygon"])
    assert res["polygon"]["type"] == "MultiPolygon" and len(parts(res["polygon"])) == n and g.is_valid
    assert covers_every_piece(res["polygon"], SEGMENTS[:n])
    assert abs(res["length_m"] - 200 * n) <= 2 and len(res["lines"]["coordinates"]) == n
    assert all(abs(x) < 180 and abs(y) < 90 for p in parts(res["polygon"]) for x, y in p.exterior.coords)   # lon/lat


def test_a_street_without_gaps_is_still_one_polygon(gap_road, tmp_path):
    gap_road["n"] = 1
    res = streetpick.pick(str(tmp_path), [], *ll(100))
    assert res["polygon"]["type"] == "Polygon"


@pytest.mark.parametrize("ranges, n", [
    ([(100, 200), (350, 450)], 2),                          # the trimmed stretch still spans one gap
    ([(150, 200), (350, 550), (700, 750)], 3),              # … or two gaps
    ([(360, 540)], 1),                                      # inside one piece: a single polygon
])
def test_trimmed_street_with_gaps(gap_road, tmp_path, ranges, n):
    res = streetpick.pick(str(tmp_path), [], *ll(450))
    t = streetpick.trim(res, stretch(*ranges))
    assert t["trimmed"] and len(parts(t["polygon"])) == n and shape(t["polygon"]).is_valid
    assert t["polygon"]["type"] == ("MultiPolygon" if n > 1 else "Polygon")
    assert covers_every_piece(t["polygon"], ranges)
    assert abs(t["length_m"] - sum(b - a for a, b in ranges)) <= 2 and t["full_length_m"] == res["length_m"]


@pytest.fixture
def click_cache():
    """The API's own click cache (picks2) for the fake street: removed afterwards."""
    from app.settings import Settings
    d = os.path.join(Settings().data_dir, "cache", "streetpick", "picks2")
    made = lambda: {f for f in os.listdir(d)} if os.path.isdir(d) else set()
    before = made()
    yield
    for f in made() - before:
        os.remove(os.path.join(d, f))


def test_preview_of_a_street_with_gaps_is_not_a_500(offline, gap_road, click_cache):
    la, lo = ll(450)
    r = offline.post("/jobs/preview", json={"lat": la, "lon": lo})
    assert r.status_code == 200, r.text
    assert r.json()["polygon"]["type"] == "MultiPolygon" and len(parts(r.json()["polygon"])) == 3


@pytest.mark.parametrize("trim", [None, [(100, 200), (350, 450)]])
def test_job_input_keeps_the_multipolygon(online, gap_road, click_cache, trim):
    la, lo = ll(450 if trim is None else 150)
    body = {"lat": la, "lon": lo, "test": True, **({"lines": stretch(*trim)} if trim else {})}
    r = online.post("/jobs", json=body)
    try:
        assert r.status_code == 201, r.text
        inp = r.json()["job"]["input"]
        assert inp["polygon"]["type"] == "MultiPolygon" and len(parts(inp["polygon"])) == (3 if trim is None else 2)
        assert bool(inp.get("trimmed")) == bool(trim)
    finally:
        if r.status_code == 201:
            with online.app.state.data.pool.connection() as c:
                c.execute("delete from jobs where id = %s", (r.json()["job"]["id"],))


def test_pipeline_area_takes_a_multipolygon(gap_road, tmp_path):
    """run_area's area model (pipeline, unchanged) with the picker's MultiPolygon."""
    from geo_cascadia.area import Area
    res = streetpick.pick(str(tmp_path), [], *ll(450))
    a = Area(shape(res["polygon"]), str(tmp_path), 40.0)
    assert a.poly_L.geom_type == "MultiPolygon" and len(a.poly_L.geoms) == 3
    assert all(a.poly_L.contains(Point(a.L(*ll((x0 + x1) / 2)))) for x0, x1 in SEGMENTS)


# ------------------------------------------------------------------------------------------ 2. a 500 the browser can read
def test_server_error_is_json_with_cors(offline, monkeypatch):
    def boom(*a, **k):
        raise AttributeError("'MultiPolygon' object has no attribute 'exterior'")
    monkeypatch.setattr(streetpick, "pick", boom)
    r = offline.post("/jobs/preview", json={"lat": LAT0, "lon": LON0}, headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 500
    assert r.json()["detail"] == "server error (AttributeError)" and r.json()["server_error"] is True
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"   # else fetch fails → "not reachable"


# ------------------------------------------------------------------------------------------ 3. the worker's verdict
KEY = "AIzaSyTEST_" + "k" * 28


@pytest.fixture
def sv(monkeypatch):
    """The pipeline's real streetview module (Pillow is not in the API venv: a stub, only Image is referenced)."""
    pil = types.ModuleType("PIL")
    pil.Image = types.SimpleNamespace()
    monkeypatch.setitem(sys.modules, "PIL", pil)
    sys.modules.pop("geo_cascadia.streetview", None)
    mod = importlib.import_module("geo_cascadia.streetview")
    yield mod
    sys.modules.pop("geo_cascadia.streetview", None)


class Resp:
    def __init__(self, status_code, body):
        self.status_code, self.body, self.text = status_code, body, json.dumps(body)

    def json(self):
        return self.body


def google(answer):
    """A fake `requests` for the streetview module. answer(lat, lon) -> Resp, or raises."""
    calls = []

    def get(url, params=None, timeout=None):
        la, lo = map(float, params["location"].split(","))
        calls.append((la, lo))
        return answer(la, lo)
    return types.SimpleNamespace(get=get, RequestException=requests.RequestException, calls=calls)


def pano_here(la, lo):
    return Resp(200, {"status": "OK", "pano_id": f"p{la:.5f}_{lo:.5f}", "location": {"lat": la, "lng": lo},
                      "copyright": "© Google", "date": "2025-01"})


ZERO = lambda la, lo: Resp(200, {"status": "ZERO_RESULTS"})
DENIED = lambda la, lo: Resp(200, {"status": "REQUEST_DENIED",
                                   "error_message": "This API key is not authorized to use this service or API."})
REFERER = lambda la, lo: Resp(200, {"status": "REQUEST_DENIED",
                                    "error_message": "API keys with referer restrictions cannot be used with this API."})
QUOTA = lambda la, lo: Resp(429, {"status": "OVER_QUERY_LIMIT", "error_message": "You have exceeded your daily request quota."})


def NETWORK(la, lo):
    raise requests.ConnectionError(f"HTTPSConnectionPool: Max retries exceeded with url: /maps/api/streetview/metadata"
                                   f"?location={la},{lo}&key={KEY}")


@pytest.fixture
def W(tmp_path, monkeypatch):
    src = open(os.path.join(ROOT, "worker", "colab_worker.py"), encoding="utf-8").read()
    g = {"__name__": "colab_worker_test"}
    monkeypatch.chdir(tmp_path)
    for v in ("HOME", "USERPROFILE"):
        monkeypatch.setenv(v, str(tmp_path))
    exec(compile(src.rstrip()[:-len("main()")], "colab_worker.py", "exec"), g)
    g.update(WORK_DIR=str(tmp_path / "work"), DRIVE_JOBS_DIR=tmp_path.as_posix() + "/no_drive/gc_worker_jobs")
    os.makedirs(g["WORK_DIR"], exist_ok=True)
    return types.SimpleNamespace(g=g, out=os.path.join(g["WORK_DIR"], "pytest_d40"))


@dataclasses.dataclass
class Cfg:
    device: str = "gpu"
    ocr_mode: str = "full"
    places_max_calls: int = 100
    sv_price: float = 0.007
    maps_key: str = KEY


class Api:
    def __init__(self):
        self.calls = []

    def call(self, path, body=None, **k):
        self.calls.append((path, body))
        return {"job_status": "running"}

    call_or_ask = call


def pipeline_run_area(sv_mod, found):
    """run_area's first stage as the pipeline has it: shape() the input, resume panos.json or discover, save it, raise
    NO_STREET_VIEW when empty. Its module name points the worker's trace at the pipeline's streetview module."""
    def run_area(polygon, out_dir, cfg=None, **k):
        poly = shape(polygon) if isinstance(polygon, dict) else polygon
        p = os.path.join(out_dir, "panos.json")
        panos = json.load(open(p)) if os.path.exists(p) else None
        if panos is None:
            panos, _ = sv_mod.StreetView(cfg.maps_key).discover(poly, 20, 15)
        json.dump(panos, open(p, "w"))
        if not panos:
            raise RuntimeError("NO_STREET_VIEW: Google has no outdoor Street View imagery on this selection")
        found.append((poly, panos))
        return {"meta": {"run": {"places_calls": 0}}}, None
    run_area.__module__ = "geo_cascadia.run_area"
    return run_area


def run(W, sv_mod, answer, monkeypatch, polygon=None, capsys=None):
    fake = google(answer)
    monkeypatch.setattr(sv_mod, "requests", fake)
    polygon = polygon or streetpick._area_ll(F0, MultiLineString([[F0.xy(*ll(a)), F0.xy(*ll(b))] for a, b in SEGMENTS]))
    job = {"id": "d40d40d4-0000-0000-0000-000000000000",
           "input": {"slug": "pytest_d40", "name": NAME, "polygon": mapping(polygon)}}
    found = []
    err = None
    try:
        W.g["run_job"](Api(), job, Cfg(), pipeline_run_area(sv_mod, found), {"id": "w", "cancel": False})
    except Exception as e:                                                   # noqa: BLE001 — the verdict is the test
        err = e
    assert sv_mod.requests is fake                                          # the trace is removed after the run
    return err, found, fake.calls


def verdict(W, err):
    return W.g["classify"](err)


def test_no_imagery_is_no_street_view(W, sv, monkeypatch):
    err, found, calls = run(W, sv, ZERO, monkeypatch)
    code, msg = verdict(W, err)
    assert code == "NO_STREET_VIEW" and calls and f"({len(calls)} points checked)" in msg


@pytest.mark.parametrize("answer, code, bits", [
    (DENIED, "GOOGLE_KEY", ["HTTP 200 REQUEST_DENIED", "not authorized to use this service", "Street View Static API"]),
    (QUOTA, "GOOGLE_REQUEST", ["HTTP 429 OVER_QUERY_LIMIT", "daily request quota", "quota is used up"]),
    (NETWORK, "GOOGLE_REQUEST", ["network error (ConnectionError)", "could not reach Google"]),
])
def test_request_errors_are_not_no_imagery(W, sv, monkeypatch, capsys, answer, code, bits):
    err, found, calls = run(W, sv, answer, monkeypatch)
    got, msg = verdict(W, err)
    assert got == code and msg.startswith("Street View request failed") and "not a lack of imagery" in msg
    assert all(b in msg for b in bits), msg
    assert f"of {len(calls)} look-ups" in msg or answer is NETWORK             # the pipeline retries a network error
    assert KEY not in msg and KEY not in capsys.readouterr().out
    assert not os.path.exists(os.path.join(W.out, "panos.json"))             # Retry searches again


def test_browser_key_is_named_as_such(W, sv, monkeypatch):
    err, _, _ = run(W, sv, REFERER, monkeypatch)
    assert verdict(W, err) == ("GOOGLE_BROWSER_KEY", W.g["BROWSER_KEY"])


def test_an_area_with_no_search_point_is_a_bad_area(W, sv, monkeypatch):
    from shapely.geometry import Polygon
    tiny = Polygon([ll(0, 0)[::-1], ll(3, 0)[::-1], ll(0, 3)[::-1]])         # smaller than the 20 m search grid
    err, _, calls = run(W, sv, pano_here, monkeypatch, polygon=tiny)
    code, msg = verdict(W, err)
    assert not calls and code == "BAD_AREA" and "no look-up was made" in msg


def test_retry_after_a_refused_key_searches_again(W, sv, monkeypatch):
    err, _, _ = run(W, sv, DENIED, monkeypatch)
    assert verdict(W, err)[0] == "GOOGLE_KEY"
    os.makedirs(W.out, exist_ok=True)
    json.dump([], open(os.path.join(W.out, "panos.json"), "w"))             # an older worker left an empty search
    err, found, calls = run(W, sv, pano_here, monkeypatch)
    assert err is None and calls and found and found[0][1]


def test_worker_and_discovery_take_a_street_with_three_pieces(W, sv, monkeypatch):
    err, found, _ = run(W, sv, pano_here, monkeypatch)
    assert err is None
    poly, panos = found[0]
    assert poly.geom_type == "MultiPolygon" and len(poly.geoms) == 3
    hit = {i for p in panos for i, piece in enumerate(poly.geoms) if piece.contains(Point(p["camera_lon"], p["camera_lat"]))}
    assert hit == {0, 1, 2}                                                  # panoramas found along every piece


def test_some_refused_look_ups_in_a_run_that_goes_on_are_reported(W, sv, monkeypatch, capsys):
    n = {"i": 0}

    def flaky(la, lo):
        n["i"] += 1
        return DENIED(la, lo) if n["i"] % 5 == 0 else pano_here(la, lo)
    note = os.path.join(W.out, "worker_run.json")
    orig_forget = W.g["forget"]
    kept = {}

    def forget(job, out):                                                    # read the note before the folder goes
        kept.update(json.load(open(note)))
        orig_forget(job, out)
    W.g["forget"] = forget
    err, found, _ = run(W, sv, flaky, monkeypatch)
    out = capsys.readouterr().out
    assert err is None and "⚠ Street View look-ups failed: HTTP 200 REQUEST_DENIED" in out and KEY not in out
    assert kept["street_view_errors"] and "look-ups" in kept["street_view_errors"][0]


# ------------------------------------------------------------------------------------------ 4. the backend's statuses
POLY = {"type": "Polygon", "coordinates": [[[77.3425, 11.1080], [77.3440, 11.1080], [77.3440, 11.1092], [77.3425, 11.1080]]]}


def test_request_errors_fail_as_retryable_and_no_imagery_does_not(online):
    tok = online.app.state.settings.worker_token
    if not tok:
        pytest.skip("WORKER_TOKEN not configured")
    H = {"X-Worker-Token": tok}
    made = []
    try:
        for code, status, retryable in [("GOOGLE_KEY", "failed", True), ("GOOGLE_REQUEST", "failed", True),
                                        ("BAD_AREA", "failed", True), ("NO_STREET_VIEW", "no_street_view", False)]:
            j = online.post("/jobs", json={"polygon": POLY, "name": f"pytest d40 {code}", "test": True}).json()["job"]
            made.append(j["id"])
            assert online.post("/worker/next", headers=H, json={"worker_id": "pytest-d40", "job": j["id"]}).json()["job"]["id"] == j["id"]
            msg = "Street View request failed: HTTP 200 REQUEST_DENIED — not authorized. This is not a lack of imagery"
            r = online.post("/worker/fail", headers=H, json={"job": j["id"], "code": code, "message": msg, "worker_id": "pytest-d40"})
            got = r.json()["job"]
            assert got["status"] == status and got["retryable"] is retryable and got["message"] == msg
    finally:
        with online.app.state.data.pool.connection() as c:
            c.execute("delete from jobs where id = any(%s::uuid[])", (made,))
