"""P7a (D42–D45): register that copies the observations, matching by location, signs by their own line of sight,
single-camera pole uncertainty by distance; register import; reloads that never lose a review decision silently."""
import csv
import json
import math
import os
import shutil
import sys

import pytest
from shapely.geometry import Polygon
from shapely.strtree import STRtree

from app.settings import ROOT
from conftest import raw_export

sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from geo_cascadia.area import Area  # noqa: E402
from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.geo import Frame, pixel_to_bearing  # noqa: E402
from geo_cascadia.poleunc import uncertainty_for  # noqa: E402
from geo_cascadia.register import (hide_truth, match_by_location, observed_register, pairing_accuracy,  # noqa: E402
                                   recovery_scores, use_category)
from geo_cascadia.signlink import box_bearing, link_signs, relink_ocr  # noqa: E402

CFG = Config()
ALL = sorted(d for d in os.listdir(os.path.join(ROOT, "data", "areas"))
             if os.path.isfile(os.path.join(ROOT, "data", "areas", d, "export.json"))
             and not os.path.isfile(os.path.join(ROOT, "data", "areas", d, "hidden.json")))   # D65: a hidden backup is kept as it was
LAT0, LON0 = 11.03, 76.97
F = Frame(LAT0, LON0)


def area_file(slug, name):
    with open(os.path.join(ROOT, "data", "areas", slug, f"{name}.json"), encoding="utf-8") as f:
        return json.load(f)


def street(n=12, step=20.0):
    """n buildings in a row along the x axis, `step` m apart, with their final attributes"""
    blds, final = [], []
    for i in range(n):
        x = i * step
        ring = [(x - 6, 4), (x + 6, 4), (x + 6, 16), (x - 6, 16), (x - 6, 4)]
        la, lo = F.ll(x, 10)
        blds.append({"building_id": f"w{i}", "lat": la, "lon": lo, "street": "Test Road", "area_m2": 144.0 + i,
                     "frontage_m": 12.0, "n_views": 2, "footprint_latlon": [list(F.ll(*p)) for p in ring]})
        final.append({"building_id": f"w{i}", "use": ["commercial", "residential", None][i % 3],
                      "floors": [2, 3, None][i % 3], "floors_status": ["measured", "measured", "not_measured"][i % 3]})
    return blds, final


# ------------------------------------------------------------------------------------------------ D42
def test_register_copies_observations_and_unknown_is_not_compared():
    blds, final = street(60)
    reg, planted = observed_register(blds, final, {}, CFG, "test area")
    assert (reg, planted) == observed_register(blds, final, {}, CFG, "test area")          # deterministic per area
    assert observed_register(blds, final, {}, CFG, "another area")[1] != planted
    plant = {p["building_id"]: p["kind"] for p in planted}
    fin = {f["building_id"]: f for f in final}
    for r in reg:
        if r["building_id"] in plant:
            continue
        f = fin[r["building_id"]]
        assert r["use_type"] == f["use"] and r["floors"] == f["floors"]                     # copied, None stays None
    res, unmatched, pairs = match_by_location(blds, final, hide_truth(reg), {}, CFG)
    by = {m["building_id"]: m for m in res}
    for bid, m in by.items():
        if bid not in plant:
            assert m["match_status"] == "matched" and not m["discrepancies"], (bid, m["discrepancies"])
        if fin[bid]["use"] is None:
            assert "use_change" not in m["discrepancies"]                                   # never a fake difference
    rec = recovery_scores(res, planted)
    acc = pairing_accuracy(pairs, reg, planted)
    # a false alarm can only come from a record paired with the wrong building (a moved pin taken by a neighbour)
    assert sum(v["false_alarms"] for v in rec.values()) <= 2 * acc["all"]["paired_wrong"] + acc["all"]["unpaired"]
    assert acc["pin_not_moved"]["right_pct"] == 100.0
    assert all(v["caught"] == v["planted"] for k, v in rec.items() if k in ("area_understated", "use_change", "extra_floor"))
    assert {p["kind"] for p in planted} <= set(rec)


