"""P6: the worker protocol and live areas (D34).

Every job made here is a test job (is_test): a real worker never claims those (it asks without a job id), and these tests
claim only their own jobs by id. The uploaded result is a copy of the Tiruppur run under a pytest slug, deleted at the end.
No review decision is written anywhere.
"""
import glob
import json
import os
import shutil
import time

import pytest

from app.settings import ROOT
from conftest import real_claimable

POLY = {"type": "Polygon", "coordinates": [[[77.3425, 11.1080], [77.3440, 11.1080], [77.3440, 11.1092], [77.3425, 11.1080]]]}
BIG = {"type": "Polygon", "coordinates": [[[77.30, 11.10], [77.32, 11.10], [77.32, 11.12], [77.30, 11.12], [77.30, 11.10]]]}
ORIGINALS = ["ward29", "trichy_bharathidasan_salai", "tiruppur_uthukuli_road"]
REPLAY = os.path.join(ROOT, "data", "areas", "tiruppur_uthukuli_road")


@pytest.fixture(scope="module")
def W(online):
    tok = online.app.state.settings.worker_token
    if not tok:
        pytest.skip("WORKER_TOKEN not configured")
    return {"X-Worker-Token": tok}


@pytest.fixture
def jobs(online):
    """Makes test jobs and removes them (and any area they produced) afterwards."""
    made = []

    def mk(name="pytest p6 job"):
        r = online.post("/jobs", json={"polygon": POLY, "name": name, "test": True})
        assert r.status_code == 201, r.text
        made.append(r.json()["job"])
        return r.json()["job"]
    yield mk
    with online.app.state.data.pool.connection() as c:
        slugs = [r[0] for r in c.execute("select a.slug from areas a join jobs j on j.area_id = a.id where j.id = any(%s::uuid[])",
                                         ([j["id"] for j in made],))]
        c.execute("delete from areas where slug = any(%s)", (slugs,))
        c.execute("delete from jobs where id = any(%s::uuid[])", ([j["id"] for j in made],))
    for s in slugs + [j["input"]["slug"] for j in made]:
        if s not in ORIGINALS:
            shutil.rmtree(os.path.join(ROOT, "data", "areas", s), ignore_errors=True)
    online.app.state.data.db.invalidate()


def claim(online, W, job_id, worker="pytest-w1", device="gpu"):
    r = online.post("/worker/next", headers=W, json={"worker_id": worker, "device": device, "job": job_id})
    assert r.status_code == 200, r.text
    return r.json()["job"]


def test_worker_endpoints_need_the_token(online, W):
    for path, body in [("/worker/next", {"worker_id": "x"}), ("/worker/heartbeat", {"worker_id": "x"}),
                       ("/worker/progress", {"job": "00000000-0000-0000-0000-000000000000", "stage": "detect"}),
                       ("/worker/fail", {"job": "00000000-0000-0000-0000-000000000000", "code": "FAILED"})]:
        assert online.post(path, json=body).status_code == 401
        assert online.post(path, json=body, headers={"X-Worker-Token": "wrong"}).status_code == 401
    assert online.post("/worker/result", data={"job": "x"}, files=[("files", ("export.json", b"{}", "application/json"))]).status_code == 401


def test_claim_one_job_and_never_a_test_job_without_its_id(online, W, jobs):
    j = jobs()
    with online.app.state.data.pool.connection() as c:
        free = not real_claimable(c)
    if free:                                # only when no real job could be taken by a claim without id
        r = online.post("/worker/next", headers=W, json={"worker_id": "pytest-w1", "device": "cpu"}).json()["job"]
        assert r is None
    c = claim(online, W, j["id"], device="cpu")
    assert c["id"] == j["id"] and c["status"] == "running" and c["worker_id"] == "pytest-w1" and c["device"] == "cpu"
    assert claim(online, W, j["id"], worker="pytest-w2") is None          # held by a live worker: not claimable


