"""Design pass B browser-walkthrough fixes (docs/DECISIONS.md D23): questions (1, 2, 3, 5, 7, 8), offline retry (4),
review saves (12) and singular / plural wording (14). Expected values come from the raw export / run files."""
import json
import os
import time

import pytest

from app import gaps, loader, queryparse, views
from app.db import DbUnavailable
from app.settings import ROOT, Settings
from app.store import Data, JsonStore
from conftest import AREAS, BAD_DB_URL, TEST_REVIEWER


def q(client, text, area="ward29", **kw):
    r = client.post("/query", json={"area": area, "text": text, **kw})
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ 1. spec questions run directly (no "partial" step)
SPEC = {
    # CLAUDE.md §10 wording and the original brief's wording, with the variants in docs/QUERY.md
    "Show commercial buildings with more than two visible floors that do not have a matching property record":
        {"intent": "buildings", "use": "commercial", "floors_op": ">", "floors_n": 2, "match_status": "no_record"},
    "Show all the commercial buildings that are more than 2 floors and have no record":
        {"intent": "buildings", "use": "commercial", "floors_op": ">", "floors_n": 2, "match_status": "no_record"},
    "Commercial buildings with more than 2 floors and no record":
        {"intent": "buildings", "use": "commercial", "floors_op": ">", "floors_n": 2, "match_status": "no_record"},
    "Show street segments where no streetlight was detected within 60 metres": {"intent": "streetlight_gaps", "interval_m": 60},
    "Show streets where no streetlight is detected within 60 m": {"intent": "streetlight_gaps", "interval_m": 60},
    "Which streets have no streetlight within 60 metres?": {"intent": "streetlight_gaps", "interval_m": 60},
    "Show me street segments without streetlights within 60 meters": {"intent": "streetlight_gaps", "interval_m": 60},
    "Streets where no streetlight is detected within 60 m": {"intent": "streetlight_gaps", "interval_m": 60},
    "Display only low-confidence floor-count predictions and create a review queue":
        {"intent": "review", "reason_has": "floor count low confidence"},
    "Display the low-confidence floor count predictions and create a review queue.":
        {"intent": "review", "reason_has": "floor count low confidence"},
    "Low-confidence floor counts for review": {"intent": "review", "reason_has": "floor count low confidence"},
    "Generate a chart of unmatched buildings by street": {"intent": "buildings", "match_status": "no_record", "group_by": "street"},
    "Chart of unmatched buildings by street": {"intent": "buildings", "match_status": "no_record", "group_by": "street"},
    "Create a bar chart of the unmatched buildings by street": {"intent": "buildings", "match_status": "no_record", "group_by": "street"},
}


@pytest.mark.parametrize("text", list(SPEC))
def test_spec_questions_zero_ignored(offline, text):
    r = q(offline, text)
    u = r["understanding"]
    assert r["parsed_filters"] == SPEC[text], (text, r["parsed_filters"])
    assert u["status"] == "ok" and u["ignored"] == [], (text, u)


def test_filler_words_are_neutral():
    for w in ("segments", "segment", "was", "were", "detected", "visible", "generate", "which", "where", "the", "any", "me"):
        assert w in queryparse.FILLER, w


# ------------------------------------------------------------------ 2. gaps at any interval, never "not computed" as 0
def _inputs(slug):
    b = JsonStore(Settings().areas_dir).bundle(slug)
    _, names, plan = loader.read_street_inputs(os.path.join(ROOT, "data", "areas", slug))
    return b, names, plan


@pytest.mark.parametrize("slug", AREAS)
def test_gaps_60m_reproduce_the_stored_ones(slug):
    b, names, plan = _inputs(slug)
    got = gaps.compute_gaps(b, plan, names, 60)
    key = lambda g: (g["street"], g["length_m"], round(g["start"][0], 6), round(g["start"][1], 6),
                     round(g["end"][0], 6), round(g["end"][1], 6), g["poles_inside"], g["gap_type"])
    assert sorted(map(key, got)) == sorted(map(key, b["streetlight_gaps"]))