def test_use_category_levels():
    assert use_category("shop") == use_category("mixed") == use_category("Commercial") == "commercial"
    assert use_category("house") == use_category("vacant plot") == "residential"
    assert use_category("institutional") is None and use_category(None) is None


@pytest.mark.parametrize("slug", ALL)
def test_real_areas_differences_come_only_from_plants_or_mispairs(slug):
    """D42 on the saved data: a building whose own record was paired to it and has no planted mistake shows NO difference
    (before D42, 46 of Ward 29's 50 use flags were the photo disagreeing with random register values)."""
    exp, reg = raw_export(slug), area_file(slug, "register_synthetic")
    planted = {p["building_id"] for p in area_file(slug, "planted_register_mistakes")}
    truth = {r["property_id"]: r["building_id"] for r in reg}
    for b in exp["buildings"]:
        pid = (b.get("register") or {}).get("property_id")
        if pid and truth.get(pid) == b["id"] and b["id"] not in planted:
            assert b["match_status"] == "matched" and not b["discrepancies"], (slug, b["id"], b["discrepancies"])


# ------------------------------------------------------------------------------------------------ D43
def test_matching_by_location_never_uses_the_building_id():
    blds, final = street(9)
    reg, planted = observed_register(blds, final, {}, CFG, "id test")
    a = match_by_location(blds, final, hide_truth(reg), {}, CFG)
    wrong_ids = [{**r, "building_id": "nonsense"} for r in reg]
    b = match_by_location(blds, final, wrong_ids, {}, CFG)
    assert [m["property_id"] for m in a[0]] == [m["property_id"] for m in b[0]]


def test_location_outcomes_shift_missing_far():
    blds, final = street(3)
    rec = lambda i, dx=0.0, dy=0.0: {"property_id": f"R{i}", "use_type": final[i]["use"], "floors": final[i]["floors"],
                                     "plinth_area_m2": blds[i]["area_m2"],
                                     "record_lat": F.ll(i * 20 + dx, 10 + dy)[0], "record_lon": F.ll(i * 20 + dx, 10 + dy)[1]}
    records = [rec(0), rec(1, dy=22.0), {**rec(0), "property_id": "FAR", "record_lat": F.ll(500, 500)[0], "record_lon": F.ll(500, 500)[1]}]
    res, unmatched, pairs = match_by_location(blds, final, records, {}, CFG)
    by = {m["building_id"]: m for m in res}
    assert by["w0"]["match_status"] == "matched" and by["w0"]["match_confidence"] == "high"
    assert by["w1"]["property_id"] == "R1" and "location_shift" in by["w1"]["discrepancies"] and by["w1"]["match_confidence"] == "low"
    assert by["w2"]["match_status"] == "no_record"
    assert [u["property_id"] for u in unmatched] == ["FAR"]
    acc = pairing_accuracy(pairs, [{"property_id": "R0", "building_id": "w0"}, {"property_id": "R1", "building_id": "w1"}],
                           [{"property_id": "R1", "building_id": "w1", "kind": "location_shift"}])
    assert acc["all"]["right_pct"] == 100.0 and acc["pin_moved"]["paired_right"] == 1


def test_trust_register_endpoint(offline):
    r = offline.get("/trust/register").json()
    assert "made-up data" in r["note"] and r["total"]["pairing"]["records"] > 0
    w = next(a for a in r["areas"] if a["area"] == "ward29")
    assert w["available"] and set(w["recovery"]) == {"missing_record", "location_shift", "area_understated", "use_change", "extra_floor"}
    assert w["pairing"]["pin_not_moved"]["right_pct"] == 99.7          # D64 re-run: 331 of 332 (Sep run: 100.0)
    assert w["recovery"]["use_change"]["false_alarms"] == 0 and w["recovery"]["extra_floor"]["false_alarms"] == 0


