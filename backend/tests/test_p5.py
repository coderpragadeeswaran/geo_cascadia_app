"""P5 (D29): Review, Under the Hood, Trust and Jobs.

Review writes go ONLY to the dedicated test area (conftest `review_area`) with reviewer='test'; every decision is undone,
uploaded test photos are deleted. Expected Hood numbers are recounted here straight from the raw run files and
export.json, independently of backend/app/hood.py. Trust numbers are resolved in data/model_card.json by their `src`.
"""
import io
import json
import os
import re
import struct
import zlib

import httpx
import pytest

from app import storage
from app.settings import ROOT, Settings
from conftest import AREAS, TEST_REVIEWER, raw_export

POLY = {"type": "Polygon", "coordinates": [[[77.3425, 11.1080], [77.3440, 11.1080], [77.3440, 11.1092], [77.3425, 11.1080]]]}


def _png(w=8, h=8):
    """A tiny valid PNG (no PIL on the laptop)."""
    raw = b"".join(b"\x00" + b"\xff\xa2\x3a" * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def _pending(online, area, n=1, item_type=None):
    q = f"/review?area={area}&status=pending&page_size=500" + (f"&item_type={item_type}" if item_type else "")
    rows = online.get(q).json()["rows"]
    assert len(rows) >= n
    return rows[:n]


def _undo(online, iid, ev):
    r = online.post(f"/review/{iid}/undo", json={"item_id": iid, "event_id": ev, "reviewer": TEST_REVIEWER})
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------------------------------------ review
def test_reviewer_name_saved_with_every_decision(online, review_area):
    item = _pending(online, review_area)[0]
    iid = item["id"]
    assert online.patch(f"/review/{iid}", data={"action": "approve"}).status_code == 422             # name required
    assert online.patch(f"/review/{iid}", data={"action": "approve", "reviewer": "  "}).status_code == 422
    r = online.patch(f"/review/{iid}", data={"action": "reject", "reviewer": TEST_REVIEWER})
    assert r.status_code == 200, r.text
    try:
        assert r.json()["reviewer"] == TEST_REVIEWER
        ev = online.get(f"/review/{iid}/events").json()["events"][0]
        assert ev["id"] == r.json()["event_id"] and ev["reviewer"] == TEST_REVIEWER and ev["action"] == "reject"
    finally:
        _undo(online, iid, r.json()["event_id"])
    undo_ev = online.get(f"/review/{iid}/events").json()["events"][0]
    assert undo_ev["action"] == "undo" and undo_ev["reviewer"] == TEST_REVIEWER                     # who pressed Undo


def test_history_lists_who_what_when_and_undone(online, review_area):
    iid = _pending(online, review_area)[0]["id"]
    a = online.patch(f"/review/{iid}", data={"action": "approve", "reviewer": TEST_REVIEWER}).json()
    b = online.patch(f"/review/{iid}", data={"action": "reject", "reviewer": TEST_REVIEWER}).json()
    _undo(online, iid, b["event_id"])
    _undo(online, iid, a["event_id"])
    ev = online.get(f"/review/{iid}/events").json()["events"]
    mine = [e for e in ev if e["id"] >= a["event_id"]]
    assert [e["action"] for e in mine] == ["undo", "undo", "reject", "approve"]                         # newest first
    by = {e["id"]: e for e in mine}
    assert by[b["event_id"]]["undone_by"] and by[a["event_id"]]["undone_by"]                            # both marked undone
    assert by[b["event_id"]]["previous_status"] == "approved" and by[a["event_id"]]["previous_status"] == "pending"
    assert all(e["created_at"] and e["reviewer"] == TEST_REVIEWER for e in mine)
    assert online.get(f"/review/{iid}").json()["status"] == "pending"


def test_note_and_photo_only_with_an_appeal(online, review_area):
    """D59 (ui-polish-2, intended change): a No (reject) may carry its own note; a Yes may not; a photo only with an appeal"""
    iid = _pending(online, review_area)[0]["id"]
    r = online.patch(f"/review/{iid}", data={"action": "approve", "reviewer": TEST_REVIEWER, "note": "typed in the appeal box"})
    assert r.status_code == 422 and "not with a Yes" in r.json()["detail"]
    for action in ("approve", "reject"):
        r = online.patch(f"/review/{iid}", data={"action": action, "reviewer": TEST_REVIEWER},
                         files={"photo": ("x.png", _png(), "image/png")})
        assert r.status_code == 422 and "only with an appeal" in r.json()["detail"]
    no = online.patch(f"/review/{iid}", data={"action": "reject", "reviewer": TEST_REVIEWER, "note": "no: the roof is hidden"}).json()
    assert no["status"] == "rejected" and no["note"] == "no: the roof is hidden"
    assert _undo(online, iid, no["event_id"])["note"] is None
    assert online.patch(f"/review/{iid}", data={"action": "appeal", "reviewer": TEST_REVIEWER}).status_code == 422
    ap = online.patch(f"/review/{iid}", data={"action": "appeal", "reviewer": TEST_REVIEWER, "note": "pytest appeal"}).json()
    ok = online.patch(f"/review/{iid}", data={"action": "approve", "reviewer": TEST_REVIEWER}).json()
    try:
        assert ap["note"] == "pytest appeal" and ok["status"] == "approved" and ok["note"] is None    # the note stays in history
        hist = online.get(f"/review/{iid}/events").json()["events"]
        assert hist[0]["previous_note"] == "pytest appeal"
    finally:
        _undo(online, iid, ok["event_id"])
        assert _undo(online, iid, ap["event_id"])["status"] == "pending"


def test_appeal_photo_private_bucket_signed_url(online, review_area):
    st = Settings()
    if not (st.supabase_url and st.supabase_service_key):
        pytest.skip("photo storage not configured")
    iid = _pending(online, review_area)[0]["id"]
    big = b"\x00" * (storage.MAX_BYTES + 1)
    assert online.patch(f"/review/{iid}", data={"action": "appeal", "reviewer": TEST_REVIEWER, "note": "x"},
                        files={"photo": ("x.gif", b"GIF89a", "image/gif")}).status_code == 415           # type limit
    assert online.patch(f"/review/{iid}", data={"action": "appeal", "reviewer": TEST_REVIEWER, "note": "x"},
                        files={"photo": ("x.png", big, "image/png")}).status_code == 413                  # size limit
    r = online.patch(f"/review/{iid}", data={"action": "appeal", "reviewer": TEST_REVIEWER, "note": "pytest photo"},
                     files={"photo": ("p.png", _png(), "image/png")})
    assert r.status_code == 200, r.text
    ev_id = r.json()["event_id"]
    with online.app.state.data.pool.connection() as c:
        path = c.execute("select photo from review_events where id = %s", (ev_id,)).fetchone()[0]
    try:
        assert path and path.startswith(f"{review_area}/review-{iid}-")
        ev = online.get(f"/review/{iid}/events").json()["events"][0]
        assert ev["has_photo"] is True and "photo" not in ev                                           # no path in the list
        url = online.get(f"/review/{iid}/events/{ev_id}/photo").json()["url"]
        assert "/object/sign/" in url and "token=" in url
        assert httpx.get(url, timeout=20).status_code == 200                                           # signed URL works
        public = f"{st.supabase_url}/storage/v1/object/public/{st.supabase_bucket}/{path}"
        assert httpx.get(public, timeout=20).status_code >= 400                                        # bucket is private
        assert online.get(f"/review/{iid}/photo").json()["url"]
    finally:
        _undo(online, iid, ev_id)
        storage.delete_object(st, path)


def test_review_filters_combine(online, review_area):
    rows = online.get(f"/review?area={review_area}&page_size=500").json()["rows"]
    street = rows[0]["street"]
    reason = rows[0]["reasons"][0]
    prio = rows[0]["priority"]
    got = online.get(f"/review?area={review_area}&page_size=500&status=pending&street={street}&reason={reason}&priority={prio}").json()["rows"]
    want = [r for r in rows if r["status"] == "pending" and r["street"] == street and reason in r["reasons"] and r["priority"] == prio]
    assert [r["id"] for r in got] == [r["id"] for r in want] and got
    none = online.get(f"/review?area={review_area}&page_size=500&reason=no such reason").json()["rows"]
    assert none == []


def test_waiting_kpi_counts_only_waiting(online, review_area):
    k0 = online.get(f"/areas/{review_area}").json()["dashboard"]["kpi"]
    iid = _pending(online, review_area)[0]["id"]
    r = online.patch(f"/review/{iid}", data={"action": "approve", "reviewer": TEST_REVIEWER}).json()
    try:
        k1 = online.get(f"/areas/{review_area}").json()["dashboard"]["kpi"]
        assert k1["waiting_for_review"] == k0["waiting_for_review"] - 1
        assert k1["low_confidence_observations"] == k0["low_confidence_observations"]                 # the queue size
    finally:
        _undo(online, iid, r["event_id"])


# ------------------------------------------------------------------------------------------------ under the hood
def _load(slug, name):
    p = os.path.join(ROOT, "data", "areas", slug, f"{name}.json")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


@pytest.mark.parametrize("slug", AREAS)
def test_hood_numbers_equal_computed_counts(offline, slug):
    """Recount from the raw files (not via app/hood.py) and compare every headline number."""
    h = offline.get(f"/areas/{slug}/hood").json()
    n = h["n"]
    exp = raw_export(slug)
    B, A, G = exp["buildings"], exp["assets"], exp["streetlight_gaps"]
    plan, panos, dets, ocr = _load(slug, "plan"), _load(slug, "panos"), _load(slug, "detections"), _load(slug, "ocr")
    bv = {q["fp"]: q for q in _load(slug, "building_views")}
    views = [v for e in plan for v in e["views"]]
    use = lambda b: (b["attributes"].get("use") or {})
    want = {
        "panoramas": len(panos), "cameras": len(plan), "views": len(views),
        "views_unmapped": sum(v.get("footprint") is None for v in views), "boxes": len(dets),
        "boxes_geom_ok": sum(bool(d.get("geom_ok")) for d in dets), "sign_crops": len(ocr),
        "signs_ocr": sum(o.get("tier") == 2 for o in ocr), "signs_vlm": sum(o.get("tier") == 3 for o in ocr),
        "buildings": len(B), "buildings_no_box": sum(b["id"] not in bv for b in B),
        "buildings_usable": sum(b["id"] in bv and bool(bv[b["id"]].get("reliable")) for b in B),
        "use_local": sum(use(b).get("route") == "tier1_local_clip" for b in B),
        "use_vlm": sum(use(b).get("route") == "tier3_vlm" for b in B),
        "use_unknown": sum(use(b).get("value") is None for b in B),
        "assets": len(A), "assets_triangulated": sum(a.get("method") == "triangulated" for a in A),
        "pos_triangulated": sum((b.get("predicted_position") or {}).get("method") == "triangulated" for b in B),
        "pos_wall_hit": sum((b.get("predicted_position") or {}).get("method") == "wall_hit" for b in B),
        "pos_footprint_centre": sum((b.get("predicted_position") or {}).get("method") == "footprint_centre" for b in B),
        "pos_rejected": sum(bool((b.get("predicted_position") or {}).get("reason")) for b in B),
        "match_no_record": sum(b["match_status"] == "no_record" for b in B),
        "match_discrepancy": sum(b["match_status"] == "discrepancy" for b in B),
        "gaps": len(G), "gaps_m": round(sum(g["length_m"] for g in G)),
        "named": sum(bool((b["attributes"].get("name") or {}).get("value")) for b in B),
        "named_google": sum(bool((b["attributes"].get("name") or {}).get("google_confirmed")) for b in B),
        "unmapped_kept": len(exp.get("unmapped_businesses") or []), "review_items": len(exp["review_queue"]),
    }
    assert {k: n[k] for k in want} == want
    assert all(k in h["src"] for k in n)                                                     # every number has a source
    # the Sankey's first column adds up to the panoramas; the buildings group to the buildings
    col0 = sum(s["value"] for s in h["sankey"]["columns"][0]["segments"])
    assert col0 == n["panoramas"] - n["cameras_dropped_other"]
    bg = next(g for g in h["sankey"]["columns"][3]["groups"] if g["id"] == "g_buildings")
    assert sum(s["value"] for s in bg["segments"]) == n["buildings"]
    # every number in every story sentence is a computed number
    verdict = h["coverage"]["verdict"] or ""
    for p in re.findall(r"(\d+)%", verdict):                                                  # the verdict's share = computed
        assert int(p) == round(100 * n["views_unmapped"] / n["views"])
    for s in h["story"]:
        for x in re.findall(r"\d[\d,]*", s["text"].replace(verdict, "")):
            v = int(x.replace(",", ""))
            assert v in set(v2 for v2 in n.values() if isinstance(v2, int)) | {2, 12}, (s["text"], v)   # "2+ cameras", "12-heading"


def test_hood_story_corrections_ward29(offline):
    c = offline.get("/areas/ward29/hood").json()["corrections"]
    by = {x["chapter"]: x for x in c}
    assert "20 triangulated" in by["positions"]["text"] and "29 triangulated" in by["positions"]["stored"]
    assert "221 had a usable view" in by["buildings"]["text"] and "43 had no building box" in by["buildings"]["text"]
    assert set(by) == {"positions", "buildings"}


def test_hood_same_online_and_offline(online, offline):
    a, b = online.get("/areas/ward29/hood").json(), offline.get("/areas/ward29/hood").json()
    live = {"review_waiting"}                                    # live review state exists only in the database (D11)
    strip = lambda n: {k: v for k, v in n.items() if k not in live}
    assert strip(a["n"]) == strip(b["n"]) and a["story"] == b["story"] and a["streets"] == b["streets"]


@pytest.mark.parametrize("key", ["streets", "cameras.kept", "views.unmapped", "det.tilted", "signs.ocr", "bld.rejected",
                                 "use.local", "assets.approximate", "pos.rejected", "match.no_record", "gaps", "unmapped.kept"])
def test_hood_examples_are_real(offline, key):
    ex = offline.get("/areas/ward29/hood/examples", params={"key": key}).json()["examples"]
    exp = raw_export("ward29")
    ids = {"building": {b["id"] for b in exp["buildings"]}, "asset": {a["id"] for a in exp["assets"]},
           "unmapped": {u["id"] for u in exp["unmapped_businesses"]}, "gap": {g["id"] for g in exp["streetlight_gaps"]}}
    assert 1 <= len(ex) <= 3
    for e in ex:
        assert e["reason"]
        if e["kind"] in ids:
            assert e["id"] in ids[e["kind"]]
        if e["kind"] == "photo":
            assert e["view"]["pano_id"] and all(0 <= b["x1"] <= b["x2"] <= 640 for b in e["boxes"])
        assert "(unnamed" not in e["title"]
    assert offline.get("/areas/ward29/hood/examples", params={"key": "nope"}).status_code == 422


def test_hood_timings_flagged_as_resumed(offline):
    c = offline.get("/areas/ward29/hood").json()["cost"]
    assert c["timings"]["representative"] is False and c["timings"]["badge"] == "resumed run, not representative"
    mc = json.load(open(os.path.join(ROOT, "data", "model_card.json"), encoding="utf-8"))
    vlm = next(x for x in c["lines"] if x["key"] == "vlm")
    # P8 (D50): the model card's $0.056 left out the name and business-sign checks; the line is the like-for-like recount
    assert vlm["status"] == "computed" and abs(vlm["value"] - 0.0702) < 0.0005 and vlm["value"] != mc["cost_time"]["ward29_vlm_usd_with_router"]
    t = offline.get("/areas/tiruppur_uthukuli_road/hood").json()["cost"]
    assert next(x for x in t["lines"] if x["key"] == "vlm")["status"] == "not recorded"


# ------------------------------------------------------------------------------------------------ trust
def _mc():
    with open(os.path.join(ROOT, "data", "model_card.json"), encoding="utf-8") as f:
        return json.load(f)


def _at(mc, path):
    x = mc
    for k in path.split("."):
        x = x[int(k)] if isinstance(x, list) else x[k]
    return x


def test_trust_shows_only_model_card_values(offline):
    t = offline.get("/trust").json()
    mc = _mc()
    nums = []
    for c in t["cards"]:
        nums += [c["result"]] + ([c["baseline"]] if c["baseline"] else []) + c["more"]
    for e in t["experiments"]:
        nums += e["numbers"]
    assert len(nums) > 40
    for x in nums:
        if x["src"] is None:                                   # only the D32 sign rule: explicitly "not measured"
            assert x["value"] == "not measured"
            continue
        assert _at(mc, x["src"]) == x["value"], x
        if "n" in x:
            src = x["n_src"]
            val = _at(mc, src)
            assert val == x["n"] or (isinstance(val, dict) and re.search(rf"_n{x['n']}$", src)), x   # n in a key name
    assert {c["id"] for c in t["cards"]} == {"use", "use_sign", "floors", "names", "streetlights", "position"}
    sign = next(c for c in t["cards"] if c["id"] == "use_sign")
    assert "not measured" in sign["measured"] and sign["caveat"].startswith("Known limits: adverts/posters can mislead")
    floors = next(c for c in t["cards"] if c["id"] == "floors")
    assert floors["result"]["n"] == 36                                                              # D2: floors n=36
    assert t["confusion_matrix"] is None                                                            # none in model_card
    for c in t["cards"]:                                                                            # verdict numbers too
        pcts = {f"{round(v * 100)}%" for v in _flat(mc) if isinstance(v, float) and v <= 1}
        for p in re.findall(r"\d+%", c["verdict"]):
            assert p in pcts, (c["id"], p)


def _flat(o):
    if isinstance(o, dict):
        for v in o.values():
            yield from _flat(v)
    elif isinstance(o, list):
        for v in o:
            yield from _flat(v)
    else:
        yield o


def test_trust_consistency_lists_story_and_counters(offline):
    rows = offline.get("/trust/consistency").json()["rows"]
    w = [r for r in rows if r["area"] == "ward29"]
    fields = {r["field"] for r in w}
    assert "meta.run.buildings_use_local" in fields and "run_report.story (positions)" in fields
    assert all(r["jump"]["page"] in ("hood", "trust", "explore") for r in rows)
    assert not any(r["area"] == "pytest_review_items" for r in rows)


# ------------------------------------------------------------------------------------------------ jobs
def _mkjob(online, test=True, name="pytest job"):
    r = online.post("/jobs", json={"polygon": POLY, "name": name, "test": test})
    assert r.status_code == 201, r.text
    return r.json()["job"]


def test_clear_test_jobs_removes_only_test_jobs(online):
    with online.app.state.data.pool.connection() as c:
        busy = c.execute("select count(*) from jobs where not is_test and status in "
                         "('queued', 'running', 'expired_token', 'needs_approval')").fetchone()[0]
    if busy:
        pytest.skip("a real analysis is active; this test needs to queue a real job (one street at a time)")
    t = _mkjob(online, True, "pytest test job")                       # a test job that failed
    real = _mkjob(online, False, "pytest real queued job")            # a real request, still queued
    done = []
    try:
        online.post(f"/jobs/{t['id']}/cancel")
        with online.app.state.data.pool.connection() as c:
            c.execute("update jobs set started_at = now() where id = %s", (t["id"],))   # started: only is_test qualifies it
        dry = online.post("/jobs/clear-test", json={"dry_run": True}).json()
        ids = {j["id"] for j in dry["jobs"]}
        assert t["id"] in ids and real["id"] not in ids and dry["removed"] == []
        assert all(j["status"] in ("failed", "no_street_view") and not j["area_slug"] for j in dry["jobs"])
        assert online.get(f"/jobs/{t['id']}").status_code == 200                           # dry run removed nothing
        r = online.post("/jobs/clear-test", json={"dry_run": False, "ids": [t["id"], real["id"]]}).json()
        assert r["removed"] == [t["id"]]                                                    # never the real queued one
        done.append(t["id"])
        assert online.get(f"/jobs/{t['id']}").status_code == 404
        assert online.get(f"/jobs/{real['id']}").json()["job"]["status"] == "queued"
    finally:
        with online.app.state.data.pool.connection() as c:
            c.execute("delete from jobs where id = any(%s::uuid[])", ([real["id"]] + [x for x in [t["id"]] if x not in done],))


def test_job_statuses_cancelled_and_interrupted(online):
    a, b = _mkjob(online), _mkjob(online)
    try:
        c = online.post(f"/jobs/{a['id']}/cancel").json()["job"]
        assert c["display_status"] == "cancelled" and c["is_test"] is True
        with online.app.state.data.pool.connection() as con:
            con.execute("update jobs set status = 'running', heartbeat_at = now() - interval '11 minutes' where id = %s", (b["id"],))
        g = online.get(f"/jobs/{b['id']}").json()
        assert g["job"]["display_status"] == "interrupted"
        assert g["estimate"] is None or g["estimate"]["is_estimate"] is True
    finally:
        with online.app.state.data.pool.connection() as con:
            con.execute("delete from jobs where id = any(%s::uuid[])", ([a["id"], b["id"]],))


# ------------------------------------------------------------------------------------------------ P5 browser round
@pytest.mark.parametrize("action", ["approve", "reject", "appeal"])
def test_each_decision_then_undo_shows_in_history(online, review_area, action):
    """R1 / R4: every decision and its undo appear in the item's history at once, with reviewer and note; the item ends
    exactly as it started (waiting, no reviewer / note)."""
    iid = _pending(online, review_area)[0]["id"]
    data = {"action": action, "reviewer": TEST_REVIEWER, **({"note": "pytest appeal note"} if action == "appeal" else {})}
    r = online.patch(f"/review/{iid}", data=data)
    assert r.status_code == 200, r.text
    ev = r.json()["event_id"]
    h = online.get(f"/review/{iid}/events").json()["events"]
    assert h[0]["id"] == ev and h[0]["action"] == action and h[0]["reviewer"] == TEST_REVIEWER
    assert h[0]["note"] == ("pytest appeal note" if action == "appeal" else None)
    u = _undo(online, iid, ev)
    assert u["status"] == "pending" and u["reviewer"] is None and u["note"] is None
    h = online.get(f"/review/{iid}/events").json()["events"]
    assert h[0]["action"] == "undo" and h[0]["undoes"] == ev and h[1]["undone_by"] == h[0]["id"]


def test_status_filter_is_strict(online, review_area):
    """R2: status=pending lists only waiting items, even right after a decision."""
    iid = _pending(online, review_area)[0]["id"]
    r = online.patch(f"/review/{iid}", data={"action": "approve", "reviewer": TEST_REVIEWER}).json()
    try:
        rows = online.get(f"/review?area={review_area}&status=pending&page_size=500").json()["rows"]
        assert all(x["status"] == "pending" for x in rows) and iid not in {x["id"] for x in rows}
        total = online.get(f"/review?area={review_area}&page_size=500").json()["rows"]
        assert len(rows) == sum(x["status"] == "pending" for x in total)
    finally:
        _undo(online, iid, r["event_id"])


@pytest.mark.parametrize("slug", AREAS)
def test_skipped_panoramas_split_by_planner_rules(offline, slug):
    n = offline.get(f"/areas/{slug}/hood").json()["n"]
    assert n["panoramas_off_street"] + n["panoramas_thinned"] == n["panoramas_not_selected"]
    for key in ("panos.off_street", "panos.thinned", "cameras.kept"):
        ex = offline.get(f"/areas/{slug}/hood/examples", params={"key": key}).json()["examples"]
        for e in ex:
            assert e["kind"] == "map" and e["points"]
            if key == "cameras.kept":
                assert e["rays"] and all(0 <= r["heading"] <= 360 for r in e["rays"])
            if key == "panos.off_street":
                assert re.match(r"\d+ m from the nearest analysed street", e["reason"]) and int(e["reason"].split()[0]) > 15


@pytest.mark.parametrize("slug", AREAS)
def test_no_guessed_building_box(offline, slug):
    """H7: only the pipeline's own box-to-outline match (building_views.json) is marked as the building. A building with
    no match gets no building target (its sign may still be marked, as the sign); a quality-rejected match says why."""
    exp = raw_export(slug)
    bv = {q["fp"]: q for q in _load(slug, "building_views")}
    for b in exp["buildings"]:
        if (b.get("evidence") or {}).get("attribute_view"):
            continue
        views = offline.get(f"/areas/{slug}/evidence/building/{b['id']}").json()["views"]
        targets = [x for v in views for x in v["boxes"] if x["target"] and x["cls"] == "building"]
        if b["id"] not in bv:
            assert not targets, b["id"]
            assert all(v.get("user_note") for v in views if v["key"] == "v0")
        else:
            best = next(v for v in views if v["key"] == "best")
            # D62: the orange box is the M3 choice; none when M3 can't tell (intended change)
            assert best["pano_id"] == bv[b["id"]]["pano_id"]
            assert len([x for x in best["boxes"] if x["target"]]) == (0 if best.get("box_choice") == "cant_tell" else 1)
            assert bool(best.get("user_note")) == (not bv[b["id"]].get("reliable"))


def test_view_examples_carry_camera_direction(offline):
    for key in ("views.unmapped", "views.mapped"):
        for e in offline.get("/areas/ward29/hood/examples", params={"key": key}).json()["examples"]:
            assert e["kind"] == "photo" and len(e["rays"]) == 1 and e["points"]
            assert (e["rays"][0]["faces"] is None) == (key == "views.unmapped")


def test_gate1_front_wall_centre_reference():
    """D33: organiser guidance, the front-wall-centre table for every area, map-derived rows marked, camera-derived pooled"""
    g = _mc()["gate1_position"]
    assert g["organiser_guidance"].startswith("Organiser guidance: OpenStreetMap footprints are accepted as the reference")
    for slug in AREAS:
        t = g["vs OSM front-wall centre"][slug]
        cnt = g["method_counts"][slug]
        assert t["camera-derived (triangulated + wall_hit)"]["n"] == cnt["triangulated"] + cnt["wall_hit"]
        assert t["all buildings"]["n"] == cnt["buildings"]
        assert all("uses the map" in k for k in t if k.startswith(("wall_hit", "wall_centre", "footprint_centre", "baseline")))
        wc = t["wall_centre (front-wall centre from the map; uses the map)"]
        assert wc["n"] == cnt["wall_centre"] and (wc["n"] == 0 or wc["p90_m"] < 0.05)     # the reference point itself