def test_gaps_100m_fewer_but_not_zero(offline, ward29):
    r = q(offline, "streets with no streetlight within 100 metres")
    assert r["parsed_filters"] == {"intent": "streetlight_gaps", "interval_m": 100}
    assert 0 < r["total"] < len(ward29["streetlight_gaps"]) == 11
    assert r["gaps"]["computed"] is True and "pipeline stored only 60 m" in r["gaps"]["note"]
    assert all(row["computed"] and row["interval_m"] == 100 and row["length_m"] >= 100 and row["path"] for row in r["rows"])
    lengths = [row["length_m"] for row in r["rows"]]
    assert lengths == sorted(lengths, reverse=True)
    s60 = q(offline, "streets with no streetlight within 60 metres")
    assert s60["total"] == 11 and s60["gaps"]["computed"] is False                  # 60 m = the stored rows


def test_gaps_not_computable_is_said_plainly(tmp_path):
    b = JsonStore(Settings().areas_dir).bundle("ward29")
    r = views.run_query(b, "streets with no streetlight within 100 m", gaps_at=lambda iv: None)
    assert r["total"] is None and r["rows"] == [] and r["gaps"]["available"] is False
    assert "can't be computed" in r["gaps"]["note"]
    assert gaps.compute_gaps(b, None, {}, 100) is None


# ------------------------------------------------------------------ 3. one scope: the question respects the selected street
def test_question_answered_on_selected_street(offline, ward29):
    st = "Sathy Main Road"
    r = q(offline, "buildings not in the register", scope_street=st)
    assert r["parsed_filters"]["street"] == st and r["understanding"]["scoped_to"] == st
    assert r["total"] == sum(b["street"] == st and b["match_status"] == "no_record" for b in ward29["buildings"])
    # a question that names its own street keeps it; a by-street chart covers every street
    assert q(offline, "buildings not in the register on Korathottam Road", scope_street=st)["parsed_filters"]["street"] == "Korathottam Road"
    chart = q(offline, "chart of unmatched buildings by street", scope_street=st)
    assert "street" not in chart["parsed_filters"] and chart["total"] == sum(b["match_status"] == "no_record" for b in ward29["buildings"]) == 27


# ------------------------------------------------------------------ 4. a stale pooled connection is retried, the reason logged
def test_stale_connection_retried_quietly(caplog):
    D = Data(Settings(database_url=BAD_DB_URL))
    calls = []

    class Pool:
        def close(self):
            calls.append("close")

    def fn(s):
        calls.append("run")
        if len(calls) == 1:
            raise DbUnavailable("OperationalError", "OperationalError on a reused idle connection: the server closed the connection", stale=True)
        return "ok"
    D.db, D.pool = object(), Pool()
    with caplog.at_level("INFO", logger="geo_cascadia.data"):
        assert D.read(fn) == ("ok", False)
    assert calls == ["run", "close", "run"] and D.db_online
    assert "reconnecting and retrying once" in caplog.text


def test_offline_fallback_logs_the_reason(caplog):
    D = Data(Settings(database_url=BAD_DB_URL))

    def fn(s):
        if s is D.db:
            raise DbUnavailable("OperationalError", "OperationalError while connecting: network timeout")
        return "json"
    D.db = object()
    with caplog.at_level("WARNING", logger="geo_cascadia.data"):
        assert D.read(fn) == ("json", True)
    assert "database unavailable - OperationalError while connecting: network timeout" in caplog.text


# ------------------------------------------------------------------ 5. businesses not on Google: 34 vs 93, explained
def test_google_count_explained(offline, ward29):
    r = q(offline, "businesses not on Google Maps")
    flag = "sign_not_in_google_within_40m"
    flagged = [b for b in ward29["buildings"] if flag in (b.get("google_flags") or [])]
    shops = [b for b in flagged if (b["attributes"].get("use") or {}).get("value") in ("commercial", "mixed")]
    ns, nf = len(shops), len(flagged)                         # D32: counts follow the data (34 / 93 before it)
    assert r["total"] == ns and ns > 0 and nf > ns
    assert r["note"].startswith(f"{ns} shops & businesses (commercial or mixed use) have a sign name")
    assert f"{nf} named buildings are not on Google" in r["note"] and f"including {nf - ns} that are not shops" in r["note"]