def test_progress_heartbeat_and_worker_status(online, W, jobs):
    j = jobs()
    claim(online, W, j["id"])
    p = online.post("/worker/progress", headers=W, json={"job": j["id"], "stage": "detect", "done": 12, "total": 40,
                                                         "worker_id": "pytest-w1"}).json()["job"]
    assert (p["stage"], p["done"], p["total"], p["status"]) == ("detect", 12, 40, "running")
    h = online.post("/worker/heartbeat", headers=W, json={"worker_id": "pytest-w1", "job": j["id"], "device": "gpu"}).json()
    assert h["job_status"] == "running"
    s = online.get("/worker/status").json()
    assert s["connected"] is True and s["device"] == "gpu" and s["job"]["id"] == j["id"] and s["job"]["stage"] == "detect"
    assert "token" not in json.dumps(s).lower()
    assert online.get("/jobs?active=1").json()["worker"]["connected"] is True


def test_interrupted_job_is_resumed_by_another_worker(online, W, jobs):
    j = jobs()
    claim(online, W, j["id"], worker="pytest-old")
    with online.app.state.data.pool.connection() as c:
        c.execute("update jobs set heartbeat_at = now() - interval '3 minutes' where id = %s", (j["id"],))
    assert online.get(f"/jobs/{j['id']}").json()["job"]["display_status"] == "interrupted"
    r = claim(online, W, j["id"], worker="pytest-new", device="cpu")
    assert r["status"] == "running" and r["display_status"] == "running" and r["worker_id"] == "pytest-new"
    assert r["started_at"] == online.get(f"/jobs/{j['id']}").json()["job"]["started_at"]      # same job, not a new one


def test_aws_expired_pauses_and_the_same_job_resumes(online, W, jobs):
    j = jobs()
    claim(online, W, j["id"])
    f = online.post("/worker/fail", headers=W, json={"job": j["id"], "code": "AWS_TOKEN_EXPIRED",
                                                     "message": "keys expired"}).json()["job"]
    assert f["status"] == "expired_token" and f["finished_at"] is None
    assert any(x["id"] == j["id"] for x in online.get("/jobs?active=1").json()["jobs"])
    assert claim(online, W, j["id"])["status"] == "running"


@pytest.mark.parametrize("code, status", [("NO_STREET_VIEW", "no_street_view"), ("NO_STREETS", "no_street_view"),
                                          ("NO_CAMERAS", "no_street_view"), ("SOMETHING_ELSE", "failed")])
def test_fail_codes(online, W, jobs, code, status):
    j = jobs()
    claim(online, W, j["id"])
    f = online.post("/worker/fail", headers=W, json={"job": j["id"], "code": code, "message": "m"}).json()["job"]
    assert f["status"] == status and f["finished_at"] is not None


def test_cost_cap_pauses_for_approval(online, W, jobs):
    j = jobs()
    claim(online, W, j["id"])
    est = {"photos": 480, "usd": 3.41, "cameras": 60, "buildings": 90, "cap_photos": 300, "cap_usd": 1.0}
    f = online.post("/worker/fail", headers=W, json={"job": j["id"], "code": "NEEDS_APPROVAL", "message": "above the cap",
                                                     "estimate": est}).json()["job"]
    assert f["status"] == "needs_approval" and f["plan_estimate"] == est and f["finished_at"] is None
    assert claim(online, W, j["id"]) is None                              # never runs without a person's approval
    a = online.post(f"/jobs/{j['id']}/approve").json()["job"]
    assert a["status"] == "queued" and a["approved"] is True
    assert online.post(f"/jobs/{j['id']}/approve").status_code == 409
    c = claim(online, W, j["id"])
    assert c["status"] == "running" and c["approved"] is True


def test_cancel_a_job_waiting_for_approval(online, W, jobs):
    j = jobs()
    claim(online, W, j["id"])
    online.post("/worker/fail", headers=W, json={"job": j["id"], "code": "NEEDS_APPROVAL", "estimate": {"photos": 400}})
    assert online.post(f"/jobs/{j['id']}/cancel").json()["job"]["display_status"] == "cancelled"


