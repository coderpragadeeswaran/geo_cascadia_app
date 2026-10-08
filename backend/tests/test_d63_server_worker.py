"""D63: the AWS server worker (worker/server_worker.py) runs the Colab cell's code with no questions, no Drive, no tunnel.
Pure tests: no pipeline import (no torch / Paddle), no network, no API."""
import importlib.util
import os
import threading
import time
import types

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture()
def sw(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("server_worker_test", os.path.join(ROOT, "worker", "server_worker.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    (tmp_path / "worker.env").write_text("# test\nWORKER_TOKEN=tok-123\nGOOGLE_MAPS_KEY= 'srv-key' \n", encoding="utf-8")
    (tmp_path / "aws.env").write_text("AWS_ACCESS_KEY_ID=AKIA1\nAWS_SECRET_ACCESS_KEY=sec1\nAWS_SESSION_TOKEN=tok1\n",
                                      encoding="utf-8")
    m.ENV_FILE, m.AWS_FILE = str(tmp_path / "worker.env"), str(tmp_path / "aws.env")
    m.WORK_DIR, m.OCR_PYTHON, m.KEY_POLL_S = str(tmp_path / "jobs"), "/opt/ocr/bin/python", 0.05
    for k in m.AWS_NAMES:
        monkeypatch.delenv(k, raising=False)
    g = m.load_cell()
    m.install(g)
    g["google_key_problem"] = lambda key: None                     # no network in tests
    yield m, g
    for k in m.AWS_NAMES:
        os.environ.pop(k, None)


def test_cell_loads_without_running_and_overrides_apply(sw):
    m, g = sw
    assert callable(g["main"]) and callable(g["run_job"])
    assert g["WORK_DIR"] == m.WORK_DIR and os.path.isdir(m.WORK_DIR)
    assert g["SAVE_TO_DRIVE"] is False and g["OCR_SELF_TEST"] is True and g["OCR_PYTHON"] == "/opt/ocr/bin/python"
    assert g["drive_dir"]({"id": "x"}) is None                     # no Drive on the server
    assert os.environ.get("USE_TF") == "0" and os.environ.get("TRANSFORMERS_NO_TF") == "1"


def test_questions_get_safe_answers(sw):
    m, g = sw
    assert g["ask"]("Sign reading does not work … Start the worker anyway? [y/N]: ") == "y"
    t = time.time()
    assert g["ask"]("The backend is not responding. Paste the new tunnel URL (Enter = keep retrying): ") is None
    assert time.time() - t >= 0.04                                 # waits before the cell retries
    assert g["ask"]("anything else: ", default="d") == "d"


def test_keys_from_files_and_backend_without_questions(sw):
    m, g = sw
    cfg = types.SimpleNamespace(maps_key="")
    g["keys"](cfg)
    assert cfg.maps_key == "srv-key"
    assert (os.environ["AWS_ACCESS_KEY_ID"], os.environ["AWS_SECRET_ACCESS_KEY"], os.environ["AWS_SESSION_TOKEN"]) == \
        ("AKIA1", "sec1", "tok1")
    api = g["Backend"]()
    assert api.url == m.API_URL and api.token == "tok-123"


def test_expired_keys_wait_for_the_refreshed_file(sw, tmp_path):
    m, g = sw
    cfg = types.SimpleNamespace(maps_key="")
    g["keys"](cfg)

    def refresh():
        time.sleep(0.2)
        (tmp_path / "aws.env").write_text("AWS_ACCESS_KEY_ID=AKIA2\nAWS_SECRET_ACCESS_KEY=sec2\nAWS_SESSION_TOKEN=tok2\n",
                                          encoding="utf-8")
    threading.Thread(target=refresh).start()
    g["keys"](cfg, only_aws=True)                                  # returns only after the file changed
    assert os.environ["AWS_ACCESS_KEY_ID"] == "AKIA2" and os.environ["AWS_SESSION_TOKEN"] == "tok2"


def test_each_job_starts_with_the_current_key_file(sw, tmp_path):
    m, _ = sw
    cfg = types.SimpleNamespace(maps_key="")
    seen = []
    g2 = m.load_cell()                                             # the wrapper around a stub cell run_job (no pipeline)
    g2["run_job"] = lambda api, job, base_cfg, run_area, state: seen.append(os.environ["AWS_ACCESS_KEY_ID"])
    m.install(g2)
    g2["google_key_problem"] = lambda key: None
    g2["keys"](cfg)
    g2["run_job"](None, {"id": "j"}, cfg, None, {})
    (tmp_path / "aws.env").write_text("AWS_ACCESS_KEY_ID=AKIA3\nAWS_SECRET_ACCESS_KEY=s3\n", encoding="utf-8")
    g2["run_job"](None, {"id": "j"}, cfg, None, {})
    assert seen == ["AKIA1", "AKIA3"] and "AWS_SESSION_TOKEN" not in os.environ


def test_missing_token_or_google_key_stops(sw, tmp_path):
    m, g = sw
    (tmp_path / "worker.env").write_text("GOOGLE_MAPS_KEY=k\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        g["Backend"]()
    (tmp_path / "worker.env").write_text("WORKER_TOKEN=t\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        g["keys"](types.SimpleNamespace(maps_key=""))


def test_ocr_process_uses_the_configured_python(sw, monkeypatch):
    m, g = sw
    seen = {}

    def fake_popen(args, **kw):
        seen["args"] = args
        raise RuntimeError("stop here")
    monkeypatch.setattr(g["subprocess"], "Popen", fake_popen)
    cfg = types.SimpleNamespace(device="gpu")
    monkeypatch.setattr(g["dataclasses"], "asdict", lambda c: {"device": "gpu"})
    with pytest.raises(RuntimeError):
        g["run_child"]("selftest", cfg)
    assert seen["args"][0] == "/opt/ocr/bin/python"


def test_colab_default_is_unchanged():
    """The cell itself still runs the OCR process with its own Python on Colab (OCR_PYTHON = None)."""
    src = open(os.path.join(ROOT, "worker", "colab_worker.py"), encoding="utf-8").read()
    assert "\nOCR_PYTHON = None " in src and "[OCR_PYTHON or sys.executable, script, spec_p]" in src
    assert src.rstrip().endswith("main()")