# ------------------------------------------------------------------ 7. any script: unknown words are ignored, never dropped
def test_tamil_word_is_reported_ignored(offline):
    u = q(offline, "கடைகள்")["understanding"]
    assert u["status"] == "not_understood" and u["ignored"] == ["கடைகள்"]
    u2 = q(offline, "shops கடைகள்")["understanding"]
    assert u2["status"] == "partial" and u2["ignored"] == ["கடைகள்"]


# ------------------------------------------------------------------ 8. loose street names
@pytest.mark.parametrize("text,street", [
    ("hospitals near Sathy road", "Sathy Main Road"),
    ("buildings on sathy", "Sathy Main Road"),
    ("poles on Sathyamangalam road", "Sathy Main Road"),
    ("buildings on SATHY  MAIN RD", "Sathy Main Road"),
    ("streetlights on korathottam rd", "Korathottam Road"),
    ("buildings on vinobaji st", "4th Street, Tatabad / Vinobaji Street"),
    ("buildings on Gandhi nagar", "2nd Street, Gandhi Nagar"),
])
def test_loose_street_names(offline, text, street):
    r = q(offline, text)
    assert r["parsed_filters"].get("street") == street, (text, r["parsed_filters"])
    assert street not in " ".join(r["understanding"]["ignored"])


def test_loose_street_reported_and_ambiguous_not_guessed(offline):
    u = q(offline, "hospitals near Sathy road")["understanding"]
    assert {"from": "sathy road", "to": "Sathy Main Road", "street": True} in u["synonyms"]
    assert u["ignored"] == ["hospitals"]
    amb = q(offline, "buildings on ganapathy gardens")                              # two streets fit: no guess
    assert "street" not in amb["parsed_filters"] and amb["understanding"]["ignored"] == ["ganapathy gardens"]


# ------------------------------------------------------------------ 12. review: one decision per press, fast, undo
# P5: these write only to the dedicated test area (conftest review_area), with reviewer='test'
def _statuses(online, area):
    return {r["id"]: (r["status"], r["note"]) for r in online.get(f"/review?area={area}&page_size=500").json()["rows"]}


def _undo(online, iid, event):
    return online.post(f"/review/{iid}/undo", json={"item_id": iid, "event_id": event, "reviewer": TEST_REVIEWER})


def test_rapid_decisions_each_apply_to_one_item(online, review_area):
    rows = [r for r in online.get(f"/review?area={review_area}&status=pending&page_size=500").json()["rows"]][:4]
    assert len(rows) == 4
    ids = [r["id"] for r in rows]
    before = _statuses(online, review_area)
    events = []
    try:
        times = []
        for iid in ids:                                              # four "A" presses = four saves, one item each
            t = time.perf_counter()
            r = online.patch(f"/review/{iid}", data={"action": "approve", "reviewer": TEST_REVIEWER})
            times.append(time.perf_counter() - t)
            assert r.status_code == 200 and r.json()["id"] == iid and r.json()["status"] == "approved"
            events.append((iid, r.json()["event_id"]))
        after = _statuses(online, review_area)
        assert {k for k in after if after[k] != before.get(k)} == set(ids)   # exactly those four, none skipped, no others
        ref = rows[0]["ref_id"]
        kind = "buildings" if rows[0]["item_type"] == "building" else "assets"
        rec = online.get(f"/{kind}/{review_area}/{ref}").json()
        assert (rec.get("building") or rec.get("asset"))["review"]["status"] == "approved"   # cache patched in place
        assert max(times) < 3.0, times
    finally:
        for iid, ev in reversed(events):                             # Undo each of OUR decisions, newest first
            assert _undo(online, iid, ev).status_code == 200
    assert _statuses(online, review_area) == before


