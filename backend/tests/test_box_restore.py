"""D61: a retired Street View panorama re-issued under a new id is the same image when its replacement has the same
capture month, is <= 5 m away and the production detector finds the saved boxes again on it; then the saved boxes are
drawn on the replacement (stored heading / pitch / fov). The comparison rule, its plumbing through the evidence API, the
Hood note and the monthly check's spot-check bookkeeping. No Google call and no detector run here."""
import importlib.util
import itertools
import json
import os

import pytest

from app import evidence, photos, sameimage
from app.settings import ROOT
from app.store import JsonStore

AREAS = os.path.join(ROOT, "data", "areas")
OLD = "ward29_v1"       # D64: the Sep 2026 Ward 29 run (its retired panoramas), a hidden backup since the switch
CAM = {"lat": 11.03561906110748, "lon": 76.98019144932174}
GONE_ID = "IzK35muPb34GUZjakVoDOg"          # transport india pvt ltd (w1236978849), 2nd Street, Gandhi Nagar
NEW = {"status": "OK", "pano_id": "NEWPANO", "date": "2026-02", "location": {"lat": CAM["lat"] + 1e-6, "lng": CAM["lon"]}}


def fake(answers):
    def fetch(params, key):
        return answers.get(params["pano"]) if "pano" in params else answers.get("near")
    return fetch


def box(cls, conf, x1, y1, x2, y2):
    return {"cls": cls, "conf": conf, "x1": x1, "y1": y1, "x2": x2, "y2": y2}


SAVED = [box("building", 0.9, 0, 100, 300, 600), box("signboard", 0.8, 50, 200, 250, 260), box("pole", 0.6, 400, 50, 420, 600),
         box("signboard", 0.35, 320, 300, 380, 330)]


def test_hungarian_matches_brute_force():
    import random
    rnd = random.Random(7)
    for _ in range(60):
        r, c = rnd.randint(1, 5), rnd.randint(1, 5)
        w = [[rnd.random() for _ in range(c)] for _ in range(r)]
        pairs = sameimage.hungarian_max(w)
        assert len({i for i, _ in pairs}) == len(pairs) == len({j for _, j in pairs}) == min(r, c)
        got = sum(w[i][j] for i, j in pairs)
        n = max(r, c)
        sq = [[w[i][j] if i < r and j < c else 0.0 for j in range(n)] for i in range(n)]
        best = max(sum(sq[i][p[i]] for i in range(n)) for p in itertools.permutations(range(n)))
        assert abs(got - best) < 1e-9


def test_identical_boxes_are_the_same_image():
    m = sameimage.compare(SAVED, SAVED)
    assert m["median_iou"] == 1 and m["strong_recall"] == 1 and m["dx"] == 0 and m["missing"] == m["extra"] == 0
    assert sameimage.verdict(m) == ("same", [])


def test_a_weak_box_may_flicker():
    m = sameimage.compare(SAVED, SAVED[:3])               # the 0.35 sign is gone: strong boxes all there
    assert m["missing"] == 1 and sameimage.verdict(m)[0] == "same"


def test_shift_missing_strong_box_or_too_few_boxes():
    moved = [{**b, "x1": b["x1"] + 12, "x2": b["x2"] + 12} for b in SAVED]
    v, why = sameimage.verdict(sameimage.compare(SAVED, moved))
    assert v == "different" and any("shift" in w for w in why)
    v, why = sameimage.verdict(sameimage.compare(SAVED, [SAVED[0]]))
    assert v == "different" and any("strong boxes" in w for w in why)
    v, _ = sameimage.verdict(sameimage.compare(SAVED[:1] + SAVED[3:], SAVED[:1] + SAVED[3:]))
    assert v == "cant_tell"                                # one strong box can't tell two photos apart


def test_metadata_half_of_the_rule():
    assert sameimage.metadata_ok({"date": "2026-02", "moved_m": 5.0}, "2026-02")
    assert not sameimage.metadata_ok({"date": "2026-02", "moved_m": 5.1}, "2026-02")
    assert not sameimage.metadata_ok({"date": "2026-03", "moved_m": 0.0}, "2026-02")


def test_candidate_views_most_confident_first(ward29):
    _b, D = ward29
    c = sameimage.candidate_views(D.index(OLD), GONE_ID)
    assert c and all(set(v) == {"heading", "pitch", "fov"} for v, _ in c)
    strong = [sum(x["conf"] >= sameimage.STRONG_CONF for x in bx) for _v, bx in c]
    assert strong == sorted(strong, reverse=True)


@pytest.fixture(scope="module")
def ward29():
    return JsonStore(AREAS).bundle(OLD), evidence.Detections(AREAS)


def _areas_with(tmp_path, rows, restore=True):
    d = tmp_path / "areas" / "x"
    d.mkdir(parents=True)
    (d / "photo_check.json").write_text(json.dumps({"photo_refs": 1, "same_image": rows,
                                                    "same_image_restore": {"restore": restore}}))
    return str(tmp_path / "areas")


def test_go_no_go_gate_per_area(tmp_path):
    rows = {f"p{i}": {"pano_id": f"n{i}", "verdict": "same" if i < 3 else "different"} for i in range(68)}
    rows["c"] = {"pano_id": "nc", "verdict": "cant_tell"}
    g = sameimage.restore_gate(rows)
    assert g["restore"] is False and (g["passed"], g["judged"]) == (3, 68)          # Ward 29, 7 Oct 2026
    assert sameimage.restore_gate({k: {**r, "verdict": "same"} for k, r in rows.items() if r["verdict"] != "cant_tell"})["restore"]
    assert not sameimage.restore_gate({})["restore"]
    # a failed gate restores nothing, not even the panoramas that passed alone
    assert photos.same_images(_areas_with(tmp_path / "no", rows, restore=False)) == {}
    assert set(photos.same_images(_areas_with(tmp_path / "yes", rows, restore=True))) == {"p0", "p1", "p2"}


