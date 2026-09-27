"""D36: unnamed-road names from real map names only, no version tags in place names, camera positions for mini-maps."""
import pytest
from shapely.geometry import LineString

from app import streetpick
from app.store import display_area_name

U = LineString([(0, 0), (100, 0)])                       # the unnamed road, metres
A = LineString([(-5, -50), (-5, 50)])                    # meets its west end
B = LineString([(104, -50), (104, 50)])                  # meets its east end
MID = LineString([(50, -40), (50, 40)])                  # crosses it in the middle
FAR = LineString([(50, 200), (60, 200)])


@pytest.mark.parametrize("named, expected", [
    ([("Union Mill Road", A), ("KPN Colony Main Road", B)], "Unnamed road between Union Mill Road and KPN Colony Main Road"),
    ([("Union Mill Road", A), ("Far Road", FAR)], "Unnamed road off Union Mill Road"),
    ([("Cross Street", MID), ("Far Road", FAR)], "Unnamed road off Cross Street"),
    ([("Far Road", FAR)], "Unnamed road near Far Road"),
    ([("Same Road", A), ("Same Road", B)], "Unnamed road off Same Road"),
    ([], "Unnamed road"),
    ([("(unnamed residential #1)", A)], "Unnamed road"),                 # a raw map label is never a name
])
def test_unnamed_road_names(named, expected):
    assert streetpick.unnamed_label(U, named, None) == expected


def test_map_names_win_ties_and_names_are_tidied():
    # both meet the east end at 0 m: the map's own name (listed first) wins over a Google name
    assert streetpick.unnamed_label(U, [("West Road", A), ("Union Mill Road", B), ("KPN Colony Main Road", B)], None) \
        == "Unnamed road between West Road and Union Mill Road"
    assert streetpick.tidy("Union mill road") == "Union Mill Road"
    assert streetpick.tidy("Sathy Main Road") == "Sathy Main Road"
    assert streetpick.tidy("சத்தி சாலை") == "சத்தி சாலை"
    assert streetpick.plain_name("Unnamed residential road near Union mill road") == "Unnamed road near Union mill road"


def test_version_tags_are_not_part_of_names(client):
    assert display_area_name("Ward 29, Coimbatore (v2)") == "Ward 29, Coimbatore"
    assert display_area_name("Sathy Road (test)") == "Sathy Road (test)"
    names = [a["name"] for a in client.get("/areas").json()["areas"]]
    assert "Ward 29, Coimbatore" in names and not any("(v2)" in n for n in names)
    assert client.get("/areas/ward29").json()["name"] == "Ward 29, Coimbatore"


def test_evidence_views_carry_the_camera(client):
    b = next(x for x in client.get("/areas/ward29/buildings?page_size=50").json()["rows"] if (x.get("evidence") or {}).get("attribute_view"))
    views = client.get(f"/areas/ward29/evidence/building/{b['id']}").json()["views"]
    assert views and all(v["camera"] and abs(v["camera"]["lat"] - b["lat"]) < 0.002 for v in views)
    a = client.get("/areas/ward29/assets?page_size=5").json()["rows"][0]
    av = client.get(f"/areas/ward29/evidence/asset/{a['id']}").json()["views"]
    assert av and all(v["camera"] for v in av)
