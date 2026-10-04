"""D57 (ui-fixes): a street pick keeps only the connected piece that was clicked; the rest of the same name is offered
as `elsewhere` and joins the job only when asked (include_elsewhere). One-piece streets are returned unchanged."""
import json
import os

from shapely.geometry import LineString, shape

from app import streetpick
from app.settings import Settings
from app.store import JsonStore
from geo_cascadia.geo import Frame

S = Settings()
LAT, LON = 11.0300, 76.9700
F = Frame(LAT, LON)


def _res(lines_xy):
    """a pick result in lon/lat built from metre lines around (LAT, LON), as streetpick._result would return it"""
    coords = [[list(F.ll(x, y)[::-1]) for x, y in l] for l in lines_xy]
    return {"street": "Test Road", "name_source": "osm", "osm_name": "Test Road", "length_m": 0, "osm_ways": 2,
            "way_ids": [1, 2], "polygon": {}, "lines": {"type": "MultiLineString", "coordinates": coords}, "source": "cache"}


def test_components_join_within_five_metres_only():
    a = LineString([(0, 0), (100, 0)])
    b = LineString([(104, 0), (200, 0)])           # end 4 m from a's end: connected
    c = LineString([(150, 3), (150, 80)])          # end 3 m from the middle of b (a T): connected
    d = LineString([(300, 0), (400, 0)])           # 100 m gap: separate
    groups = streetpick._components([a, b, c, d])
    assert sorted(len(g) for g in groups) == [1, 3]
    assert len(streetpick._components([a, LineString([(110, 0), (200, 0)])])) == 2      # 10 m gap: separate


def test_one_piece_street_is_returned_unchanged():
    r = _res([[(0, 0), (120, 0)], [(120, 0), (200, 40)]])
    assert streetpick.split_pieces(r, LAT, LON) is r                                    # same object, no new key


def test_two_pieces_keep_the_clicked_one_and_offer_the_rest():
    r = _res([[(-50, 0), (150, 0)], [(400, 0), (400, -240)]])                          # 200 m clicked, 240 m away
    s = streetpick.split_pieces(r, LAT, LON)
    assert abs(s["length_m"] - 200) <= 1 and abs(s["elsewhere"]["length_m"] - 240) <= 1 and s["elsewhere"]["pieces"] == 1
    assert len(s["lines"]["coordinates"]) == 1 and shape(s["polygon"]).geom_type == "Polygon"
    assert s["way_ids"] == r["way_ids"] and s["street"] == "Test Road"                  # name and ways untouched
    # the job polygon (45 m buffer) covers the clicked piece only
    far = F.ll(400, -120)
    assert not shape(s["polygon"]).contains(shape({"type": "Point", "coordinates": [far[1], far[0]]}))
    # clicked on the other piece: that one is kept
    la, lo = F.ll(400, -100)
    t = streetpick.split_pieces(r, la, lo)
    assert abs(t["length_m"] - 240) <= 1 and abs(t["elsewhere"]["length_m"] - 200) <= 1
    # include it: both pieces, one job polygon with two parts
    w = streetpick.with_elsewhere(s)
    assert abs(w["length_m"] - 440) <= 1 and len(w["lines"]["coordinates"]) == 2 and w["included_elsewhere"]
    assert shape(w["polygon"]).geom_type == "MultiPolygon"
    assert streetpick.with_elsewhere(streetpick.split_pieces(_res([[(0, 0), (90, 0)]]), LAT, LON))["length_m"] == 0   # no elsewhere: unchanged


def test_trim_of_both_pieces_is_checked_against_both():
    s = streetpick.split_pieces(_res([[(-50, 0), (150, 0)], [(400, 0), (400, -240)]]), LAT, LON)
    w = streetpick.with_elsewhere(s)
    assert abs(streetpick.trim(w, w["lines"])["length_m"] - 440) <= 1
    try:
        streetpick.trim(s, w["lines"])                                                # both pieces vs the clicked one
        assert False, "the far piece must be refused when it is not included"
    except ValueError:
        pass


def test_rathinapuri_from_its_analysed_area():
    """the analysed area's own street lines (2 pieces, Sanganoor Road in between): a click on the western piece keeps it"""
    b = JsonStore(S.areas_dir).bundle("rathinapuri_sanganoor_main_road_9520da")
    r = streetpick.pick_local([b], 11.035838810963222, 76.96165158517604)
    assert r["length_m"] == 392 and len(r["lines"]["coordinates"]) == 2
    s = streetpick.split_pieces(r, 11.035838810963222, 76.96165158517604)
    assert (s["length_m"], s["elsewhere"]["length_m"]) == (327, 65)


def test_analysed_one_piece_streets_unchanged():
    """every analysed street stored in one piece resolves exactly as before"""
    js = JsonStore(S.areas_dir)
    n = 0
    for slug in ("sanganur_road_086d14", "vadakku_masi_veethi_f17937", "unnamed_road_off_4th_street_5772fa"):
        b = js.bundle(slug)
        for st in b["streets"]:
            g = shape(st["geometry"])
            if g.geom_type != "LineString" and len(g.geoms) > 1:
                continue
            p = (g if g.geom_type == "LineString" else g.geoms[0]).interpolate(0.5, normalized=True)
            r = streetpick.pick_local([b], p.y, p.x)
            assert streetpick.split_pieces(r, p.y, p.x) is r
            n += 1
    assert n == 3


def test_job_input_carries_the_choice(monkeypatch):
    """POST /jobs/plan-estimate and POST /jobs take include_elsewhere (the endpoints call with_elsewhere)"""
    from app import jobs
    assert "include_elsewhere" in jobs.JobIn.model_fields and "include_elsewhere" in jobs.PlanIn.model_fields
    assert jobs.JobIn().include_elsewhere is False