def test_import_register_csv_round_trip(tmp_path):
    """tools/import_register.py: a CSV made from Ward 29's register (area in sq ft, bad rows added) loads, reports the
    skipped rows, and pairs with the area exactly as the app does."""
    import import_register as IR
    reg = area_file("ward29", "register_synthetic")
    p = tmp_path / "reg.csv"
    with open(p, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["NO", "LAT", "LON", "USE", "FLOORS", "SQFT"])
        for r in reg:
            w.writerow([r["property_id"], r["record_lat"], r["record_lon"], {"commercial": "Shop", "residential": "Home"}.get(r["use_type"] or "", r["use_type"] or ""),
                        r["floors"] if r["floors"] is not None else "", r["plinth_area_m2"] / IR.SQFT_M2])
        w.writerow(["", 11.03, 76.97, "Shop", 1, 100])
        w.writerow([reg[0]["property_id"], 11.03, 76.97, "", "", ""])
        w.writerow(["X-1", "", "", "Shop", "two", ""])
    mapping = {"id": "NO", "lat": "LAT", "lon": "LON", "use": "USE", "floors": "FLOORS", "area": "SQFT", "area_unit": "sqft",
               "use_values": {"Shop": "commercial", "Home": "residential"}}
    records, rep = IR.normalise(IR.read_rows(str(p), mapping), mapping)
    assert rep["loaded"] == len(reg) and rep["skipped_by_reason"] == {"no id": 1, "duplicate id": 1, "no coordinates": 1}
    assert abs(records[0]["plinth_area_m2"] - reg[0]["plinth_area_m2"]) < 0.2
    _, _, summary = IR.match_area(os.path.join(ROOT, "data", "areas", "ward29"), records, CFG)
    exp = raw_export("ward29")
    assert summary["building_with_no_record"] == sum(b["match_status"] == "no_record" for b in exp["buildings"])
    assert summary["differs"] == sum(b["match_status"] == "discrepancy" for b in exp["buildings"])


# ------------------------------------------------------------------------------------------------ D44
def stub_area(polys):
    a = Area.__new__(Area)
    a.frame, a.max_range = F, CFG.ray_max_range_m
    a.footprints = [Polygon(p) for p in polys]
    a.fp_ids = [f"w{i}" for i in range(len(polys))]
    a.tree = STRtree(a.footprints)
    return a


def test_sign_is_linked_by_its_own_line_of_sight():
    """camera at the origin facing north (heading 0, photo aimed at w0); w0 is north-west, w1 north-east"""
    area = stub_area([[(-14, 8), (-2, 8), (-2, 20), (-14, 20)], [(2, 8), (14, 8), (14, 20), (2, 20)]])
    la, lo = F.ll(0, 0)
    det = lambda x1, x2, crop, pitch=0: {"cls": "signboard", "crop": crop, "camera_lat": la, "camera_lon": lo, "heading": 0.0,
                                         "pitch": pitch, "fov": 90, "W": 640, "H": 640, "x1": x1, "x2": x2, "y1": 300, "y2": 340,
                                         "u": (x1 + x2) / 2, "footprint_faced": "w0"}
    links = link_signs([det(100, 160, "a.jpg"), det(480, 540, "b.jpg"), det(480, 540, "c.jpg", pitch=22)], area)
    assert links["a.jpg"]["fp"] == "w0" and links["b.jpg"]["fp"] == "w1" and links["c.jpg"]["fp"] == "w1"
    assert links["b.jpg"]["planned"] == "w0"
    ocr = relink_ocr([{"file": "/x/b.jpg", "fp": "w0", "tier": 2}], links)
    assert ocr[0]["fp"] == "w1" and ocr[0]["fp_planned"] == "w0"
    assert links["a.jpg"]["rule"] == "kept_aimed" and links["b.jpg"]["rule"] == "own_ray"
    far = link_signs([{**det(310, 330, "d.jpg"), "heading": 180.0}], area)               # facing south: nothing there
    assert far["d.jpg"]["fp"] == "w0" and far["d.jpg"]["rule"] == "kept_aimed"            # no clear hit: keeps the aim
    none = link_signs([{**det(310, 330, "e.jpg"), "heading": 180.0, "footprint_faced": None}], area)
    assert none["e.jpg"]["fp"] is None


