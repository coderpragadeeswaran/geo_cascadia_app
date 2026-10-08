"""P6c: sign reading (OCR) in its own process, retried once, then CPU quick mode; memory lines; OCR self-test (D38).

The worker cell is loaded without its main loop. A small fake OCR script stands in for Paddle: it can crash a given
number of times, so the retry / fallback path runs for real (real subprocesses) without loading any model.
"""
import ast
import json
import os
import sys
import time
import types

import pytest

from app.settings import ROOT

sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from geo_cascadia.config import Config  # noqa: E402

FAKE_CHILD = r'''
import json, os, sys, time
spec = json.load(open(sys.argv[1]))
cnt = os.path.join(os.path.dirname(sys.argv[1]), "count")
n = int(open(cnt).read()) + 1 if os.path.exists(cnt) else 1
open(cnt, "w").write(str(n))
print("Creating model: PP-OCRv6_medium_det ... Using cached files", flush=True)
print("@@ LOADED", flush=True)
if n <= int(os.environ.get("FAKE_CRASHES", "0")):
    print("something native went wrong", flush=True)
    os._exit(3)
print("@@ PROGRESS 1 2", flush=True)
if os.environ.get("FAKE_SLOW"):
    time.sleep(60)
json.dump([{"file": "a.jpg", "tier": 2, "fp": "w1", "best": "HOTEL", "best_conf": 0.9}],
          open(os.path.join(spec["out_dir"], "ocr.json"), "w"))
json.dump({"names": {"w1": ["HOTEL", 0.9]},
           "stats": {"mode": spec["cfg"]["ocr_mode"], "device": spec["cfg"]["device"],
                     "cuda_visible": os.environ.get("CUDA_VISIBLE_DEVICES")}}, open(spec["result"], "w"))
print("@@ DONE", flush=True)
'''


@pytest.fixture
def W(tmp_path, monkeypatch):
    src = open(os.path.join(ROOT, "worker", "colab_worker.py"), encoding="utf-8").read()
    for v in ("HOME", "USERPROFILE"):
        monkeypatch.setenv(v, str(tmp_path))
    monkeypatch.delenv("FAKE_CRASHES", raising=False)
    g = {"__name__": "colab_worker_test"}
    exec(compile(src.rstrip()[:-len("main()")], "colab_worker.py", "exec"), g)
    g["WORK_DIR"] = str(tmp_path / "work")
    os.makedirs(g["WORK_DIR"])
    script = tmp_path / "fake_ocr.py"
    script.write_text(FAKE_CHILD, encoding="utf-8")
    out = tmp_path / "out"
    out.mkdir()
    return types.SimpleNamespace(g=g, script=str(script), out=str(out), tmp=tmp_path)


def gpu_cfg():
    return Config(maps_key="SECRET-MAPS-KEY", device="gpu", ocr_mode="full")


def run(W, cfg, progress=None):
    told, log, seen = [], [], []
    runner = W.g["ocr_runner_for"](told.append, log, script=W.script)
    res = runner([{"cls": "signboard"}], cfg, W.out, progress or (lambda *a: seen.append(a)))
    return res, told, log, seen


def test_ocr_runs_in_its_own_process(W):
    (res, names, stats), told, log, seen = run(W, gpu_cfg())
    assert res[0]["best"] == "HOTEL" and names == {"w1": ("HOTEL", 0.9)}          # tuples, as run_ocr returns
    assert (stats["device"], stats["mode"]) == ("gpu", "full") and told == [] and seen == [("ocr", 1, 2)]
    assert [x["ok"] for x in log] == [True]


def test_a_crash_is_retried_once(W, monkeypatch, capsys):
    monkeypatch.setenv("FAKE_CRASHES", "1")
    (res, names, stats), told, log, _ = run(W, gpu_cfg())
    assert stats["device"] == "gpu" and [x["ok"] for x in log] == [False, True]
    assert len(told) == 1 and "trying once more" in told[0]
    out = capsys.readouterr().out
    assert "✗ Sign reading crashed" in out and "exit code 3: something native went wrong" in out
    assert "  │ Creating model" in out and "[mem] after the OCR crash" in out           # the cause is on screen


def test_two_crashes_on_the_gpu_fall_back_to_cpu_quick_mode(W, monkeypatch):
    monkeypatch.setenv("FAKE_CRASHES", "2")
    (res, names, stats), told, log, _ = run(W, gpu_cfg())
    assert (stats["device"], stats["mode"], stats["cuda_visible"]) == ("cpu", "fast", "")      # never touches the GPU
    assert [(x["device"], x["ok"]) for x in log] == [("gpu", False), ("gpu", False), ("cpu", True)]
    assert "continues on the CPU in quick mode" in told[-1] and "3 signs per building" in told[-1]


def test_three_crashes_fail_the_job_with_a_retry_hint(W, monkeypatch):
    monkeypatch.setenv("FAKE_CRASHES", "3")
    with pytest.raises(RuntimeError, match="crashed 3 times.*Retry"):
        run(W, gpu_cfg())


def test_a_cpu_worker_retries_once_with_no_further_fallback(W, monkeypatch):
    monkeypatch.setenv("FAKE_CRASHES", "2")
    with pytest.raises(RuntimeError, match="crashed 2 times"):
        run(W, Config(device="cpu", ocr_mode="fast"))


