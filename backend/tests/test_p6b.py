"""P6b: the Colab run that failed at the use router (transformers 5.x), Retry, the resume note, pasted inputs (D37).

The worker tests load worker/colab_worker.py without running its main loop, and drive run_job with a fake API and a
fake run_area: no network, no GPU, no model.
"""
import dataclasses
import json
import os
import sys
import types

import numpy as np
import pytest

from app.settings import ROOT

sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from geo_cascadia.localuse import feature_tensor  # noqa: E402


# ------------------------------------------------------------------------------------------ 1. CLIP feature outputs
class FakeTensor:
    """Just enough of a torch tensor: .norm marks it as a tensor, .shape for the size check."""
    def __init__(self, a):
        self.a = np.asarray(a, dtype=float)
        self.shape = self.a.shape

    def norm(self, *a, **k):
        return np.linalg.norm(self.a, axis=-1, keepdims=True)


def test_old_transformers_tensor_is_returned_unchanged():
    t = FakeTensor(np.ones((2, 512)))
    assert feature_tensor(t, "image", 512) is t


def test_new_transformers_output_object_gives_pooler_output():
    t = FakeTensor(np.ones((2, 512)))
    out = types.SimpleNamespace(last_hidden_state=FakeTensor(np.ones((2, 50, 768))), pooler_output=t)   # no .norm
    assert feature_tensor(out, "image", 512) is t
    assert feature_tensor(types.SimpleNamespace(pooler_output=t), "text", 512) is t


def test_full_clip_output_prefers_the_embeds():
    e, p = FakeTensor(np.ones((1, 512))), FakeTensor(np.ones((1, 768)))
    assert feature_tensor(types.SimpleNamespace(image_embeds=e, pooler_output=p), "image", 512) is e
    assert feature_tensor(types.SimpleNamespace(text_embeds=e, pooler_output=p), "text", 512) is e


def test_unprojected_or_missing_features_fail_loudly():
    with pytest.raises(ValueError):
        feature_tensor(types.SimpleNamespace(pooler_output=FakeTensor(np.ones((1, 768)))), "image", 512)
    with pytest.raises(TypeError):
        feature_tensor(types.SimpleNamespace(last_hidden_state=FakeTensor(np.ones((1, 50, 768)))), "image", 512)


def test_same_normalised_embedding_on_both_versions():
    torch = pytest.importorskip("torch")
    f = torch.randn(3, 512)
    old = torch.nn.functional.normalize(feature_tensor(f, "image", 512), dim=-1)
    new = torch.nn.functional.normalize(feature_tensor(types.SimpleNamespace(pooler_output=f), "image", 512), dim=-1)
    assert torch.equal(old, new)


# ------------------------------------------------------------------------------------------ 2. the worker cell
@pytest.fixture
def W(tmp_path, monkeypatch):
    """The worker cell's functions, with its folders in tmp_path (Drive 'mounted' at tmp_path/drive/MyDrive)."""
    src = open(os.path.join(ROOT, "worker", "colab_worker.py"), encoding="utf-8").read()
    assert src.rstrip().endswith("main()")
    g = {"__name__": "colab_worker_test"}
    monkeypatch.chdir(tmp_path)
    for v in ("HOME", "USERPROFILE"):                  # the cell makes ~/gc_jobs at load: keep it inside tmp_path
        monkeypatch.setenv(v, str(tmp_path))
    exec(compile(src.rstrip()[:-len("main()")], "colab_worker.py", "exec"), g)
    (tmp_path / "drive" / "MyDrive").mkdir(parents=True)
    g.update(WORK_DIR=str(tmp_path / "work"), DRIVE_JOBS_DIR=tmp_path.as_posix() + "/drive/MyDrive/gc_worker_jobs")
    os.makedirs(g["WORK_DIR"], exist_ok=True)
    return types.SimpleNamespace(**{k: g[k] for k in ("clean", "run_job", "drive_dir", "prune_drive", "STAGE_FILES")},
                                 g=g, tmp=tmp_path)


@dataclasses.dataclass
class Cfg:
    device: str = "gpu"
    ocr_mode: str = "full"
    places_max_calls: int = 100
    sv_price: float = 0.007


class FakeApi:
    def __init__(self, keep=()):
        self.calls, self.keep = [], list(keep)

    def call(self, path, body=None, **k):
        self.calls.append((path, body))
        return {"keep": self.keep} if path == "/worker/known" else {"job_status": "running"}

    def call_or_ask(self, path, body=None, **k):
        self.calls.append((path, body))
        return {}

    def notes(self):
        return [b.get("note") for p, b in self.calls if p == "/worker/progress"]


def fake_run_area(poly, out, cfg, **k):
    json.dump({"meta": {"run": {"places_calls": 0}}}, open(os.path.join(out, "export.json"), "w"))
    return {"meta": {"run": {"places_calls": 0}}}, None


JOB = {"id": "11111111-2222-3333-4444-555555555555", "input": {"slug": "pytest_p6b", "name": "Test Road"}}


def run(W, resumed_claim, capsys):
    api = FakeApi()
    W.run_job(api, {**JOB, "resumed_claim": resumed_claim}, Cfg(), fake_run_area, {"id": "w", "cancel": False})
    return api.notes(), capsys.readouterr().out


def test_card_says_continuing_when_the_worker_continues_from_drive(W, capsys):
    """The Colab bug: Drive had panos.json + plan.json (stopped before any photo batch was saved); the worker printed
    "continuing from the progress saved on Drive" but the card said "Started again from the beginning"."""
    d = W.drive_dir(JOB)
    os.makedirs(d)
    for f in ("panos.json", "plan.json"):
        json.dump([], open(os.path.join(d, f), "w"))
    notes, out = run(W, True, capsys)
    assert "continuing from the progress saved on Drive" in out
    assert notes[0].startswith("Continuing from the progress saved on Drive") and "beginning" not in notes[0]


