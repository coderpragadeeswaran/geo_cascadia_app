"""D66 (pre-review polish): no developer text in what the pages, the PDF and the GIS files show; the routed vs all-cloud
lane keeps its dollar digits; the "Nearest camera" photo prefers a Google-car panorama; every Ward 29 sign photo has its
orange sign box. Display and wording only: no number changes."""
import json
import os
import re

from app.report import plain_text
from app.settings import ROOT

AREAS = os.path.join(ROOT, "data", "areas")
DEV = re.compile(r"\.py\b|\.json\b|tools[\\/]|\bdata/|backend/|model_card|\(D\d{1,2}\)|tier1_local_clip|tier3_vlm\b|"
                 r"use\.route|building_views|match\.py")


def test_trust_lane_keeps_dollars_and_seconds(client):
    t = client.get("/trust").json()
    lane = [x for x in t["experiments"] if x["lane"] == "Building use" and ("router" in x["name"] or "every building" in x["name"])]
    nums = {n["label"]: n for x in lane for n in x["numbers"]}
    assert nums["cloud cost per building"]["kind"] == "usd" and nums["cloud cost per building"]["value"] > 0
    assert nums["time per building"]["kind"] == "s" and nums["time per building"]["value"] > 0
    vals = sorted(n["value"] for x in lane for n in x["numbers"] if n["label"] == "cloud cost per building")
    assert vals == [0.0002271, 0.0002714]                                    # the model card's measured values, unchanged


def test_consistency_notes_are_plain_words(client):
    rows = client.get("/trust/consistency").json()["rows"]
    assert rows
    for r in rows:
        assert not DEV.search(r.get("note") or ""), r["note"]
        if isinstance(r.get("computed"), str):                              # objects are shown through the page's word map
            assert not DEV.search(r["computed"]), r["computed"]


def test_hood_cost_sources_and_story_reasons_are_plain_words(client):
    for slug in ("ward29", "trichy_bharathidasan_salai", "tiruppur_uthukuli_road"):
        h = client.get(f"/areas/{slug}/hood").json()
        for line in h["cost"]["lines"]:
            assert not DEV.search(line.get("source") or ""), line["source"]
        for s in h["story"]:
            assert not DEV.search(s.get("why") or ""), s["why"]
        for t in (h.get("routing") or {}).get("tasks", []):
            for r in t["routes"]:
                assert not DEV.search(r.get("usd_src") or "") and not DEV.search(r.get("lat_src") or "")


def test_report_gate1_note_has_no_tool_path():
    mc = json.load(open(os.path.join(ROOT, "data", "model_card.json"), encoding="utf-8"))
    raw = mc["gate1_position"]["status_note"]
    assert "tools/eval_gate1.py" in raw                                     # the model card itself is not edited
    out = plain_text(raw)
    assert "tools/" not in out and ".py" not in out and out.endswith("ready for surveyed points.")
    num = lambda x: re.findall(r"\d+(?:\.\d+)?", re.sub(r"\(tools/[^)]*\)", "", x))
    assert num(out) == num(raw)                                               # numbers kept


def test_ward29_has_no_street_name_list(client):
    r = client.get("/areas/ward29/street-names").json()
    assert r["available"] is False                                           # Under the Hood hides the section


def test_nearest_camera_prefers_a_google_car_panorama(client):
    # Ward 29's 8th Street building has one planned photo, a user photosphere: it stays (no new photo), labelled as such
    ev = client.get("/areas/ward29/evidence/building/w1252504670").json()["views"]
    assert [v["label"] for v in ev] == ["Nearest camera"] and "taken by a Street View user" in ev[0]["user_note"]
    assert ev[0]["pano_id"] == "CAoSFkNJSE0wb2dLRUlDQWdJRDRrLTJtWnc."
    # every fallback in every original area: a Google-car photo whenever one faces the building
    for slug in ("ward29", "trichy_bharathidasan_salai", "tiruppur_uthukuli_road"):
        with open(os.path.join(AREAS, slug, "panos.json"), encoding="utf-8") as f:
            src = {p["pano_id"]: p.get("source") for p in json.load(f)}
        with open(os.path.join(AREAS, slug, "export.json"), encoding="utf-8") as f:
            B = json.load(f)["buildings"]
        for b in B:
            evb = b.get("evidence") or {}
            if evb.get("attribute_view") or evb.get("sign_view") or not evb.get("views"):
                continue
            views = client.get(f"/areas/{slug}/evidence/building/{b['id']}").json()["views"]
            near = [v for v in views if v["key"] == "v0"]
            if not near:
                continue                                                     # a "Best photo" building
            google = [v for v in evb["views"] if src.get(v["pano_id"]) != "user"]
            if google:
                assert near[0]["pano_id"] == google[0]["pano_id"] and near[0]["label"] == "Nearest camera"


def test_every_ward29_sign_photo_has_its_orange_sign_box(client):
    with open(os.path.join(AREAS, "ward29", "export.json"), encoding="utf-8") as f:
        B = [b for b in json.load(f)["buildings"] if (b.get("evidence") or {}).get("sign_view")]
    assert len(B) == 154
    for b in B:
        sign = [v for v in client.get(f"/areas/ward29/evidence/building/{b['id']}").json()["views"] if v["key"] == "sign"]
        tg = [x for x in sign[0]["boxes"] if x.get("target")]
        assert sign[0]["target"] == "box" and len(tg) == 1 and tg[0]["cls"] == "signboard"
        assert min(tg[0]["x2"], 640) - max(tg[0]["x1"], 0) >= 4 and min(tg[0]["y2"], 640) - max(tg[0]["y1"], 0) >= 4
