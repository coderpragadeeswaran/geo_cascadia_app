"""P7 Round 2: F2 street names (Google's name for the road itself), camera-only buildings, boxes linked to a building,
one pole for several photos, the street-name picker, the sign rule on Trust."""
import json
import os

from shapely.geometry import LineString

from app import namepick, streetpick
from app.settings import Settings
from geo_cascadia.geo import Frame

S = Settings()
F = Frame(11.0, 77.0)
ROAD = LineString([(0, 0), (200, 0)])                       # the clicked unnamed road, metres


def _fake_routes(monkeypatch, answers):
    """answers: one (name, x, y) per sample point, in order; x, y in metres = where Google puts that route"""
    it = iter(answers)

    def fake(cache_dir, la, lo, key, deadline):
        name, x, y = next(it)
        if name is None:
            return None, True
        rla, rlo = F.ll(x, y)
        return {"name": name, "lat": rla, "lon": rlo}, True
    monkeypatch.setattr(streetpick, "_route_here", fake)


def test_google_name_of_the_road_itself(monkeypatch, tmp_path):
    _fake_routes(monkeypatch, [("3rd Street", 60, 5), ("3rd Street", 100, 3), ("4th Street", 150, 40)])
    assert streetpick.google_own_name(str(tmp_path), F, ROAD, ["4th Street"], "k") == ("3rd Street", True)


def test_google_name_rejected_when_it_is_a_cross_street_or_far_away(monkeypatch, tmp_path):
    _fake_routes(monkeypatch, [("Kattabomman Street", 60, 2), ("Kattabomman Street", 100, 2), ("Kattabomman Street", 150, 2)])
    assert streetpick.google_own_name(str(tmp_path), F, ROAD, ["Kattabomman Street"], "k")[0] is None   # names a cross street
    _fake_routes(monkeypatch, [("Far Road", 60, 80), ("Far Road", 100, 90), ("Far Road", 150, 70)])
    assert streetpick.google_own_name(str(tmp_path), F, ROAD, [], "k")[0] is None                         # its point is not on this road
    _fake_routes(monkeypatch, [("A Street", 60, 2), ("B Street", 100, 2), (None, 0, 0)])
    assert streetpick.google_own_name(str(tmp_path), F, ROAD, [], "k")[0] is None                         # no majority


def test_short_road_is_not_sampled(tmp_path):
    assert streetpick.google_own_name(str(tmp_path), F, LineString([(0, 0), (40, 0)]), [], "k") == (None, True)


def test_camera_only_buildings(offline):
    r = offline.get("/areas/ward29/camera-buildings").json()
    with open(os.path.join(S.areas_dir, "ward29", "building_positions.json"), encoding="utf-8") as f:
        n = len(json.load(f)["no_footprint"])
    assert r["available"] and r["count"] == n == len(r["points"]) and r["points"][0]["id"] == "cb-001"
    assert offline.get("/areas/not_an_area/camera-buildings").status_code == 404


def test_building_evidence_marks_linked_sign_boxes(offline):
    with open(os.path.join(S.areas_dir, "ward29", "sign_links.json"), encoding="utf-8") as f:
        links = json.load(f)
    fp = "w1247744676"
    r = offline.get(f"/areas/ward29/evidence/building/{fp}").json()
    assert r["links"]["sign_boxes"] == sum(1 for v in links.values() if (v or {}).get("fp") == fp)
    assert any(b.get("linked") for v in r["views"] for b in v["boxes"])
    assert all(not (b.get("linked") and b["target"]) for v in r["views"] for b in v["boxes"])


def test_asset_features_carry_photo_count(client):
    feats = client.get("/areas/ward29/geojson", params={"layers": "assets"}).json()["features"]
    assert feats and all(f["properties"].get("n_detections") for f in feats)


def test_name_picks_apply_without_touching_sources(tmp_path, monkeypatch):
    area = tmp_path / "areas" / "x_area"
    area.mkdir(parents=True)
    exp = {"meta": {"area": "Old Name"}, "buildings": [{"id": "w1", "street": "Old Name"}],
           "dashboard": {"streets": ["Old Name"], "charts": {"by_street": {"Old Name": {"buildings": 1}}}}}
    names = {"(unnamed residential #1)": "Old Name"}
    assert namepick.apply(str(area), exp, names) == (exp, names)                     # no pick: unchanged, same objects
    namepick.save_pick(str(tmp_path), "x_area", "(unnamed residential #1)", "New Name")
    e2, n2 = namepick.apply(str(area), exp, names)
    assert n2["(unnamed residential #1)"] == "New Name" and e2["buildings"][0]["street"] == "New Name"
    assert e2["dashboard"]["streets"] == ["New Name"] and list(e2["dashboard"]["charts"]["by_street"]) == ["New Name"]
    assert e2["meta"]["area"] == "New Name"
    assert exp["buildings"][0]["street"] == "Old Name" and names["(unnamed residential #1)"] == "Old Name"   # inputs untouched
    namepick.save_pick(str(tmp_path), "x_area", "(unnamed residential #1)", None)
    assert namepick.read_picks(str(tmp_path)) == {}


def test_street_names_endpoint_and_pick_validation(offline):
    r = offline.get("/areas/unnamed_road_off_4th_street_5772fa/street-names").json()
    if not r["available"]:
        return                                                                         # candidates not generated here
    row = r["streets"][0]
    assert {s["source"] for s in row["sources"]} == {"osm", "google", "f2", "register", "places"}
    bad = offline.put("/areas/unnamed_road_off_4th_street_5772fa/street-names", json={"raw": row["raw"], "name": "Invented Road"})
    assert bad.status_code == 422


def test_sign_rule_on_trust(offline):
    r = offline.get("/trust/sign-links").json()
    g = r["model_card"]["ward29"]["google_check"]
    assert g["closer"] + g["further"] + g["same_within_1m"] + g["to_or_from_no_outline"] == g["moved_read_signs_with_google_pin"]
    assert len(r["spotcheck"]["samples"]) == 20
    ai = r["ai_check"]
    assert "not a human check" in ai["who"] and sum(ai["counts"].values()) == len(ai["rows"]) == 20