def test_one_street_at_a_time_and_area_cap(online):
    with online.app.state.data.pool.connection() as c:
        busy = c.execute("select count(*) from jobs where not is_test and status in "
                         "('queued', 'running', 'expired_token', 'needs_approval')").fetchone()[0]
    assert online.post("/jobs", json={"polygon": BIG, "name": "pytest big", "test": True}).status_code == 422   # > 1.5 km²
    if busy:
        pytest.skip("a real analysis is active; the one-at-a-time check would touch it")
    made = []                                       # extras F1: clean up by the exact ids made here, never by name

    def post(body):
        r = online.post("/jobs", json=body)
        if r.status_code == 201:
            made.append(r.json()["job"]["id"])
        return r
    a = post({"polygon": POLY, "name": "pytest real 1"})
    try:
        assert a.status_code == 201
        b = post({"polygon": POLY, "name": "pytest real 2"})
        assert b.status_code == 409 and "one street at a time" in b.json()["detail"].lower()
        assert post({"polygon": POLY, "name": "pytest test", "test": True}).status_code == 201
    finally:
        with online.app.state.data.pool.connection() as c:
            c.execute("delete from jobs where id = any(%s::uuid[])", (made,))


def _upload(online, W, job_id, resumed=True):
    names = [p for p in glob.glob(os.path.join(REPLAY, "*.json"))
             if os.path.basename(p) not in ("run_report.json", "live_run.json", "worker_run.json")]
    files = [("files", (os.path.basename(p), open(p, "rb").read(), "application/json")) for p in names]
    files.append(("files", ("worker_run.json", json.dumps({"attempts": 1, "resumed_from_saved_files": resumed}).encode(),
                            "application/json")))
    return online.post("/worker/result", headers=W, data={"job": job_id, "worker_id": "pytest-w1"}, files=files)


def test_result_is_loaded_as_a_new_area_then_deleted(online, W, jobs):
    j = jobs("pytest p6 replay")
    claim(online, W, j["id"])
    t0 = time.time()
    r = _upload(online, W, j["id"], resumed=False)
    assert r.status_code == 200, r.text
    done = r.json()["job"]
    slug = done["area_slug"]
    assert done["status"] == "done" and slug == j["input"]["slug"] and slug not in ORIGINALS
    folder = os.path.join(ROOT, "data", "areas", slug)
    assert os.path.isfile(os.path.join(folder, "run_report.json")) and os.path.isfile(os.path.join(folder, "live_run.json"))
    # the same rules as the original areas: same counts and review queue as the source run, street names joined
    src = online.get("/areas/tiruppur_uthukuli_road").json()
    new = online.get(f"/areas/{slug}").json()
    assert new["summary"]["buildings"] == src["summary"]["buildings"] and new["summary"]["assets"] == src["summary"]["assets"]
    card = next(a for a in online.get("/areas").json()["areas"] if a["slug"] == slug)
    assert card["live"] is True and card["coverage"] == next(a for a in online.get("/areas").json()["areas"]
                                                             if a["slug"] == "tiruppur_uthukuli_road")["coverage"]
    assert len(online.get(f"/review?area={slug}&page_size=500").json()["rows"]) == \
        len(online.get("/review?area=tiruppur_uthukuli_road&page_size=500").json()["rows"])
    # a fresh run: real timings and cost, no "resumed run" badge
    cost = online.get(f"/areas/{slug}/hood").json()["cost"]
    assert cost["live"] is True and cost["timings"]["badge"] is None and cost["timings"]["representative"] is True
    assert online.get("/areas/tiruppur_uthukuli_road/hood").json()["cost"]["timings"]["badge"]      # originals keep it
    # delete (confirmation = the slug again); the originals can never be deleted
    assert online.delete(f"/areas/{slug}?confirm=wrong").status_code == 422
    d = online.delete(f"/areas/{slug}?confirm={slug}")
    assert d.status_code == 200 and not os.path.isdir(folder)
    assert all(a["slug"] != slug for a in online.get("/areas").json()["areas"])
    assert online.get(f"/jobs/{j['id']}").status_code == 404                  # F8: its job left the list with it
    assert online.get(f"/review?area={slug}&page_size=5").status_code == 404
    assert time.time() - t0 < 120