def test_no_secret_is_written_for_the_ocr_process(W):
    run(W, gpu_cfg())
    spec = open(os.path.join(W.g["WORK_DIR"], "_ocr", "run_spec.json"), encoding="utf-8").read()
    assert "SECRET-MAPS-KEY" not in spec and "maps_key" not in json.loads(spec)["cfg"]


def test_a_cancel_kills_the_ocr_process(W, monkeypatch):
    monkeypatch.setenv("FAKE_SLOW", "1")

    class Cancelled(Exception):
        pass

    def progress(*a):
        raise Cancelled()
    t = time.time()
    with pytest.raises(Cancelled):
        run(W, gpu_cfg(), progress)
    assert time.time() - t < 30                                                      # not the child's 60 s


def test_crash_reasons_are_plain(W):
    why = W.g["crash_reason"]
    assert "out of memory" in why(-9, []) and "out of memory" in why(137, [])
    assert "segmentation fault" in why(-11, []) and why(1, ["", "ValueError: x", ""]) == "exit code 1: ValueError: x"


def test_memory_line_never_fails(W):
    assert W.g["mem_line"]().startswith("RAM ")


def test_self_test_falls_back_then_asks_before_starting(W, monkeypatch, capsys):
    W.g["OCR_SELF_TEST"] = True
    calls = []

    def fake(mode, cfg, extra=None, progress=None, script=None, label=""):
        calls.append((mode, cfg.device, cfg.ocr_mode))
        return (cfg.device == "cpu", {"text": "HOTEL", "seconds": 3.2, "mode": "fast"}, None if cfg.device == "cpu" else
                "the system killed it, which usually means it ran out of memory (RAM)")
    W.g["run_child"] = fake
    W.g["ocr_self_test"](gpu_cfg())
    assert calls == [("selftest", "gpu", "full"), ("selftest", "cpu", "fast")]
    out = capsys.readouterr().out
    assert "✗ OCR self-test (GPU, full mode) failed" in out and "✓ OCR self-test (CPU, fast mode): OK" in out
    W.g["run_child"] = lambda *a, **k: (False, None, "exit code 1")
    monkeypatch.setattr("builtins.input", lambda p: "n")
    with pytest.raises(SystemExit):
        W.g["ocr_self_test"](gpu_cfg())
    W.g["OCR_SELF_TEST"] = False
    W.g["run_child"] = lambda *a, **k: pytest.fail("self-test ran although it is off")
    W.g["ocr_self_test"](gpu_cfg())


def test_pipeline_hook_keeps_run_ocr_as_the_default():
    src = open(os.path.join(ROOT, "pipeline", "geo_cascadia", "run_area.py"), encoding="utf-8").read()
    fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "run_area")
    names = [a.arg for a in fn.args.args]
    d = fn.args.defaults[names.index("ocr_runner") - (len(names) - len(fn.args.defaults))]      # D64 added a later parameter
    assert "ocr_runner" in names and isinstance(d, ast.Constant) and d.value is None
    assert "(ocr_runner or run_ocr)(dets, cfg, out_dir, progress)" in src


def test_worker_refuses_a_package_without_the_hook(W):
    def old(polygon, out_dir, cfg=None, on_stage=None, plan_check=None):
        pass
    with pytest.raises(SystemExit):
        W.g["check_pipeline"](old)


def test_worker_needs_the_p7a_package(W):
    """P7a: a package without the D42-D45 modules (register, signlink, poleunc) is refused; the repo's package is accepted"""
    def new(polygon, out_dir, cfg=None, on_stage=None, plan_check=None, ocr_runner=None):
        pass
    new.__module__ = "geo_cascadia.run_area"
    assert W.g["check_pipeline"](new) is None
    stale = lambda polygon, out_dir, cfg=None, on_stage=None, plan_check=None, ocr_runner=None: None
    stale.__module__ = "old_pkg_without_p7a.run_area"
    with pytest.raises(SystemExit):
        W.g["check_pipeline"](stale)


def test_the_ocr_process_rebuilds_the_same_config(W):
    """The real OCR process does Config(**spec["cfg"]): every setting survives the JSON trip except the key (left out
    on purpose) and the class ids (default, unused by OCR)."""
    import dataclasses
    cfg = Config(maps_key="SECRET-MAPS-KEY", device="gpu", ocr_mode="full", ocr_min_conf=0.6).resolve()
    ok, _, why = W.g["run_child"]("run", cfg, {"dets": "none.json", "out_dir": W.out})
    assert not ok and why.startswith("exit code 1")                  # no OCR libraries here: it fails, the worker lives
    spec = json.load(open(os.path.join(W.g["WORK_DIR"], "_ocr", "run_spec.json"), encoding="utf-8"))
    src = open(os.path.join(W.g["WORK_DIR"], "_ocr", "ocr_child.py"), encoding="utf-8").read()
    lines = src.splitlines()
    a = lines.index("base = Config()")
    rebuild = "\n".join(lines[a:a + 3])                              # base, tup, cfg = Config(...)
    assert lines[a + 2].startswith("cfg = Config(")
    ns = {"Config": Config, "spec": spec}
    exec(rebuild, ns)                                                # the child's own lines, run here
    back = ns["cfg"]
    assert dataclasses.replace(back, maps_key=cfg.maps_key) == cfg
