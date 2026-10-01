"""Design pass B §3 (street picker) and §4 (drive the street). No network: Overpass is replaced where it would be called."""
import pytest

from app import drive, streetpick
from app.settings import Settings
from app.store import JsonStore

S = Settings()
JS = JsonStore(S.areas_dir)
BUNDLES = [JS.bundle(x) for x in JS.slugs()]


def mid_point(slug, street):
    s = next(x for x in JS.bundle(slug)["streets"] if x["name"] == street)
    c = s["geometry"]["coordinates"][0]
    lon, lat = c[len(c) // 2]
    return lat, lon


@pytest.fixture
def no_overpass(monkeypatch):
    calls = []

    def fake(query, cache_dir, deadline):
        calls.append(query)
        raise streetpick.OverpassBusy("OpenStreetMap is busy or unreachable (test) — try again in a moment")
    monkeypatch.setattr(streetpick, "overpass", fake)
    return calls


@pytest.mark.parametrize("slug,street", [("ward29", "Sri Ganapathy Gardens 3rd Street (approx.)"), ("ward29", "Korathottam Road"),
                                         ("ward29", "Sathy Main Road"), ("trichy_bharathidasan_salai", "Bharathidasan Salai")])
def test_analysed_streets_answer_locally_with_display_names(slug, street, no_overpass, tmp_path):
    lat, lon = mid_point(slug, street)
    r = streetpick.pick(str(tmp_path), BUNDLES, lat, lon)
    assert no_overpass == []                                     # no Overpass call for an analysed street
    assert r["street"] == street and r["name_source"] == "street_names" and r["source"] == "area"
    assert not r["street"].startswith("(unnamed")
    assert r["already"][0]["slug"] == slug and r["already"][0]["by"] == "way_ids"
    assert r["lines"]["type"] == "MultiLineString" and r["length_m"] > 0


def test_busy_overpass_offers_the_nearest_analysed_street_or_says_busy(no_overpass, tmp_path):
    lat, lon = mid_point("ward29", "Korathottam Road")
    r = streetpick.pick(str(tmp_path), BUNDLES, lat + 0.0003, lon)      # ~33 m off the line: not a local snap
    assert no_overpass and r["street"] == "Korathottam Road" and "busy" in r["note"]
    with pytest.raises(streetpick.OverpassBusy):
        streetpick.pick(str(tmp_path), BUNDLES, 11.1, 77.0)               # far from every analysed street


def test_preview_endpoint_uses_the_picker(client, no_overpass):
    lat, lon = mid_point("ward29", "Sri Ganapathy Gardens 3rd Street (approx.)")
    r = client.post("/jobs/preview", json={"lat": lat, "lon": lon})
    assert r.status_code == 200
    p = r.json()
    assert p["street"] == "Sri Ganapathy Gardens 3rd Street (approx.)" and p["already"][0]["slug"] == "ward29"
    # P7.2: the estimate is the real camera plan, planned in the background (tests run without the server key: it says so)
    assert p["plan_estimate"]["status"] == "failed" and "server key" in p["plan_estimate"]["error"]
    assert p["cost_cap_usd"] == 2.0
    far = client.post("/jobs/preview", json={"lat": 11.1, "lon": 77.0})
    assert far.status_code == 503 and "busy" in far.json()["detail"]


# ------------------------------------------------------------------ P7.1: OpenStreetMap lookup budget and caches
def _ways(lat, lon):
    """a fake tile: one unnamed road through the click and a named road crossing its east end"""
    d = 0.0009
    return [{"type": "way", "id": 11, "tags": {"highway": "residential"},
             "geometry": [{"lat": lat, "lon": lon - d}, {"lat": lat, "lon": lon + d}]},
            {"type": "way", "id": 12, "tags": {"highway": "residential", "name": "East Street"},
             "geometry": [{"lat": lat - d, "lon": lon + d}, {"lat": lat + d, "lon": lon + d}]}]


def _wait_background():
    import time as T
    while streetpick._INFLIGHT or streetpick._FINISHING:
        T.sleep(0.05)


def test_slow_lookup_is_pending_then_the_cache_answers(monkeypatch, tmp_path):
    """hotfix: a slow map server means "pending" (the endpoint answers 202), never a failure; the lookup finishes in the
    background, the next ask is answered from the cache, and a click elsewhere on the same road by its way id"""
    import threading, time as T
    lat, lon = 11.1, 77.0
    gate = threading.Event()

    def ask(url, query, wait_s=0.0):
        gate.wait(10)
        return _ways(lat, lon)
    monkeypatch.setattr(streetpick, "_ask_mirror", ask)
    monkeypatch.setattr(streetpick, "BUDGET_S", 0.5)
    t = T.monotonic()
    with pytest.raises(streetpick.Pending) as e:
        streetpick.pick(str(tmp_path), [], lat, lon)
    assert T.monotonic() - t < 1.5 and e.value.partial is None           # never hangs past the budget
    gate.set()
    _wait_background()
    t = T.monotonic()
    r = streetpick.pick(str(tmp_path), [], lat, lon)                     # the next ask: from the cache
    assert T.monotonic() - t < 0.3 and r["street"] == "Unnamed road near East Street" and r.get("osm_details") is None
    r2 = streetpick.pick(str(tmp_path), [], lat, lon - 0.0004)           # another click on the same road: by its way id
    assert r2["street"] == "Unnamed road near East Street" and r2["source"] == "cache"


def test_named_street_shown_while_its_full_length_loads(monkeypatch, tmp_path):
    """the road is known but the rest of a named street is still loading: Pending carries it (shown as "partial")"""
    import threading
    lat, lon = 11.3, 77.2
    gate = threading.Event()
    d = 0.0009
    tile = [{"type": "way", "id": 21, "tags": {"highway": "residential", "name": "Long Road"},
             "geometry": [{"lat": lat, "lon": lon - d}, {"lat": lat, "lon": lon + d}]}]

    def ask(url, query, wait_s=0.0):
        if '"name"=' in query:                                           # the named street's full length: slow
            gate.wait(10)
        return tile
    monkeypatch.setattr(streetpick, "_ask_mirror", ask)
    monkeypatch.setattr(streetpick, "BUDGET_S", 0.5)
    with pytest.raises(streetpick.Pending) as e:
        streetpick.pick(str(tmp_path), [], lat, lon)
    assert e.value.partial and e.value.partial["street"] == "Long Road" and e.value.partial["osm_details"] is False
    gate.set()
    _wait_background()
    assert streetpick.pick(str(tmp_path), [], lat, lon).get("osm_details") is None


def test_preview_answers_pending_never_503_while_slow(monkeypatch, offline):
    import threading
    gate = threading.Event()
    def ask(url, query, wait_s=0.0):                                     # slow, then failing: nothing is ever cached
        gate.wait(10)
        raise streetpick.OverpassBusy("test")
    monkeypatch.setattr(streetpick, "_ask_mirror", ask)
    monkeypatch.setattr(streetpick, "BUDGET_S", 0.3)
    r = offline.post("/jobs/preview", json={"lat": 11.45, "lon": 77.45})
    assert r.status_code == 202 and r.json()["status"] == "pending"
    gate.set()
    _wait_background()


def test_dead_mirror_is_rested_busy_one_is_not(monkeypatch):
    import requests
    streetpick._HEALTH.clear()
    dead, busy = streetpick.MIRRORS[1], streetpick.MIRRORS[0]

    class R:
        status_code, text = 504, "<html>"

    def post(url, **kw):
        if url == dead:
            raise requests.ConnectTimeout("down")
        return R()
    monkeypatch.setattr(streetpick.requests, "post", post)
    for u in (dead, busy):
        with pytest.raises(Exception):
            streetpick._ask_mirror(u, "q")
    alive = streetpick.alive_mirrors()
    assert dead not in alive and busy in alive
    streetpick._HEALTH.clear()


@pytest.mark.parametrize("street,branches", [("Sathy Main Road", [803, 111]), ("Sri Ganapathy Gardens 3rd Street (approx.)", [485])])
def test_drive_stops_are_monotonic_per_branch(client, street, branches):
    r = client.get("/areas/ward29/drive", params={"street": street})
    assert r.status_code == 200
    d = r.json()
    assert [b["length_m"] for b in d["branches"]] == branches              # side pieces are separate branches
    for b in d["branches"]:
        s = [x["s"] for x in b["stops"]]
        assert s == sorted(s) and len(set(s)) == len(s)                   # strictly forward
        assert all(y - x >= drive.MIN_STEP_M for x, y in zip(s, s[1:]))
        assert all(0 <= x["heading"] < 360 for x in b["stops"])


def test_drive_forward_follows_the_road_tangent(client):
    """Hairpin: the forward heading turns with the road (160° → ~85° → ~167° → ~256°), never flips back."""
    d = client.get("/areas/ward29/drive", params={"street": "Sri Ganapathy Gardens 3rd Street (approx.)"}).json()
    h = [x["heading"] for x in d["branches"][0]["stops"]]
    assert h[0] == pytest.approx(160, abs=10) and h[-1] == pytest.approx(256, abs=10)
    turns = [((b - a + 180) % 360) - 180 for a, b in zip(h, h[1:])]
    assert all(abs(t) < 100 for t in turns)                                # no 180° flip between neighbouring stops
    sathy = client.get("/areas/ward29/drive", params={"street": "Sathy Main Road"}).json()["branches"][0]
    assert [g["id"] for g in sathy["gaps"]] == ["gap60-001", "gap60-002"]
    assert len(sathy["lamps"]) == 13


def test_drive_errors(client):
    assert client.get("/areas/ward29/drive", params={"street": "Nowhere Street"}).status_code == 404
