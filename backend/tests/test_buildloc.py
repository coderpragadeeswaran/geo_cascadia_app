"""P4.5 building positions (D25/D26), on a synthetic street: a 10 m wide facade on the line y = 10 (x from -5 to 5),
cameras on the road (y = 0). Boxes are generated with the same camera model the pipeline uses (pixel_to_bearing), so the
expected answers are exact. No network: the footprint is set directly on an Area."""
import math

import pytest
from shapely.geometry import Polygon, box
from shapely.strtree import STRtree

from geo_cascadia.area import Area
from geo_cascadia.buildloc import locate_buildings
from geo_cascadia.config import Config

W, FOV = 640, 90
LAT0, LON0 = 11.03, 76.97


def _area():
    a = Area(box(LON0 - 0.001, LAT0 - 0.001, LON0 + 0.001, LAT0 + 0.001), cache_dir="unused", max_range=40.0)
    fp = Polygon([(-5, 10), (5, 10), (5, 20), (-5, 20)])            # local metres; front wall on y = 10
    a.footprints, a.fp_ids, a.fp_source = [fp], ["w1"], ["osm"]
    a.idx_of, a.tree = {"w1": 0}, STRtree([fp])
    return a


def _col(cx, cy, heading, x, y):
    """pixel column of world point (x, y) seen from (cx, cy) at `heading` (inverse of pixel_to_bearing)."""
    b = math.degrees(math.atan2(x - cx, y - cy))
    off = (b - heading + 180) % 360 - 180
    return W / 2 * (1 + math.tan(math.radians(off)) / math.tan(math.radians(FOV / 2)))


def _det(a, cx, clip_left=False):
    heading = math.degrees(math.atan2(0 - cx, 10))                # look at the facade centre
    x1, x2 = sorted((_col(cx, 0, heading, -5, 10), _col(cx, 0, heading, 5, 10)))
    if clip_left:
        x1 = 0.0
    lat, lon = a.frame.ll(cx, 0)
    return {"pano_id": f"p{cx}", "camera_lat": lat, "camera_lon": lon, "heading": heading % 360, "pitch": 0, "fov": FOV,
            "W": W, "H": W, "cls": "building", "conf": 0.9, "x1": x1, "x2": x2, "y1": 100.0, "y2": 600.0,
            "u": (x1 + x2) / 2, "geom_ok": True}


def _point(a, p):
    return a.L(p["lat"], p["lon"])


def test_corner_midpoint_lands_on_the_facade():
    a = _area()
    dets = [_det(a, cx) for cx in (-14, 0, 14)]
    p = locate_buildings(dets, a, Config())["w1"]
    x, y = _point(a, p)
    assert p["method"] == "triangulated" and not p["uses_footprint"] and p["fallback"] is None
    assert abs(x) < 0.2 and abs(y - 10) < 0.2                      # facade centre (0, 10)
    assert abs(p["facade_width_m"] - 10) < 0.3
    assert p["uncertainty_m"] is not None                          # 3 cameras: estimated


def test_box_centre_method_lands_behind_the_facade():
    """the part-1 method (kept as aim='centre') — why it was replaced"""
    a = _area()
    dets = [_det(a, cx) for cx in (-14, 0, 14)]
    x, y = _point(a, locate_buildings(dets, a, Config(), aim="centre")["w1"])
    assert y > 10.5                                                # centre rays cross behind the wall


def test_two_cameras_uncertainty_is_not_estimated():
    a = _area()
    p = locate_buildings([_det(a, -14), _det(a, 14)], a, Config())["w1"]
    assert p["method"] == "triangulated" and p["uncertainty_m"] is None


def test_corner_clipped_in_all_views_falls_back_and_is_marked():
    a = _area()
    dets = [_det(a, cx, clip_left=True) for cx in (-14, 0, 14)]
    p = locate_buildings(dets, a, Config())["w1"]
    assert p["method"] == "triangulated_centre" and p["fallback"] == "corner_clipped_all_views" and p["approximate"]


def test_single_camera_uses_footprint_and_is_marked():
    a = _area()
    p = locate_buildings([_det(a, 0)], a, Config())["w1"]
    assert p["method"] == "single_ray" and p["uses_footprint"] and p["approximate"]
    assert _point(a, p)[1] == pytest.approx(10, abs=0.05)          # on the wall the ray hits


# ------------------------------------------------------------------ the production rule (D27)
from shapely.geometry import LineString  # noqa: E402

from geo_cascadia.buildloc import predict_positions  # noqa: E402


def _register(a):
    ring = [a.frame.ll(x, y) for x, y in [(-5, 10), (5, 10), (5, 20), (-5, 20), (-5, 10)]]
    lat, lon = a.frame.ll(0, 15)
    return [{"building_id": "w1", "lat": lat, "lon": lon, "street": "S", "footprint_latlon": [list(p) for p in ring]}]


STREETS = {"S": LineString([(-60, 0), (60, 0)])}