def test_only_a_verified_reissue_with_the_same_id_keeps_its_boxes(tmp_path, ward29):
    b, D = ward29
    m = photos.PhotoMeta(str(tmp_path / "c.json"), "k", fake({GONE_ID: {"status": "ZERO_RESULTS"}, "near": NEW}))
    for n, (rows, want) in enumerate((({GONE_ID: {"pano_id": "NEWPANO", "verdict": "same"}}, True),
                       ({GONE_ID: {"pano_id": "NEWPANO", "verdict": "different"}}, False),
                       ({GONE_ID: {"pano_id": "OTHER", "verdict": "same"}}, False),      # re-issued again since the check
                       ({}, False))):
        same = photos.same_images(_areas_with(tmp_path / f"t{n}", rows))
        views = photos.annotate(m, b, "building", "w1236978849", evidence.evidence(D, b, "building", "w1236978849"), same=same)
        for v in views:
            assert bool(v["current"].get("same_image")) is want
            if want:                                       # the stored view, so the saved boxes sit where they were
                assert (v["current"]["heading"], v["current"]["pitch"], v["current"]["fov"]) == (v["heading"], v["pitch"], v["fov"])
                assert any(x["target"] for x in v["boxes"])


def test_check_area_lists_references_and_the_hood_note_says_it(tmp_path, ward29):
    b, D = ward29
    refs = photos.photo_refs(D, b)
    pano_ids = sorted({v["pano_id"] for _k, _i, v in refs})
    gone = pano_ids[:3]
    ok = {p: {"status": "OK", "pano_id": p, "date": "2025-01", "location": {"lat": 1, "lng": 1}} for p in pano_ids}
    fetch = fake({**ok, **{p: {"status": "ZERO_RESULTS"} for p in gone}, "near": NEW})
    same = {gone[0]: {"pano_id": "NEWPANO", "verdict": "same"}}
    c = photos.check_area(photos.PhotoMeta(str(tmp_path / "c.json"), "k", fetch), D, b, same=same)
    n_gone = sum(v["pano_id"] in gone for _k, _i, v in refs)
    n_same = sum(v["pano_id"] == gone[0] for _k, _i, v in refs)
    assert c["gone"] == n_gone == len(c["references"]) and c["gone_same_image"] == n_same and c["panoramas_gone_same_image"] == 1
    assert sum(r["same_image"] for r in c["references"]) == n_same
    assert {r["old_pano"] for r in c["references"] if r["same_image"]} == {gone[0]}
    d = tmp_path / "areas" / "x"
    d.mkdir(parents=True)
    (d / "photo_check.json").write_text(json.dumps(c))
    note = photos.area_note(str(tmp_path / "areas"), "x")
    assert f"{n_same} of them are the same photos under new IDs" in note["text"]
    assert f"for the other {n_gone - n_same}" in note["text"]
    assert "references" not in note and "same_image" not in note          # the Hood gets the line, not the list


def _tool():
    spec = importlib.util.spec_from_file_location("check_photos", os.path.join(ROOT, "tools", "check_photos.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_monthly_check_keeps_verdicts_and_never_guesses(ward29):
    _b, D = ward29
    tool = _tool()
    cur = {"pano_id": "NEWPANO", "date": "2026-02", "moved_m": 0.0}
    gone = {GONE_ID: {"current": cur, "stored_date": "2026-02"},
            "OLDER": {"current": {**cur, "date": "2025-01"}, "stored_date": "2026-02"},
            "NONE": {"current": None, "stored_date": "2026-02"}}
    prev = {GONE_ID: {"pano_id": "NEWPANO", "verdict": "same", "metrics": {"median_iou": 0.97}}}
    rows, fetched = tool.spot_check(gone, D.index(OLD), prev, None, None)
    assert rows[GONE_ID] == prev[GONE_ID] and fetched == 0               # already checked against this replacement
    assert rows["OLDER"]["verdict"] == "different" and rows["NONE"]["verdict"] == "no_replacement"
    # re-issued again (new id) and no detector: not checked, so no boxes
    rows, _ = tool.spot_check(gone, D.index(OLD), {GONE_ID: {**prev[GONE_ID], "pano_id": "OTHER"}}, None, None)
    assert rows[GONE_ID]["verdict"] == "not_checked"


def test_committed_check_files_are_consistent():
    """tools/check_photos.py output: every gone reference listed; same_image only where its panorama passed"""
    for slug in os.listdir(AREAS):
        p = os.path.join(AREAS, slug, "photo_check.json")
        if not os.path.isfile(p):
            continue
        with open(p, encoding="utf-8") as f:
            c = json.load(f)
        rows, refs = c.get("same_image") or {}, c.get("references") or []
        gate = (c.get("same_image_restore") or {}).get("restore")
        assert len(refs) == c["gone"], slug
        assert sum(r["same_image"] for r in refs) == c.get("gone_same_image", 0), slug
        for r in refs:
            ok = bool(gate) and (rows.get(r["old_pano"]) or {}).get("verdict") == "same" and rows[r["old_pano"]]["pano_id"] == r["new_pano"]
            assert r["same_image"] == ok, (slug, r)


def test_ward29_study_result_restores_nothing():
    """7 Oct 2026: the replacements are neighbouring frames of the same drive, not the same photo (D61): no boxes back"""
    with open(os.path.join(AREAS, OLD, "photo_check.json"), encoding="utf-8") as f:
        c = json.load(f)
    assert c["same_image_restore"]["restore"] is False and c["gone_same_image"] == 0
    assert photos.same_images(AREAS) == {}
