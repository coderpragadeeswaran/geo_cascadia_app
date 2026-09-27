"""D13: street lines join the records by the pipeline's display name (all areas), no-stats streets are "no data" (never a
healthy 0), and streetlight gaps follow the road only where the road stretch is really dark. DB and JSON modes."""
import pytest

from conftest import AREAS, raw_export


def _streets(client, slug):
    feats = client.get(f"/areas/{slug}/geojson?layers=streets,gaps").json()["features"]
    return ([f["properties"] for f in feats if f["properties"]["kind"] == "street"],
            {f["properties"]["id"]: f for f in feats if f["properties"]["kind"] == "streetlight_gap"})


@pytest.mark.parametrize("slug", AREAS)
def test_every_street_joins_its_records(client, slug):
    streets, _ = _streets(client, slug)
    by_street = client.get(f"/areas/{slug}").json()["dashboard"]["charts"]["by_street"]
    names = {s["name"] for s in streets}
    assert streets and all(s["has_stats"] for s in streets), [s["osm_name"] for s in streets if not s["has_stats"]]
    assert set(by_street) <= names                                  # every street with buildings has a line
    record_streets = {b["street"] for b in raw_export(slug)["buildings"]}
    assert record_streets <= names
    for s in streets:                                               # issues/km = (discrepancy + no record) per km
        st = by_street[s["name"]]
        assert s["issues_per_km"] == round((st["discrepancy"] + st["no_record"]) / (s["length_m"] / 1000), 2)


def test_ward29_unnamed_osm_ways_get_display_names(client):
    streets, _ = _streets(client, "ward29")
    k = next(s for s in streets if s["name"] == "Korathottam Road")
    B = [b for b in raw_export("ward29")["buildings"] if b["street"] == "Korathottam Road"]
    issues = sum(b["match_status"] in ("discrepancy", "no_record") for b in B)
    assert k["osm_name"] == "(unnamed residential #907980850)" and k["issues_per_km"] == round(issues / (k["length_m"] / 1000), 2)


def test_ward29_gap_display_rules(client):
    _, gaps = _streets(client, "ward29")
    rec = {g["id"]: g for g in raw_export("ward29")["streetlight_gaps"]}
    assert set(gaps) == set(rec)
    for gid, f in gaps.items():                                     # recorded length is never replaced
        assert f["properties"]["length_m"] == rec[gid]["length_m"]
    g1 = gaps["gap60-001"]["properties"]                            # Sathy Main Road: follows the road, length note
    assert g1["display_mode"] == "along_road" and g1["along_road_m"] == 424 and g1["length_differs"]
    assert len(gaps["gap60-001"]["geometry"]["coordinates"]) > 2 and "424 m along the road" in g1["note"]
    g6 = gaps["gap60-006"]["properties"]                            # hairpin street: drawn as recorded, flagged
    assert g6["display_mode"] == "check" and g6["lit_cameras_inside"] == 4 and g6["longest_dark_along_road_m"] == 302
    drawn = gaps["gap60-006"]["geometry"]["coordinates"]                # recorded ends (7 dp ≈ 1 cm)
    assert drawn == [pytest.approx(rec["gap60-006"]["start"][::-1], abs=1e-6), pytest.approx(rec["gap60-006"]["end"][::-1], abs=1e-6)]
    assert sum(f["properties"]["display_mode"] == "along_road" for f in gaps.values()) == 10
    rows = client.get("/areas/ward29").json()["consistency"]
    flagged = {r["field"].split(".")[1].split(" ")[0] for r in rows if r["field"].startswith("streetlight_gaps.")}
    assert flagged == {"gap60-001", "gap60-003", "gap60-005", "gap60-006"}


def test_coverage_banner_facts(client):
    t = client.get("/areas/tiruppur_uthukuli_road").json()["coverage"]
    assert t["level"] == "partial" and t["views_facing_no_mapped_building"] == 69 and t["views_planned"] == 77
    assert t["buildings"] == 1 and t["unmapped_businesses"] == 14
    assert client.get("/areas/trichy_bharathidasan_salai").json()["coverage"]["level"] == "partial"
    assert client.get("/areas/ward29").json()["coverage"]["level"] == "full"
