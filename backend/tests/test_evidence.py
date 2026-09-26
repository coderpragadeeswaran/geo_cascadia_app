"""Design pass B §2: detection boxes on evidence photos (/areas/{slug}/evidence/{kind}/{id}).
Building / business photos are planned views: the object's box is its own stored detection. Asset photos are re-aimed
views: boxes are projected from the same panorama's planned views and the pole / lamp in the aimed direction is marked."""
import math

from app import evidence
from conftest import raw_export


def test_projection_identity_and_rotation():
    """A box projected into its own view is unchanged; into a view turned by +30° it moves left, same pinhole model."""
    det = {"heading": 120.0, "pitch": 0, "fov": 90, "x1": 300, "y1": 100, "x2": 340, "y2": 500, "u": 320, "cls": "pole", "conf": 0.8}
    same = evidence.project_box(det, {"heading": 120.0, "pitch": 0, "fov": 90})
    assert same and all(abs(a - b) < 0.2 for a, b in zip(same[0], (300, 100, 340, 500)))
    turned = evidence.project_box(det, {"heading": 150.0, "pitch": 0, "fov": 60})
    # 30° to the left of the new centre at fov 60: x = 320 - 320 * tan(30°) / tan(30°) = 0 → at the left edge
    assert turned is None or turned[1] < 5
    left15 = evidence.project_box(det, {"heading": 135.0, "pitch": 0, "fov": 60})
    assert left15 and abs(left15[1] - (320 - 320 * math.tan(math.radians(15)) / math.tan(math.radians(30)))) < 1


def test_building_and_business_photos_mark_the_stored_box(client):
    exp = raw_export("ward29")
    for b in [x for x in exp["buildings"] if (x.get("evidence") or {}).get("attribute_view")][:40]:
        r = client.get(f"/areas/ward29/evidence/building/{b['id']}")
        assert r.status_code == 200
        v = next(x for x in r.json()["views"] if x["key"] == "attr")
        av = b["evidence"]["attribute_view"]
        t = [x for x in v["boxes"] if x["target"]]
        assert v["source"] == "exact" and v["target"] == "box" and len(t) == 1
        assert abs(t[0]["x1"] - av["x1"]) < 1 and abs(t[0]["y2"] - av["y2"]) < 1
        assert {x["cls"] for x in v["boxes"]} <= {"building", "pole", "lamp_head", "signboard"}
        assert all(0 <= x["conf"] <= 1 for x in v["boxes"])
    u = exp["unmapped_businesses"][0]
    v = client.get(f"/areas/ward29/evidence/unmapped/{u['id']}").json()["views"][0]
    assert v["target"] == "box" and [x for x in v["boxes"] if x["target"]][0]["cls"] == "signboard"


def test_asset_photos_find_the_pole_or_lamp_box(client):
    exp = raw_export("ward29")
    matched = total = 0
    for a in exp["assets"][:80]:
        for v in client.get(f"/areas/ward29/evidence/asset/{a['id']}").json()["views"]:
            total += 1
            assert v["source"] in ("projected", "none") and v["fov"] == 60
            t = [x for x in v["boxes"] if x["target"]]
            if v["target"] == "box":
                matched += 1
                assert len(t) == 1 and t[0]["cls"] in (("pole", "lamp_head") if a["type"] == "streetlight" else ("pole",))
                assert v["aim_offset_deg"] <= 12
            else:
                assert v["target"] == "crosshair" and not t and "crosshair" in v["note"]
    assert matched / total > 0.85, (matched, total)


def test_evidence_errors(client):
    assert client.get("/areas/ward29/evidence/tree/x").status_code == 422
    assert client.get("/areas/ward29/evidence/building/nope").status_code == 404