def test_resumed_live_run_says_so(online, W, jobs):
    j = jobs("pytest p6 resumed")
    claim(online, W, j["id"])
    assert _upload(online, W, j["id"], resumed=True).status_code == 200
    slug = online.get(f"/jobs/{j['id']}").json()["job"]["area_slug"]
    t = online.get(f"/areas/{slug}/hood").json()["cost"]["timings"]
    assert t["representative"] is False and "resumed" in t["badge"]


@pytest.mark.parametrize("slug", ORIGINALS)
def test_original_areas_cannot_be_deleted(online, slug):
    assert online.delete(f"/areas/{slug}?confirm={slug}").status_code == 403
    assert os.path.isfile(os.path.join(ROOT, "data", "areas", slug, "export.json"))


def test_result_needs_a_running_job(online, W, jobs):
    j = jobs()
    r = _upload(online, W, j["id"])
    assert r.status_code == 409                                            # queued, never claimed


# ------------------------------------------------------------------------------------------------ P6 browser round (D35)
def test_stage_number_and_overall_progress_forward_only(online, W, jobs):          # F1 / F2
    j = jobs()
    c = claim(online, W, j["id"])
    assert c["stage_no"] is None and c["stage_count"] == 10 and c["progress"] == 0

    def post(st, d=None, t=None):
        return online.post("/worker/progress", headers=W, json={"job": j["id"], "stage": st, "done": d, "total": t,
                                                                    "worker_id": "pytest-w1"}).json()["job"]
    p = post("plan", 5, 5)
    assert (p["stage_no"], p["stage_count"]) == (3, 10) and p["progress"] == 0.3
    p = post("detect", 20, 40)
    assert (p["stage_no"], p["progress"]) == (4, 0.35)
    p = post("vlm_buildings", 3, 10)                                                    # a sub-step maps onto its stage
    assert (p["stage"], p["stage_no"]) == ("vlm", 7)
    p = post("ocr", 1, 1)                                                                # a late report never goes back
    assert (p["stage"], p["stage_no"], p["progress"]) == ("vlm", 7, 0.63)
    assert online.get("/worker/status").json()["job"]["stage"] == "vlm"


def test_unnamed_roads_get_plain_names(tmp_path):                                    # F4
    from app import jobs as J, streetpick
    assert streetpick.plain_name("Unnamed residential road near Sathy Main Road") == "Unnamed road near Sathy Main Road"
    assert streetpick.plain_name("Unnamed unclassified road") == "Unnamed road"
    assert streetpick.plain_name("Korathottam Road") == "Korathottam Road"
    streets = [{"name": "Main Road", "lines_latlon": [[[11.0, 77.0], [11.001, 77.0]]]},
               {"name": "(unnamed residential #1)", "lines_latlon": [[[11.0, 77.0002], [11.001, 77.0002]]]},
               {"name": "(unnamed residential #2)", "lines_latlon": [[[11.0, 77.0004], [11.001, 77.0004]]]}]
    exp = {"meta": {}, "buildings": [{"id": "w1", "street": "(unnamed residential #1)"}], "assets": [],
           "streetlight_gaps": [{"id": "g", "street": "(unnamed residential #2)"}],
           "dashboard": {"charts": {"by_street": {"(unnamed residential #1)": {"buildings": 1}}}}}
    for n, o in (("streets.json", streets), ("street_names.json", {}), ("export.json", exp)):
        (tmp_path / n).write_text(json.dumps(o), encoding="utf-8")
    J.fill_street_names(str(tmp_path))
    names = json.loads((tmp_path / "street_names.json").read_text(encoding="utf-8"))
    out = json.loads((tmp_path / "export.json").read_text(encoding="utf-8"))
    # P7.1: parallel roads that meet no named road at their ends: plain "Unnamed road", told apart by a number
    assert names == {"(unnamed residential #1)": "Unnamed road", "(unnamed residential #2)": "Unnamed road (2)"}
    assert out["buildings"][0]["street"] == "Unnamed road"
    assert out["streetlight_gaps"][0]["street"] == "Unnamed road (2)"
    assert list(out["dashboard"]["charts"]["by_street"]) == ["Unnamed road"]


