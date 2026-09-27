"""CLAUDE.md §10 acceptance on Ward 29 (no worker): queries 1–4 via POST /query, 5 via the detail endpoints.
Expected values are computed independently from the raw export.json, not from the API."""
from collections import Counter

Q1 = "Show commercial buildings with more than two visible floors that do not have a matching property record"
Q2 = "Show streets where no streetlight is detected within 60 m"
Q3 = "Display only low-confidence floor-count predictions and create a review queue"
Q4 = "Chart of unmatched buildings by street"


def ask(client, text, area="ward29"):
    r = client.post("/query", json={"area": area, "text": text})
    assert r.status_code == 200, r.text
    return r.json()


def test_1_commercial_over_two_floors_no_record(client, ward29):
    res = ask(client, Q1)
    assert res["parsed_filters"] == {"intent": "buildings", "use": "commercial", "floors_op": ">", "floors_n": 2,
                                     "match_status": "no_record"}
    B = ward29["buildings"]
    no_rec = [b for b in B if b["match_status"] == "no_record"]
    comm = [b for b in no_rec if b["attributes"]["use"]["value"] in ("commercial", "mixed")]
    meas = [b for b in comm if b["attributes"]["floors"]["status"] == "measured" and b["attributes"]["floors"]["value"] is not None]
    hits = [b for b in meas if b["attributes"]["floors"]["value"] > 2]
    assert res["total"] == len(hits)
    assert [r["id"] for r in res["rows"]] == [b["id"] for b in hits]
    if not hits:  # empty → why_empty funnel "381 → 19 no record → 1 commercial → … → 0"
        assert [f["count"] for f in res["why_empty"]] == [len(B), len(no_rec), len(comm), len(meas), 0]
        assert res["why_empty"][0]["step"] == "all buildings"


def test_2_streetlight_gaps_60m(client, ward29):
    res = ask(client, Q2)
    assert res["parsed_filters"] == {"intent": "streetlight_gaps", "interval_m": 60}
    gaps = ward29["streetlight_gaps"]
    assert res["total"] == len(gaps) > 0
    assert sorted(r["id"] for r in res["rows"]) == sorted(g["id"] for g in gaps)
    lengths = [r["length_m"] for r in res["rows"]]
    assert lengths == sorted(lengths, reverse=True)                      # list sorted by length
    assert all(r["start"] and r["end"] and r["gap_type"] for r in res["rows"])


def test_3_low_confidence_floors_review_queue(client, ward29):
    res = ask(client, Q3)
    assert res["parsed_filters"] == {"intent": "review", "reason_has": "floor count low confidence"}
    expected = [q["building_id"] for q in ward29["review_queue"]
                if any("floor count low confidence" in r for r in q["reasons"])]
    low_conf = [b["id"] for b in ward29["buildings"] if b["attributes"]["floors"]["status"] == "low_confidence"]
    assert sorted(r["ref_id"] for r in res["rows"]) == sorted(expected) == sorted(low_conf)
    assert all(r["kind"] == "review_item" and r["item_type"] == "building" for r in res["rows"])
    if not res["offline"]:                     # online rows carry review ids → one click can send them to Review
        assert all(isinstance(r["id"], int) for r in res["rows"])


def test_4_unmatched_by_street_chart(client, ward29):
    res = ask(client, Q4)
    assert res["parsed_filters"] == {"intent": "buildings", "match_status": "no_record", "group_by": "street"}
    expected = Counter(b["street"] for b in ward29["buildings"] if b["match_status"] == "no_record")
    assert {g["key"]: g["count"] for g in res["groups"]} == dict(expected)
    counts = [g["count"] for g in res["groups"]]
    assert counts == sorted(counts, reverse=True)


def test_5_click_building_and_asset_evidence(client, ward29):
    b = next(x for x in ward29["buildings"] if x["evidence"]["attribute_view"] and x["attributes"]["use"]["route"])
    r = client.get(f"/buildings/ward29/{b['id']}")
    assert r.status_code == 200, r.text
    rec = r.json()["building"]
    av = rec["evidence"]["attribute_view"]
    assert av == b["evidence"]["attribute_view"]                         # stored pano/heading/pitch/fov + box
    assert {"pano_id", "heading", "pitch", "fov", "x1", "y1", "x2", "y2"} <= set(av)
    assert 0 <= av["x1"] < av["x2"] <= 640 and 0 <= av["y1"] < av["y2"] <= 640
    assert rec["attributes"]["use"]["route"] in ("tier1_local_clip", "tier3_vlm")   # route badge
    assert rec["register"]["source"] == "SYNTHETIC"                      # labelled synthetic
    a = ward29["assets"][0]
    r = client.get(f"/assets/ward29/{a['id']}")
    assert r.status_code == 200
    views = r.json()["asset"]["evidence"]["views"]
    assert views and all({"pano_id", "heading", "pitch", "fov"} <= set(v) for v in views)


def test_counts_computed_from_records(client, ward29):
    """D2/D9: summary counts come from records (20 triangulated; 135 not classified after D32), not story text."""
    r = client.get("/areas/ward29").json()
    s = r["summary"]
    assert s["assets_triangulated"] == sum(a["method"] == "triangulated" for a in ward29["assets"]) == 20
    unknown = sum(b["attributes"]["use"]["value"] is None for b in ward29["buildings"])
    assert s["use_not_classified"] == unknown == 135                                   # 160 before D32 (use from sign text)
    assert r["dashboard"]["kpi"]["use_not_classified"] == unknown
    assert r["dashboard"]["charts"]["building_use"]["not classified"] == unknown
    assert any("triangulated" in c["field"] and c["stored"] == 29 and c["computed"] == 20 for c in r["consistency"])
    assert r["cost"]["model_card"]["source"] == "model_card"             # D1
    assert r["cost"]["run_stats_representative"] is False