def test_rule_triangulated_with_three_cameras_and_self_consistency():
    a = _area()
    p = predict_positions([_det(a, cx) for cx in (-14, 0, 14)], a, _register(a), STREETS, Config())["w1"]
    x, y = a.L(p["lat"], p["lon"])
    assert p["method"] == "triangulated" and p["n_cameras"] == 3
    assert abs(x) < 0.2 and abs(y - 10) < 0.2
    assert p["pair_estimates"] >= 2 and p["uncertainty_m"] is not None and p["uncertainty_m"] < 0.2   # exact synthetic rays


def test_rule_two_cameras_triangulate_without_an_uncertainty():
    """D28 (variant B): 2 cameras are enough; the single pair estimate is the point, so uncertainty is not estimated"""
    a = _area()
    p = predict_positions([_det(a, -14), _det(a, 14)], a, _register(a), STREETS, Config())["w1"]
    assert p["method"] == "triangulated" and p["n_cameras"] == 2 and p["uncertainty_m"] is None
    assert a.L(p["lat"], p["lon"])[1] == pytest.approx(10, abs=0.2)


def test_rule_one_camera_is_a_wall_hit_on_the_road_facing_wall():
    a = _area()
    p = predict_positions([_det(a, 0)], a, _register(a), STREETS, Config())["w1"]
    assert p["method"] == "wall_hit" and p["uncertainty_m"] is None and p["n_cameras"] == 1
    assert a.L(p["lat"], p["lon"])[1] == pytest.approx(10, abs=0.05)


def test_rule_corners_clipped_in_all_views_is_a_wall_hit():
    a = _area()
    p = predict_positions([_det(a, cx, clip_left=True) for cx in (-14, 0, 14)], a, _register(a), STREETS, Config())["w1"]
    assert p["method"] == "wall_hit"


def test_rule_no_ray_is_the_front_wall_centre():
    """D33: no camera line of sight -> the midpoint of the road-facing wall (the facade y = 10, x from -5 to 5)"""
    a = _area()
    p = predict_positions([], a, _register(a), STREETS, Config())["w1"]
    assert p["method"] == "wall_centre" and p["uncertainty_m"] is None and p["n_cameras"] == 0
    x, y = _point(a, p)
    assert abs(x - 0) < 0.05 and abs(y - 10) < 0.05


def test_rule_no_road_facing_wall_is_the_footprint_centre():
    """no street line at all -> no road-facing wall can be determined -> the centroid"""
    a = _area()
    reg = _register(a)
    p = predict_positions([], a, reg, {}, Config())["w1"]
    assert p["method"] == "footprint_centre" and (p["lat"], p["lon"]) == (reg[0]["lat"], reg[0]["lon"])


def test_ray_that_first_hits_a_side_wall_is_not_a_wall_hit():
    """the street runs along the building's side (x = -20): the road-facing wall is x = -5, which the cameras on y = 0
    only see after the front wall -> no wall hit -> the centre of that road-facing wall (D33)"""
    a = _area()
    p = predict_positions([_det(a, 0)], a, _register(a), {"S": LineString([(-20, -60), (-20, 60)])}, Config())["w1"]
    assert p["method"] == "wall_centre"
    x, _ = _point(a, p)
    assert abs(x - (-5)) < 0.05


def test_rule_rejects_an_implausible_triangulation_and_says_why():
    """three cameras whose wall corners triangulate at y = 32, 22 m from the road-facing wall (y = 10) of a footprint
    that ends at y = 20: > 10 m -> rejected, the building falls back to wall_hit and the reason is stored"""
    a = _area()
    fp = Polygon([(-40, 10), (40, 10), (40, 20), (-40, 20)])
    a.footprints, a.tree = [fp], STRtree([fp])
    dets = []
    for cx in (-30, 0, 30):                                       # pairs >= 30 deg apart for both corners
        heading = math.degrees(math.atan2(0 - cx, 32))
        x1, x2 = sorted((_col(cx, 0, heading, -5, 32), _col(cx, 0, heading, 5, 32)))
        lat, lon = a.frame.ll(cx, 0)
        dets.append({"pano_id": f"p{cx}", "camera_lat": lat, "camera_lon": lon, "heading": heading % 360, "pitch": 0,
                     "fov": FOV, "W": W, "H": W, "cls": "building", "conf": 0.9, "x1": x1, "x2": x2, "y1": 100.0,
                     "y2": 600.0, "u": (x1 + x2) / 2, "geom_ok": True})
    ring = [a.frame.ll(x, y) for x, y in [(-40, 10), (40, 10), (40, 20), (-40, 20), (-40, 10)]]
    lat, lon = a.frame.ll(0, 15)
    reg = [{"building_id": "w1", "lat": lat, "lon": lon, "street": "S", "footprint_latlon": [list(p) for p in ring]}]
    p = predict_positions(dets, a, reg, STREETS, Config())["w1"]
    assert p["method"] == "wall_hit"
    assert p["reason"] == "triangulation rejected: implausible (22.0 m from road-facing wall)"   # wall y = 10, point y = 32
    ok = predict_positions([_det(a, cx) for cx in (-14, 0, 14)], _area(), _register(_area()), STREETS, Config())["w1"]
    assert ok["method"] == "triangulated" and ok["reason"] is None