def test_clicked_street_keeps_the_picker_name_everywhere(tmp_path):                  # P7.1
    """the pipeline's Google route name for the clicked unnamed road is replaced by the picker's name on every record"""
    from app import jobs as J
    streets = [{"name": "(unnamed residential #7)", "way_ids": [7], "lines_latlon": [[[11.0, 77.0], [11.001, 77.0]]]}]
    exp = {"meta": {}, "buildings": [{"id": "w1", "street": "Kattabomman Street"}], "assets": [],
           "dashboard": {"streets": ["Kattabomman Street"], "charts": {"by_street": {"Kattabomman Street": {"buildings": 1}}}}}
    for n, o in (("streets.json", streets), ("street_names.json", {"(unnamed residential #7)": "Kattabomman Street"}),
                 ("export.json", exp)):
        (tmp_path / n).write_text(json.dumps(o), encoding="utf-8")
    J.fill_street_names(str(tmp_path), {"click": {"lat": 11.0, "lon": 77.0}, "way_ids": [7],
                                        "street": "Unnamed road near Kattabomman Street"})
    names = json.loads((tmp_path / "street_names.json").read_text(encoding="utf-8"))
    out = json.loads((tmp_path / "export.json").read_text(encoding="utf-8"))
    assert names == {"(unnamed residential #7)": "Unnamed road near Kattabomman Street"}
    assert out["buildings"][0]["street"] == "Unnamed road near Kattabomman Street"
    assert out["dashboard"]["streets"] == ["Unnamed road near Kattabomman Street"]
    assert list(out["dashboard"]["charts"]["by_street"]) == ["Unnamed road near Kattabomman Street"]


def test_delete_area_removes_it_everywhere(online, W, jobs):                        # F7 / F8
    j = jobs("pytest p6 delete")
    claim(online, W, j["id"])
    slug = _upload(online, W, j["id"]).json()["job"]["area_slug"]
    assert online.get(f"/review?area={slug}&page_size=5").json()["rows"]
    assert online.delete(f"/areas/{slug}?confirm={slug}").status_code == 200
    assert slug not in [a["slug"] for a in online.get("/areas").json()["areas"]]
    assert online.get(f"/areas/{slug}").status_code == 404
    assert online.get(f"/areas/{slug}/hood").status_code == 404
    assert online.get(f"/review?area={slug}&page_size=5").status_code == 404
    assert all(x["id"] != j["id"] for x in online.get("/jobs").json()["jobs"])
    assert not os.path.isdir(os.path.join(ROOT, "data", "areas", slug))


def test_remove_ended_jobs_from_the_list(online, W, jobs):                          # F8
    a, b, c = jobs(), jobs(), jobs()
    online.post(f"/jobs/{a['id']}/cancel")                                                   # cancelled
    claim(online, W, b["id"])
    online.post("/worker/fail", headers=W, json={"job": b["id"], "code": "NO_STREET_VIEW", "message": "none"})
    assert online.delete(f"/jobs/{a['id']}").json()["removed"] == a["id"]
    assert online.delete(f"/jobs/{b['id']}").status_code == 200
    assert online.delete(f"/jobs/{c['id']}").status_code == 409                             # still queued: cancel first
    assert online.get(f"/jobs/{a['id']}").status_code == 404


