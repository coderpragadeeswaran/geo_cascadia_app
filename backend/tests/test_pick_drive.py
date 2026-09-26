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
    w = JS.bundle("ward29")["streets"]
    per_street = sum(s["length_m"] for s in w) / len(w)                  # model_card's "per street" = an average Ward 29 street
    assert p["estimate"]["cpu_minutes_full_ocr"] == round(18 * p["length_m"] / per_street)
    far = client.post("/jobs/preview", json={"lat": 11.1, "lon": 77.0})
    assert far.status_code == 503 and "busy" in far.json()["detail"]


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
