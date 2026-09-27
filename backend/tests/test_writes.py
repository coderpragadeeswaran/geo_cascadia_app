"""Writes against the real DB, each restoring what it changed: review round-trip, job queue + worker protocol,
worker result upload (new area appears, then removed)."""
import io
import json
import os
import shutil

import pytest

from app.settings import ROOT, Settings
from conftest import TEST_REVIEWER, real_claimable

TOKEN = Settings().worker_token
POLY = {"type": "Polygon", "coordinates": [[[77.3425, 11.1080], [77.3440, 11.1080], [77.3440, 11.1092],
                                            [77.3425, 11.1092], [77.3425, 11.1080]]]}


def _db(online):
    return online.app.state.data


def test_review_round_trip(online, review_area):
    """Approve a dedicated test item, reload it from the database (cache dropped): still approved, map feature updated."""
    item = online.get(f"/review?area={review_area}&status=pending&page_size=1").json()["rows"][0]
    iid, ref, kind = item["id"], item["ref_id"], item["item_type"]
    ev = None
    try:
        r = online.patch(f"/review/{iid}", data={"action": "appeal", "reviewer": TEST_REVIEWER})
        assert r.status_code == 422                                             # appeal needs a note
        r = online.patch(f"/review/{iid}", data={"action": "approve", "reviewer": TEST_REVIEWER})
        assert r.status_code == 200, r.text
        ev = r.json()["event_id"]
        assert r.json()["status"] == "approved" and r.json()["reviewer"] == TEST_REVIEWER
        online.app.state.data.db.invalidate(review_area)                        # "reload": read back from the database
        assert online.get(f"/review/{iid}").json()["status"] == "approved"
        b = online.get(f"/{kind}s/{review_area}/{ref}").json()[kind]
        assert b["review"]["status"] == "approved"                              # map/record reflect the decision
        feats = online.get(f"/areas/{review_area}/geojson?layers={kind}s").json()["features"]
        assert next(f for f in feats if f["properties"]["id"] == ref)["properties"]["review_status"] == "approved"
    finally:                                                                    # undo OUR decision only (D24)
        if ev is not None:
            assert online.post(f"/review/{iid}/undo", json={"item_id": iid, "event_id": ev, "reviewer": TEST_REVIEWER}).status_code == 200
    assert online.get(f"/review/{iid}").json()["status"] == "pending"


@pytest.fixture
def job(online):
    online.app.state.workers.clear()          # no worker seen yet in this app (other test modules act as workers)
    r = online.post("/jobs", json={"polygon": POLY, "name": "pytest area", "test": True})
    assert r.status_code == 201, r.text
    j = r.json()
    yield j
    slug = j["job"]["input"]["slug"]
    with _db(online).pool.connection() as c:
        c.execute("delete from jobs where id = %s", (j["job"]["id"],))
        c.execute("delete from areas where slug = %s", (slug,))
    shutil.rmtree(os.path.join(ROOT, "data", "areas", slug), ignore_errors=True)
    _db(online).db.invalidate()


def test_job_queue_and_worker_protocol(online, job):
    assert job["job"]["status"] == "queued"
    assert job["worker_online"] is False and job["notice"] == "queued — analysis worker offline"     # honest queued state
    jid = job["job"]["id"]
    assert online.post("/worker/next", json={"worker_id": "w"}).status_code == 401                  # token required
    assert online.post("/worker/next", json={"worker_id": "w"}, headers={"X-Worker-Token": "wrong"}).status_code == 401
    h = {"X-Worker-Token": TOKEN}
    # P6 (D34): a test job is claimed only by its id; a worker asking without one never takes test jobs
    with _db(online).pool.connection() as c:
        free = not real_claimable(c)
    if free:                                                # only when no real job could be taken by a claim without id
        anyjob = online.post("/worker/next", json={"worker_id": "pytest-other"}, headers=h).json()["job"]
        assert anyjob is None or anyjob["id"] != jid
    claimed = online.post("/worker/next", json={"worker_id": "pytest-worker", "job": jid}, headers=h).json()["job"]
    assert claimed["id"] == jid and claimed["status"] == "running"
    assert claimed["input"]["polygon"]["type"] == "Polygon" and claimed["input"]["slug"].startswith("pytest_area_")
    assert online.get("/jobs?active=1").json()["worker_online"] is True
    p = online.post("/worker/progress", json={"job": jid, "stage": "detect", "done": 3, "total": 10}, headers=h).json()["job"]
    assert (p["stage"], p["done"], p["total"]) == ("detect", 3, 10)
    f = online.post("/worker/fail", json={"job": jid, "code": "NO_STREET_VIEW", "message": "no panoramas"}, headers=h).json()["job"]
    assert f["status"] == "no_street_view" and f["message"] == "no panoramas"
    f = online.post("/worker/fail", json={"job": jid, "code": "AWS_TOKEN_EXPIRED", "message": "refresh keys"}, headers=h).json()["job"]
    assert f["status"] == "expired_token"
    again = online.post("/worker/next", json={"worker_id": "pytest-worker", "job": jid}, headers=h).json()["job"]   # keys refreshed → resume
    assert again["id"] == jid and again["status"] == "running"


def test_worker_result_creates_area(online, job):
    jid, slug = job["job"]["id"], job["job"]["input"]["slug"]
    h = {"X-Worker-Token": TOKEN}
    assert online.post("/worker/next", json={"worker_id": "pytest-worker", "job": jid}, headers=h).json()["job"]["id"] == jid
    src = os.path.join(ROOT, "data", "areas", "tiruppur_uthukuli_road")
    names = [n for n in sorted(os.listdir(src)) if n.endswith(".json") and n != "run_report.json"]
    files = [("files", (n, open(os.path.join(src, n), "rb").read(), "application/json")) for n in names]
    bad = online.post("/worker/result", data={"job": jid}, files=[("files", ("../evil.json", b"{}", "application/json"))], headers=h)
    assert bad.status_code == 422
    r = online.post("/worker/result", data={"job": jid}, files=files, headers=h)
    assert r.status_code == 200, r.text
    done = r.json()["job"]
    assert done["status"] == "done" and done["area_slug"] == slug
    assert os.path.isfile(os.path.join(ROOT, "data", "areas", slug, "run_report.json"))
    a = online.get(f"/areas/{slug}").json()
    assert a["summary"]["buildings"] == 1 and a["summary"]["assets"] == 20 and a["run_report"]["story"]