def test_undo_reverts_exactly_one_decision(online, review_area):
    """Review fix 1: decide 3 items, undo the last: the other 2 keep their decisions; the undone one is back to exactly
    what it was (status + note); the history has one event per change."""
    rows = online.get(f"/review?area={review_area}&status=pending&page_size=500").json()["rows"][:3]
    ids = [r["id"] for r in rows]
    before = _statuses(online, review_area)
    events = []
    try:
        for iid, action in zip(ids, ("approve", "reject", "appeal")):
            r = online.patch(f"/review/{iid}", data={"action": action, "reviewer": TEST_REVIEWER, "note": "pytest appeal" if action == "appeal" else None})
            assert r.status_code == 200, r.text
            events.append((iid, r.json()["event_id"]))
        mid = _statuses(online, review_area)
        u = _undo(online, *events[-1])
        assert u.status_code == 200 and u.json()["status"] == before[ids[2]][0]
        events.pop()
        now = _statuses(online, review_area)
        assert now[ids[0]][0] == "approved" and now[ids[1]][0] == "rejected"          # the other two unchanged
        assert now[ids[2]] == before[ids[2]]                                            # the undone one: exactly as before
        assert {k for k in now if now[k] != mid[k]} == {ids[2]}                         # nothing else moved
        hist = online.get(f"/review/{ids[2]}/events").json()["events"]
        assert [e["action"] for e in hist[:2]] == ["undo", "appeal"] and hist[0]["undoes"] == hist[1]["id"]
    finally:
        for iid, ev in reversed(events):
            assert _undo(online, iid, ev).status_code == 200
    assert _statuses(online, review_area) == before


def test_undo_needs_explicit_item_and_decision(online, review_area):
    iid = online.get(f"/review?area={review_area}&status=pending&page_size=1").json()["rows"][0]["id"]
    assert online.post(f"/review/{iid}/undo", json={}).status_code == 422                              # no ids
    assert online.post(f"/review/{iid}/undo", json={"event_id": 1}).status_code == 422                 # no item id
    assert online.post(f"/review/{iid}/undo", json={"item_id": iid + 1, "event_id": 1}).status_code == 422  # mismatch
    assert online.patch(f"/review/{iid}", data={"action": "reset", "reviewer": TEST_REVIEWER}).status_code == 422   # old bulk-able reset is gone
    r1 = online.patch(f"/review/{iid}", data={"action": "approve", "reviewer": TEST_REVIEWER}).json()
    r2 = online.patch(f"/review/{iid}", data={"action": "reject", "reviewer": TEST_REVIEWER}).json()
    try:
        assert _undo(online, iid, r1["event_id"]).status_code == 409                   # not the latest decision
        assert online.post(f"/review/{iid}/undo", json={"item_id": iid, "event_id": 10**12}).status_code == 422
    finally:
        assert _undo(online, iid, r2["event_id"]).json()["status"] == "approved"
        assert _undo(online, iid, r1["event_id"]).json()["status"] == "pending"


def test_history_is_append_only(online):
    with online.app.state.data.pool.connection() as c:
        n = c.execute("select count(*) from review_events").fetchone()[0]
        if n:
            with pytest.raises(Exception):
                c.execute("update review_events set note = 'x' where id = (select min(id) from review_events)")
            c.rollback()


def test_review_write_offline_is_read_only(offline):
    r = offline.patch("/review/1", data={"action": "approve", "reviewer": TEST_REVIEWER})
    assert r.status_code == 503


# ------------------------------------------------------------------ 14. singular / plural
def test_singular_plural_wording(offline):
    assert queryparse.plural(1, "floor") == "1 floor" and queryparse.plural(2, "floor") == "2 floors"
    assert queryparse.plural("one", "floor") == "one floor"
    assert views.compose_query({"intent": "buildings", "floors_op": "==", "floors_n": 1}) == "show buildings with exactly 1 visible floor"
    assert queryparse.meaning({"intent": "buildings", "floors_op": ">", "floors_n": 1}) == ["buildings", "more than 1 floor"]
    r = q(offline, "buildings with 1 floor")
    assert r["parsed_filters"] == {"intent": "buildings", "floors_op": "==", "floors_n": 1}
    assert {"from": "with 1 floor", "to": "with exactly 1 floor"} in r["understanding"]["synonyms"]
    # a 1-floor chip edit reads back exactly (canonical singular text is still understood by QueryEngine)
    rf = offline.post("/query", json={"area": "ward29", "filters": {"intent": "buildings", "floors_op": ">", "floors_n": 1}})
    assert rf.status_code == 200 and rf.json()["parsed_filters"]["floors_n"] == 1