def test_sign_near_the_edge_of_two_outlines_keeps_the_aimed_one():
    """the sign's ray hits w1, but a line 4 degrees to its left still touches the aimed outline w0: not a clear move"""
    area = stub_area([[(-14, 8), (-0.3, 8), (-0.3, 20), (-14, 20)], [(0.3, 8), (14, 8), (14, 20), (0.3, 20)]])
    la, lo = F.ll(0, 0)
    d = {"cls": "signboard", "crop": "f.jpg", "camera_lat": la, "camera_lon": lo, "heading": 0.0, "pitch": 0, "fov": 90,
         "W": 640, "H": 640, "x1": 322, "x2": 332, "y1": 300, "y2": 340, "u": 327, "footprint_faced": "w0"}
    assert link_signs([d], area, CFG.sign_link_margin_deg)["f.jpg"]["fp"] == "w0"
    assert link_signs([d], area, 0.0)["f.jpg"]["fp"] == "w1"                               # the plain ray would move it


def test_pitched_bearing_matches_level_bearing_at_the_centre_column():
    d = {"heading": 73.0, "pitch": 22, "fov": 90, "W": 640, "H": 640, "x1": 300, "x2": 340, "y1": 200, "y2": 260}
    assert abs(box_bearing(d) - 73.0) < 1e-6
    lvl = {**d, "pitch": 0, "u": 520}
    assert abs(box_bearing(lvl) - pixel_to_bearing(73.0, 520, 640, 90)) < 1e-9


@pytest.mark.parametrize("slug", ALL)
def test_ocr_names_come_from_signs_linked_to_that_building(slug):
    """every building named by OCR alone has a tier-2 sign read with that text whose own line of sight hits it"""
    links = area_file(slug, "sign_links")
    reads = {}
    for r in area_file(slug, "ocr"):
        k = os.path.basename(r.get("file") or "")
        if r.get("tier") == 2 and k in links:
            reads.setdefault(links[k]["fp"], set()).add(r.get("best"))
    for b in raw_export(slug)["buildings"]:
        n = b["attributes"].get("name") or {}
        if n.get("route") == "tier2_ocr":
            assert n["value"] in reads.get(b["id"], set()), (slug, b["id"], n["value"])


# ------------------------------------------------------------------------------------------------ D45
def test_uncertainty_grows_with_distance_and_matches_model_card():
    xs = [uncertainty_for(d / 2, CFG) for d in range(0, 41)]
    assert xs == sorted(xs) and uncertainty_for(None, CFG) == CFG.single_cam_unc_bands[-1][1]
    from pole_uncertainty import fitted
    with open(os.path.join(ROOT, "data", "model_card.json"), encoding="utf-8") as f:
        mc = json.load(f)
    block = mc["single_camera_by_distance"]
    # D65: the table shows the circles the map draws (the pipeline's setting); a re-measurement that fits differently is
    # stated next to it, never silently used
    used = tuple((u["up_to_m"], u["plus_minus_m"]) for u in block["used_uncertainty_m"])
    assert used == tuple(CFG.single_cam_unc_bands)
    for (u, v), f, row in zip(used, fitted(block["bands"]), block["used_uncertainty_m"]):
        assert (u, v) == f or f"re-measured here: ±{f[1]} m" in row["basis"]
    assert all(r["n"] >= 10 for r in block["bands"]) and block["n"] == sum(r["n"] for r in block["bands"])


