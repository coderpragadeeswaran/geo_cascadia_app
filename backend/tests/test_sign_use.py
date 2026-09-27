"""D32: building use from sign text (pipeline/geo_cascadia/signuse.py) and stricter name quality (textmatch.name_kind)."""
import json
import os
import sys

import pytest

from app.settings import ROOT
from conftest import AREAS, raw_export

sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.signuse import fill_use_from_signs  # noqa: E402
from geo_cascadia.textmatch import name_kind, name_quality  # noqa: E402

CFG = Config()


def rec(bid, name, src="ocr", use=None):
    return {"building_id": bid, "use": use, "use_route": "tier3_vlm" if use else None, "name": name, "name_src": src}


def read(bid, text, conf=0.95, w=120, h=60, tier=2):
    return {"fp": bid, "tier": tier, "best": text, "clean": text, "text": text, "best_conf": conf, "w": w, "h": h}


def test_fills_only_unknown_use_and_never_overwrites_a_model_decision():
    final = [rec("a", "Savitha Dry Cleaners"), rec("b", "Kumar Textiles", use="residential")]
    out, st = fill_use_from_signs(final, [read("a", "SAVITHA DRY CLEANERS"), read("b", "KUMAR TEXTILES")], CFG)
    assert out[0]["use"] == "commercial" and out[0]["use_route"] == "sign_text"
    assert out[1]["use"] == "residential" and out[1]["use_route"] == "tier3_vlm"          # model decision kept
    assert st == {"unknown_before": 1, "filled": 1, "skipped": {}}


@pytest.mark.parametrize("name,ocr,why", [
    ("Sri Lakshmi Illam", read("x", "SRI LAKSHMI ILLAM"), "house name plate"),
    ("Murugan Nilayam", read("x", "MURUGAN NILAYAM"), "house name plate"),
    ("Rose Villa", read("x", "ROSE VILLA"), "house name plate"),
    ("Anand Traders", read("x", "ANAND TRADERS", w=40, h=30), "sign too small (name plate)"),
    ("Anand Traders", read("x", "ANAND TRADERS", conf=0.40, tier=3), "no readable OCR read of this name"),
    ("COIMBATO", read("x", "COIMBATO"), "sign text is fragment"),
    ("NO PARKING", read("x", "NO PARKING"), "sign text is nonname"),
    ("Avarampalayam Road", read("x", "AVARAMPALAYAM ROAD"), "sign text is street"),
    ("SQUARE", read("x", "SQUARE"), "one short word: too little to tell"),
])
def test_rule_skips(name, ocr, why):
    out, st = fill_use_from_signs([rec("x", name)], [ocr], CFG)
    assert out[0]["use"] is None and st["skipped"] == {why: 1}


def test_vlm_only_names_are_not_evidence():
    out, _ = fill_use_from_signs([rec("x", "Anand Traders", src="vlm_unverified")], [read("x", "ANAND TRADERS")], CFG)
    assert out[0]["use"] is None


@pytest.mark.parametrize("text,kind", [("COIMBATO", "fragment"), ("rOI Go", "fragment"), ("EDICINES", "fragment"),
                                       ("S.D.L. Machine Tools", "name"), ("transport india pvt ltd", "name"),
                                       ("COACHING", "business_word"), ("ganapathy gardens", "street"), ("TO LET", "nonname")])
def test_name_kind(text, kind):
    assert name_kind(text) == kind


def test_name_quality_display_rule():
    assert name_quality("COIMBATO", "ocr", False) == "fragment"
    assert name_quality("COACHING", "ocr", False) == "fragment"                 # a business, but not its name
    assert name_quality("S.D.L. Machine Tools", "vlm_verified_by_ocr", False) == "good"
    assert name_quality("COIMBATO", "ocr", True) == "good"                       # Google-confirmed stays good


@pytest.mark.parametrize("slug", AREAS)
def test_applied_to_saved_runs(slug):
    """Every sign_text use sits on a building the model could not classify (no usable building photo), and the export
    is consistent with final_attributes.json."""
    exp = raw_export(slug)
    with open(os.path.join(ROOT, "data", "areas", slug, "vlm_buildings.json"), encoding="utf-8") as f:
        modelled = {r["fp"] for r in json.load(f) if "vlm" in r}
    with open(os.path.join(ROOT, "data", "areas", slug, "final_attributes.json"), encoding="utf-8") as f:
        fin = {r["building_id"]: r for r in json.load(f)}
    for b in exp["buildings"]:
        u = b["attributes"]["use"]
        assert u["value"] == fin[b["id"]]["use"] and u["route"] == (fin[b["id"]].get("use_route") or ("tier3_vlm" if u["value"] else None))   # older runs: no use_route
        if u["route"] == "sign_text":
            assert u["value"] == "commercial" and b["id"] not in modelled
    assert exp["meta"]["run"].get("buildings_use_sign", 0) == sum(b["attributes"]["use"]["route"] == "sign_text" for b in exp["buildings"])


def test_display_name_only_when_readable(offline):
    """Review rows and map features carry a sign text as the name only when its quality is good."""
    exp = raw_export("ward29")
    q = {b["id"]: (b["attributes"].get("name") or {}) for b in exp["buildings"]}
    rows = offline.get("/review?area=ward29&page_size=500").json()["rows"]
    for r in rows:
        if r["item_type"] == "building" and r["object"]["name"]:
            assert q[r["ref_id"]].get("quality") == "good"


@pytest.mark.parametrize("slug", AREAS)
def test_hood_step06_counts(offline, slug):
    """Hood step 06: local + cloud + shop sign + not known = all buildings (never a missing count)."""
    u = offline.get(f"/areas/{slug}/hood").json()["routes"]["use"]
    B = raw_export(slug)["buildings"]
    route = lambda r: sum((b["attributes"]["use"].get("route") == r) for b in B)
    assert u == {"local": route("tier1_local_clip"), "vlm": route("tier3_vlm"), "sign": route("sign_text"),
                 "unknown": sum(not b["attributes"]["use"]["value"] for b in B)}
    assert sum(u.values()) == len(B)


def test_generic_sign_words_are_never_names():
    for t in ("OPENING", "GRAND OPENING", "WELCOME", "SALE", "New Offer", "today"):
        assert name_kind(t) == "nonname" and name_quality(t, "ocr", False) == "fragment"
    assert name_kind("SALES") == "business_word" and name_kind("Sri Balaji Stores Grand Opening") == "name"
