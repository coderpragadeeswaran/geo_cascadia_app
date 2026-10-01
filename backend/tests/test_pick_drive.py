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


def test_slow_details_show_the_street_without_them_then_retry_is_instant(monkeypatch, tmp_path):
    import threading, time as T
    lat, lon = 11.1, 77.0
    gate = threading.Event()

    def ask(url, query, wait_s=0.0):
        if "around:" in query and not gate.is_set():                  # the roads at the ends: slow until released
            gate.wait(10)
        return _ways(lat, lon) if "around:" not in query else [_ways(lat, lon)[1]]
    monkeypatch.setattr(streetpick, "_ask_mirror", ask)
    monkeypatch.setattr(streetpick, "BUDGET_S", 0.6)
    t = T.monotonic()
    r = streetpick.pick(str(tmp_path), [], lat, lon)
    assert T.monotonic() - t < 2                                       # never hangs past the budget
    assert r["osm_details"] is False and "OSM lookup slow" in r["note"] and r["way_ids"] == [11]   # the road, details pending
    gate.set()
    while streetpick._INFLIGHT or streetpick._FINISHING:
        T.sleep(0.05)
    t = T.monotonic()
    r2 = streetpick.pick(str(tmp_path), [], lat, lon)                  # Retry: answered from the cache
    assert T.monotonic() - t < 0.3 and r2.get("osm_details") is None and r2["street"] == "Unnamed road near East Street"
    r3 = streetpick.pick(str(tmp_path), [], lat, lon - 0.0004)         # another click on the same road: by its way id
    assert r3["street"] == "Unnamed road near East Street" and r3["source"] == "cache"


def test_slow_road_query_says_so_quickly(monkeypatch, tmp_path):
    import threading, time as T
    gate = threading.Event()
    monkeypatch.setattr(streetpick, "_ask_mirror", lambda url, query, wait_s=0.0: gate.wait(10) and [])
    monkeypatch.setattr(streetpick, "BUDGET_S", 0.5)
    t = T.monotonic()
    with pytest.raises(streetpick.OverpassSlow):
        streetpick.pick(str(tmp_path), [], 11.2, 77.1)
    assert T.monotonic() - t < 1.5
    gate.set()


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