@pytest.mark.parametrize("slug", ALL)
def test_single_camera_assets_use_their_distance(slug):
    for a in raw_export(slug)["assets"]:
        if a["method"] == "triangulated":
            assert a["uncertainty_basis"].startswith("triangulation")
        else:
            assert a["uncertainty_m"] == uncertainty_for(a["camera_distance_m"], CFG)
            assert "m away" in a["uncertainty_basis"] or "distance unknown" in a["uncertainty_basis"]


def test_map_circle_radius_is_the_asset_uncertainty(offline):
    feats = offline.get("/areas/ward29/geojson?layers=assets").json()["features"]
    by = {a["id"]: a for a in raw_export("ward29")["assets"]}
    assert all(f["properties"]["uncertainty_m"] == by[f["properties"]["id"]]["uncertainty_m"] for f in feats)
    assert {f["properties"]["uncertainty_m"] for f in feats if f["properties"]["approximate"]} >= {2.6, 5.0}   # D65: 0-8 m ±2.6 m


# ------------------------------------------------------------------------------------------------ reloads keep decisions
def test_reload_keeps_and_reports_a_decided_item_that_left_the_queue(online, tmp_path):
    from app import loader
    slug = "pytest_p7a_reload"
    src = os.path.join(ROOT, "data", "areas", "tiruppur_uthukuli_road")
    for n in ("export.json", "run_report.json", "streets.json", "street_names.json", "plan.json"):
        shutil.copy(os.path.join(src, n), tmp_path / n)
    D = online.app.state.data
    try:
        with D.pool.connection() as c:
            loader.load_area(c, str(tmp_path), slug=slug)
            ids = c.execute("select r.id from review_items r join areas a on a.id = r.area_id where a.slug = %s order by r.id",
                            (slug,)).fetchall()
            assert len(ids) >= 2
            c.execute("update review_items set status = 'approved', reviewer = 'test' where id = %s", (ids[0][0],))
        exp = json.load(open(tmp_path / "export.json", encoding="utf-8"))
        exp["review_queue"] = []                                         # every finding leaves the queue
        exp["meta"]["counts"]["review_items"] = 0
        json.dump(exp, open(tmp_path / "export.json", "w", encoding="utf-8"))
        with D.pool.connection() as c:
            res = loader.load_area(c, str(tmp_path), slug=slug)
            left = c.execute("select r.id, r.status from review_items r join areas a on a.id = r.area_id where a.slug = %s",
                             (slug,)).fetchall()
        d = res["review_diff"]
        assert [x["id"] for x in d["kept_decided_not_in_queue"]] == [ids[0][0]] and d["kept_decided_not_in_queue"][0]["status"] == "approved"
        assert len(d["removed_pending"]) == len(ids) - 1 and not d["added"]
        assert left == [(ids[0][0], "approved")]                         # the decision is still there
    finally:
        with D.pool.connection() as c:
            c.execute("delete from areas where slug = %s", (slug,))
        D.db.invalidate()


def test_live_runs_use_the_p7a_steps():
    """run_area (Colab worker) applies the same D42-D45 code as the re-apply: sign links before names, the observed
    register paired by location, businesses on unanalysed outlines, and the distance-based uncertainty in the export"""
    src = open(os.path.join(ROOT, "pipeline", "geo_cascadia", "run_area.py"), encoding="utf-8").read()
    for s in ("link_signs(dets, area, cfg.sign_link_margin_deg)", "relink_ocr(ocr_res, sign_links)", "relink_vlm_names(run_names(",
              "observed_register(buildings, final, bpos, cfg, area_name)", "match_by_location(buildings, final, hide_truth(register)",
              'registered={b["building_id"] for b in buildings}', 'save("register_synthetic", register)'):
        assert s in src, s
    assert src.index("relink_ocr(") < src.index("run_names(") < src.index("finalize_buildings(")
    exp = open(os.path.join(ROOT, "pipeline", "geo_cascadia", "export.py"), encoding="utf-8").read()
    assert "uncertainty_for(cam_d, cfg)" in exp and "cfg.single_cam_uncertainty_m" not in exp