def test_card_says_started_again_only_when_nothing_was_saved(W, capsys):
    notes, out = run(W, True, capsys)
    assert notes[0].startswith("Started again from the beginning") and "starting from the beginning" in out


def test_first_attempt_has_no_note(W, capsys):
    notes, out = run(W, False, capsys)
    assert notes[0] is None and "beginning" not in out and "continuing" not in out


def test_pasted_inputs_lose_every_space(W):
    c = W.clean
    assert c("  https://abc-def.trycloudflare.com/ \n") == "https://abc-def.trycloudflare.com/"
    assert c(" AKIA ABCD\tEFGH\n") == "AKIAABCDEFGH"
    assert c('"secret key"') == "secretkey" and c("'tok'") == "tok"
    assert c(None) == "" and c("   ") == ""


def test_ask_keeps_spaces_inside_a_folder_path(W, monkeypatch):
    monkeypatch.setattr("builtins.input", lambda p: "  /content/drive/MyDrive/My pipeline folder \n")
    assert W.g["ask"]("?", compact=False) == "/content/drive/MyDrive/My pipeline folder"
    monkeypatch.setattr("builtins.input", lambda p: " https://x.trycloudflare .com ")
    assert W.g["ask"]("?") == "https://x.trycloudflare.com"


def test_drive_progress_of_finished_jobs_is_pruned_failed_kept(W):
    keep, gone = "aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002"
    for j in (keep, gone):
        os.makedirs(os.path.join(W.g["DRIVE_JOBS_DIR"], j))
    W.prune_drive(FakeApi(keep=[keep]))
    assert os.listdir(W.g["DRIVE_JOBS_DIR"]) == [keep]


def test_drive_is_left_alone_when_the_backend_cannot_answer(W):
    os.makedirs(os.path.join(W.g["DRIVE_JOBS_DIR"], "x"))

    class Down(FakeApi):
        def call(self, *a, **k):
            raise ConnectionError("down")
    W.prune_drive(Down())
    assert os.listdir(W.g["DRIVE_JOBS_DIR"]) == ["x"]


# ------------------------------------------------------------------------------------------ 3. Retry (backend)
POLY = {"type": "Polygon", "coordinates": [[[77.3425, 11.1080], [77.3440, 11.1080], [77.3440, 11.1092], [77.3425, 11.1080]]]}


@pytest.fixture(scope="module")
def WT(online):
    tok = online.app.state.settings.worker_token
    if not tok:
        pytest.skip("WORKER_TOKEN not configured")
    return {"X-Worker-Token": tok}


@pytest.fixture
def jobs(online):
    made = []

    def mk():
        r = online.post("/jobs", json={"polygon": POLY, "name": "pytest p6b job", "test": True})
        assert r.status_code == 201, r.text
        made.append(r.json()["job"]["id"])
        return r.json()["job"]
    yield mk
    with online.app.state.data.pool.connection() as c:
        c.execute("delete from jobs where id = any(%s::uuid[])", (made,))


def claim(online, WT, job_id):
    return online.post("/worker/next", headers=WT, json={"worker_id": "pytest-b", "device": "gpu", "job": job_id}).json()["job"]


def test_retry_requeues_the_same_job_as_a_resumed_claim(online, WT, jobs):
    j = jobs()
    claim(online, WT, j["id"])
    online.post("/worker/progress", headers=WT, json={"job": j["id"], "stage": "vlm", "done": 3, "total": 9})
    f = online.post("/worker/fail", headers=WT, json={"job": j["id"], "code": "FAILED",
                                                      "message": "'BaseModelOutputWithPooling' object has no attribute 'norm'"}).json()["job"]
    assert f["status"] == "failed" and f["retryable"] is True
    r = online.post(f"/jobs/{j['id']}/retry").json()["job"]
    assert (r["id"], r["status"], r["message"], r["finished_at"], r["stage"], r["note"]) == (j["id"], "queued", None, None, None, None)
    assert r["started_at"] == f["started_at"] and r["retryable"] is False
    again = claim(online, WT, j["id"])
    assert again["resumed_claim"] is True                     # the worker is told to look for its saved progress


def test_only_failed_jobs_can_be_retried(online, WT, jobs):
    q = jobs()
    assert online.post(f"/jobs/{q['id']}/retry").status_code == 409                  # queued
    c = jobs()
    online.post(f"/jobs/{c['id']}/cancel")
    assert online.get(f"/jobs/{c['id']}").json()["job"]["retryable"] is False
    assert online.post(f"/jobs/{c['id']}/retry").status_code == 409                  # cancelled
    n = jobs()
    claim(online, WT, n["id"])
    online.post("/worker/fail", headers=WT, json={"job": n["id"], "code": "NO_STREET_VIEW", "message": "none"})
    assert online.post(f"/jobs/{n['id']}/retry").status_code == 409                  # no Street View: retry won't help


def test_worker_known_keeps_unfinished_and_failed_jobs(online, WT, jobs):
    a, b, c = jobs(), jobs(), jobs()
    claim(online, WT, a["id"])
    online.post("/worker/fail", headers=WT, json={"job": a["id"], "code": "FAILED", "message": "boom"})
    online.post(f"/jobs/{b['id']}/cancel")
    gone = "99999999-9999-9999-9999-999999999999"
    keep = online.post("/worker/known", headers=WT, json={"ids": [a["id"], b["id"], c["id"], gone, "not-a-uuid"]}).json()["keep"]
    assert sorted(keep) == sorted([a["id"], c["id"]])
    assert online.post("/worker/known", json={"ids": []}).status_code == 401