def test_clear_test_jobs_removes_test_areas_only(online, W, jobs):                  # F9
    j = jobs("pytest p6 clear")
    claim(online, W, j["id"])
    slug = _upload(online, W, j["id"]).json()["job"]["area_slug"]
    dry = online.post("/jobs/clear-test", json={"dry_run": True}).json()
    assert j["id"] in [x["id"] for x in dry["jobs"]] and slug in [a["slug"] for a in dry["areas"]]
    assert not set(ORIGINALS) & {a["slug"] for a in dry["areas"]}
    real = [a["slug"] for a in online.get("/areas").json()["areas"] if a.get("live") and a["slug"] != slug]
    r = online.post("/jobs/clear-test", json={"dry_run": False, "ids": [j["id"]]}).json()
    assert r["removed"] == [j["id"]]
    slugs = [a["slug"] for a in online.get("/areas").json()["areas"]]
    assert slug not in slugs and set(ORIGINALS) <= set(slugs) and set(real) <= set(slugs)
    assert not os.path.isdir(os.path.join(ROOT, "data", "areas", slug))


def test_fake_worker_jobs_become_test_jobs(online, W, jobs):                        # F9
    j = jobs()
    with online.app.state.data.pool.connection() as c:
        c.execute("update jobs set is_test = false where id = %s", (j["id"],))              # as if clicked in the app
    r = online.post("/worker/next", headers=W, json={"worker_id": "fake-x", "job": j["id"], "test": True}).json()["job"]
    assert r["is_test"] is True


def test_cancel_while_running_is_a_handshake(online, W, jobs):                      # F10
    j = jobs()
    claim(online, W, j["id"])
    c = online.post(f"/jobs/{j['id']}/cancel").json()["job"]
    assert c["status"] == "running" and c["display_status"] == "cancelling"
    hb = online.post("/worker/heartbeat", headers=W, json={"worker_id": "pytest-w1", "job": j["id"]}).json()
    assert hb["job_status"] == "cancelling"                                                  # the worker learns it here
    pr = online.post("/worker/progress", headers=W, json={"job": j["id"], "stage": "detect", "done": 1, "total": 9}).json()
    assert pr["job_status"] == "cancelling"                                                  # or here
    assert claim(online, W, j["id"], worker="pytest-w2") is None                             # never resumed
    assert _upload(online, W, j["id"]).status_code == 409                                    # never loaded
    f = online.post("/worker/fail", headers=W, json={"job": j["id"], "code": "CANCELLED"}).json()["job"]
    assert f["display_status"] == "cancelled" and f["finished_at"]


def test_cancel_with_a_silent_worker_finishes_by_itself(online, W, jobs):           # F10
    j = jobs()
    claim(online, W, j["id"])
    online.post(f"/jobs/{j['id']}/cancel")
    with online.app.state.data.pool.connection() as c:
        c.execute("update jobs set heartbeat_at = now() - interval '3 minutes' where id = %s", (j["id"],))
    online.get("/jobs?active=1")
    assert online.get(f"/jobs/{j['id']}").json()["job"]["display_status"] == "cancelled"
    k = jobs()                                                                               # interrupted, then cancelled:
    claim(online, W, k["id"])
    with online.app.state.data.pool.connection() as c:
        c.execute("update jobs set heartbeat_at = now() - interval '3 minutes' where id = %s", (k["id"],))
    assert online.post(f"/jobs/{k['id']}/cancel").json()["job"]["display_status"] == "cancelled"   # at once


def test_resumed_claim_and_worker_note(online, W, jobs):                            # F11
    j = jobs()
    assert claim(online, W, j["id"])["resumed_claim"] is False
    online.post("/worker/progress", headers=W, json={"job": j["id"], "stage": "detect", "done": 5, "total": 10})
    with online.app.state.data.pool.connection() as c:
        c.execute("update jobs set heartbeat_at = now() - interval '3 minutes' where id = %s", (j["id"],))
    again = claim(online, W, j["id"], worker="pytest-w2")
    assert again["resumed_claim"] is True and again["stage"] is None and again["note"] is None
    note = "Started again from the beginning: this worker had no saved progress for this street."
    p = online.post("/worker/progress", headers=W, json={"job": j["id"], "stage": "panoramas", "note": note}).json()["job"]
    assert p["note"] == note
    assert online.post("/worker/progress", headers=W, json={"job": j["id"], "stage": "area"}).json()["job"]["note"] == note
