"""ui-polish-2 (D59): the city projection is gone; OpenStreetMap shop pairs are "near each other (location only)"; OSM floor
levels only where tagged; the reviewer's corrected value saved with a decision (never over ours), restored by Undo; the
sign text on evidence boxes. Review writes go only to the test area (conftest `review_area`) and are undone."""
import json

import pytest
from fastapi import HTTPException

from app import mapdata, osmref, report, review
from conftest import TEST_REVIEWER, raw_export


# ------------------------------------------------------------------------------------------------ 1. projection removed
def test_projection_endpoint_and_module_are_gone(client):
    assert client.get("/projection").status_code == 404
    with pytest.raises(ImportError):
        from app import projection  # noqa: F401
    assert "/projection" not in json.dumps(client.get("/openapi.json").json()["paths"])


def _content(online, slug="ward29", street=None):
    app = online.app
    mapdata.configure(app.state.data.pool)
    mapdata._DOWN["until"] = 0
    s = app.state.data.db
    b = s.bundle(slug)
    return b, report.content(s, b, app.state.runfiles.get(slug), app.state.model_card.get(), app.state.settings.areas_dir, street=street)


def test_report_has_no_projection(online):
    _, c = _content(online)
    assert "projection" not in c and "city" not in c
    src = open(report.__file__, encoding="utf-8").read().lower()
    assert "projection" not in src and "whole city" not in src
    assert "whole-city" not in json.dumps(c, default=str).lower()


# ------------------------------------------------------------------------------------------------ 6. OSM wording
def test_osm_pairs_are_location_only_and_names_said(client):
    r = client.post("/query", json={"area": "ward29", "text": "Businesses in OpenStreetMap"}).json()
    n = r["osm"]["counts"]
    assert (n["matched"], n["matched_same_name"], n["camera"], n["osm"], n["camera_only"], n["osm_only"]) == (10, 0, 141, 14, 131, 4)     # D64 re-run
    assert "near each other (location only; names didn't match)" in r["note"]
    assert "same place" not in r["note"]
    assert r["understanding"]["understood"][0]["meaning"] == "businesses near an OpenStreetMap point (location only)"
    assert "location only" in r["osm"]["rule"] and "Same place" not in r["osm"]["rule"]
    assert all("names don't match" in v for v in osmref.shop_status_by_id(
        client.get("/areas/ward29/osm").json()["shops"]).values() if v.startswith("near"))


def test_report_osm_labels(online):
    sh = online.get("/areas/ward29/osm").json()["shops"]
    rows, _ = report._shop_rows(sh)
    labels = {r[0] for r in rows}
    assert "Near each other (location only)" in labels and not any("Matched" in x for x in labels)
    assert sum(r[0] == "Near each other (location only)" for r in rows) == 10
    assert report._names_line(sh["counts"]) == "the names didn't match for any of them"


# ------------------------------------------------------------------------------------------------ 7. OSM floor levels
def test_osm_levels_blank_unless_tagged(online):
    tags = osmref.load("ward29", online.app.state.settings.areas_dir)
    ex = raw_export("ward29")
    tagged = [b["id"] for b in ex["buildings"] if osmref.building_levels(tags, b["id"])["osm_levels"] is not None]
    assert len(tagged) == 2 and len(ex["buildings"]) == 373
    lv = online.get("/areas/ward29/osm").json()["levels"]
    assert (lv["tagged"], lv["buildings"]) == (2, 373)
    _, c = _content(online)
    t = c["tables"]["buildings"]
    col = t["columns"].index("OSM building:levels (cross-check)")
    assert {r[0] for r in t["rows"] if r[col]} <= set(tagged)
    assert all(r[col] in ("", "10") for r in t["rows"])                 # blank, never "not tagged"


# ------------------------------------------------------------------------------------------------ 5. corrected value
def test_parse_corrected_rules():
    assert review.parse_corrected(None) is None and review.parse_corrected("  ") is None
    assert review.parse_corrected('{"floors": 2, "use": "mixed", "name": " Zinco "}') == {"floors": 2, "use": "mixed", "name": "Zinco"}
    for bad in ('{"floors": -1}', '{"floors": 2.5}', '{"floors": true}', '{"use": "castle"}', '{"name": ""}', '{"x": 1}', "[]", "{}", "nope"):
        with pytest.raises(HTTPException):
            review.parse_corrected(bad)