# ------------------------------------------------------------------ 10. trim the picked street before starting
def _sathy_click():
    b = JsonStore(Settings().areas_dir).bundle("ward29")
    g = next(s for s in b["streets"] if s["name"] == "Sathy Main Road")["geometry"]
    line = max(g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]], key=len)
    lon, lat = line[len(line) // 2]
    return lat, lon


def test_plan_estimate_needs_the_server_key(offline):
    """P7.2: the estimate is the real camera plan; without a Google server key it says so (never a length formula)"""
    lat, lon = _sathy_click()
    r = offline.post("/jobs/plan-estimate", json={"lat": lat, "lon": lon})
    assert r.status_code == 200 and r.json()["status"] == "failed" and "server key" in r.json()["error"]
    assert offline.get(f"/jobs/plan-estimate/{r.json()['key']}").json()["status"] == "failed"
    assert offline.post("/jobs/estimate", json={"length_m": 1000}).status_code in (404, 405)


def test_trimmed_job_uses_only_the_stretch(online):
    lat, lon = _sathy_click()
    p = online.post("/jobs/preview", json={"lat": lat, "lon": lon}).json()
    main = max(p["lines"]["coordinates"], key=len)
    a, b = len(main) // 4, max(len(main) // 4 + 2, 3 * len(main) // 4)
    stretch = {"type": "LineString", "coordinates": main[a:b + 1]}
    bad = {"type": "LineString", "coordinates": [[lon + 0.01, lat + 0.01], [lon + 0.011, lat + 0.011]]}
    assert online.post("/jobs", json={"lat": lat, "lon": lon, "lines": bad}).status_code == 422      # off the street
    # a test job: never blocked by (or blocking) a real analysis that is running
    r = online.post("/jobs", json={"lat": lat, "lon": lon, "lines": stretch, "test": True})
    assert r.status_code == 201, r.text
    job = r.json()["job"]
    try:
        inp = job["input"]
        assert inp["trimmed"] is True and inp["full_length_m"] == p["length_m"]
        assert 20 <= inp["length_m"] < p["length_m"]
        from shapely.geometry import shape
        assert shape(inp["polygon"]).area < shape(p["polygon"]).area
    finally:
        with online.app.state.data.pool.connection() as c:
            c.execute("delete from jobs where id = %s", (job["id"],))


# ------------------------------------------------------------------ D27: predicted building positions are served
def test_predicted_positions_served_and_match_model_card(offline):
    import json as _json
    mc = _json.load(open(os.path.join(ROOT, "data", "model_card.json"), encoding="utf-8"))["gate1_position"]
    for slug in AREAS:
        rows = offline.get(f"/areas/{slug}/buildings?page_size=500").json()["rows"]
        counts = {}
        for b in rows:
            p = b["predicted_position"]
            assert set(p) == {"lat", "lon", "method", "n_cameras", "uncertainty_m", "reason"}
            assert p["reason"] is None or (p["reason"].startswith("triangulation rejected: implausible (")
                                           and p["method"] != "triangulated")
            assert p["method"] in ("triangulated", "wall_hit", "wall_centre", "footprint_centre")        # D33: wall_centre
            if p["method"] != "triangulated":
                assert p["uncertainty_m"] is None
            else:
                assert p["n_cameras"] >= 2
                if p["n_cameras"] == 2:
                    assert p["uncertainty_m"] is None                  # D28: 2 cameras -> not estimated
            counts[p["method"]] = counts.get(p["method"], 0) + 1
        want = {k: v for k, v in mc["method_counts"][slug].items() if k not in ("buildings", "triangulation_rejected") and v}
        assert sum(bool(b["predicted_position"]["reason"]) for b in rows) == mc["method_counts"][slug]["triangulation_rejected"]
        assert counts == want and len(rows) == mc["method_counts"][slug]["buildings"]