def _row(online, iid):
    with online.app.state.data.pool.connection() as c:
        return c.execute("select status, reviewer, note, appeal_photo_url, corrected from review_items where id = %s", (iid,)).fetchone()


def test_no_with_a_corrected_value_and_undo_restores_it(online, review_area):
    item = online.get(f"/review?area={review_area}&status=pending&page_size=5").json()["rows"][0]
    iid, ref, kind = item["id"], item["ref_id"], item["item_type"]
    coll, path = ("buildings", "buildings") if kind == "building" else ("assets", "assets")
    before = _row(online, iid)
    assert before[4] is None
    r = online.patch(f"/review/{iid}", data={"action": "reject", "reviewer": TEST_REVIEWER, "note": "pytest: 3 floors",
                                             "corrected": json.dumps({"floors": 3, "use": "commercial"})})
    assert r.status_code == 200, r.text
    j = r.json()
    try:
        assert j["status"] == "rejected" and j["corrected"] == {"floors": 3, "use": "commercial"} and j["note"] == "pytest: 3 floors"
        assert _row(online, iid)[4] == {"floors": 3, "use": "commercial"}
        ev = online.get(f"/review/{iid}/events").json()["events"][0]
        assert ev["corrected"] == {"floors": 3, "use": "commercial"} and ev["previous_corrected"] is None
        d = online.get(f"/{path}/{review_area}/{ref}").json()
        rec = d[kind]
        assert d["review_item"]["corrected"] == {"floors": 3, "use": "commercial"}
        assert rec["review"]["corrected"] == {"floors": 3, "use": "commercial"}
        # never over our value or the register
        raw = next(x for x in raw_export("tiruppur_uthukuli_road")[coll] if x["id"] == ref)
        assert rec.get("attributes") == raw.get("attributes") and rec.get("register") == raw.get("register")
        # the report says it in words
        assert "reviewer says: 3 floors · Commercial" in report.review_cell(rec["review"])
    finally:
        u = online.post(f"/review/{iid}/undo", json={"item_id": iid, "event_id": j["event_id"], "reviewer": TEST_REVIEWER})
        assert u.status_code == 200 and u.json()["corrected"] is None
    assert _row(online, iid) == before
    ev = online.get(f"/review/{iid}/events").json()["events"][0]
    assert ev["action"] == "undo" and ev["corrected"] is None and ev["previous_corrected"] == {"floors": 3, "use": "commercial"}


def test_corrected_value_rules_through_the_api(online, review_area):
    iid = online.get(f"/review?area={review_area}&status=pending&page_size=1").json()["rows"][0]["id"]
    bad = online.patch(f"/review/{iid}", data={"action": "reject", "reviewer": TEST_REVIEWER, "corrected": '{"floors": 99}'})
    assert bad.status_code == 422
    ap = online.patch(f"/review/{iid}", data={"action": "appeal", "reviewer": TEST_REVIEWER, "note": "n", "corrected": '{"floors": 2}'})
    assert ap.status_code == 422 and "not with an appeal" in ap.json()["detail"]
    assert _row(online, iid)[0] == "pending"
    # a Yes may carry a value for a second question (e.g. floors on a building missing from the register)
    yes = online.patch(f"/review/{iid}", data={"action": "approve", "reviewer": TEST_REVIEWER, "corrected": '{"floors": 2}'}).json()
    try:
        assert yes["status"] == "approved" and yes["corrected"] == {"floors": 2}
    finally:
        assert online.post(f"/review/{iid}/undo", json={"item_id": iid, "event_id": yes["event_id"], "reviewer": TEST_REVIEWER}).json()["corrected"] is None


def test_offline_review_rows_carry_an_empty_corrected(offline):
    rows = offline.get("/review?area=ward29&page_size=5").json()["rows"]
    assert rows and all("corrected" in r and r["corrected"] is None for r in rows)


# ------------------------------------------------------------------------------------------------ 3. sign text on boxes
def test_sign_boxes_carry_their_text_and_the_target_is_unchanged(client):
    v = client.get("/areas/ward29/evidence/building/w1252503923").json()["views"][0]
    signs = [b for b in v["boxes"] if b["cls"] == "signboard"]
    assert signs and any(b.get("text") for b in signs)
    assert all("text" not in b for b in v["boxes"] if b["cls"] != "signboard")
    assert sum(b["target"] for b in v["boxes"]) == 1 and v["target"] == "box"
