"""Fake analysis worker: test the whole job flow on the laptop without Colab, GPU, AWS or Google calls.

It claims ONE queued job, sends heartbeats and stage-by-stage progress like the real worker, then uploads the saved run
files of an existing area as the result (a replay). The job becomes a test job and the new area is named "<street> (test)",
so it is never mistaken for a real analysis; "Clear test jobs" on the Jobs page removes both. Cancel it in the app while it
runs: it stops at its next report (a few seconds), like the real worker.

    backend\\.venv\\Scripts\\python worker\\fake_worker.py                      # replay Tiruppur, ~40 s
    backend\\.venv\\Scripts\\python worker\\fake_worker.py --replay ward29 --seconds 90
    backend\\.venv\\Scripts\\python worker\\fake_worker.py --simulate needs-approval     # cost-cap pause
    backend\\.venv\\Scripts\\python worker\\fake_worker.py --simulate expired            # "AWS keys expired"
    backend\\.venv\\Scripts\\python worker\\fake_worker.py --simulate no-street-view
    backend\\.venv\\Scripts\\python worker\\fake_worker.py --simulate die               # stop mid-job → "interrupted"

The worker token is read from backend/.env (WORKER_TOKEN) and never printed. --backend defaults to the local API.
"""
import argparse
import glob
import json
import os
import sys
import threading
import time
import uuid

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGES = ["panoramas", "area", "plan", "detect", "geometry", "ocr", "vlm", "reference", "match", "export"]
WEIGHT = {"detect": 5, "ocr": 3, "vlm": 3, "panoramas": 2}           # rough share of the time per stage


def token():
    t = os.environ.get("WORKER_TOKEN", "").strip()
    env = os.path.join(ROOT, "backend", ".env")
    if not t and os.path.isfile(env):
        for line in open(env, encoding="utf-8-sig"):
            k, _, v = line.partition("=")
            if k.strip() == "WORKER_TOKEN":
                t = v.strip().strip('"').strip("'")
    if not t:
        sys.exit("No WORKER_TOKEN in the environment or backend/.env")
    return t


SV_PRICE, VLM_USD_PER_BUILDING = 0.007, 0.056 / 381           # as in the real cell (model card prices)


def plan_estimate(plan, cap_photos, cap_usd=2.0):
    """colab_worker.plan_estimate: one photo per planned view + one crop per building faced + cloud-model spend."""
    views = sum(len(e["views"]) for e in plan)
    faced = len({v["footprint"] for e in plan for v in e["views"] if v.get("footprint")})
    photos = views + faced
    return {"photos": photos, "usd": round(photos * SV_PRICE + faced * VLM_USD_PER_BUILDING, 2), "cameras": len(plan),
            "buildings": faced, "cap_photos": cap_photos, "cap_usd": cap_usd}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backend", default="http://localhost:8000")
    ap.add_argument("--replay", default="tiruppur_uthukuli_road", help="area folder whose saved files are uploaded")
    ap.add_argument("--seconds", type=float, default=40, help="how long the fake analysis takes")
    ap.add_argument("--device", default="cpu", choices=["cpu", "gpu"])
    ap.add_argument("--simulate", choices=["needs-approval", "expired", "no-street-view", "die"])
    ap.add_argument("--wait", type=float, default=60, help="seconds to wait for a queued job before giving up")
    ap.add_argument("--cap-photos", type=int, default=300, help="cost cap in photos (as MAX_PHOTOS_PER_JOB in the real cell)")
    a = ap.parse_args()
    src = os.path.join(ROOT, "data", "areas", a.replay)
    if not os.path.isfile(os.path.join(src, "export.json")):
        sys.exit(f"no saved run at {src}")
    H = {"X-Worker-Token": token()}
    wid = f"fake-{uuid.uuid4().hex[:6]}"
    c = httpx.Client(base_url=a.backend.rstrip("/"), headers=H, timeout=60)
    post = lambda path, body: c.post(path, json=body).raise_for_status().json()

    job, t0 = None, time.time()
    while job is None and time.time() - t0 < a.wait:
        job = post("/worker/next", {"worker_id": wid, "device": a.device, "test": True})["job"]
        if job is None:
            print("queue empty, waiting…"); time.sleep(3)
    if job is None:
        sys.exit("no queued job (click a street in the app first)")
    street = job["street"] or "New street"
    print(f"claimed: {street} ({job['id'][:8]}…), approved={job.get('approved')}")

    alive = {"on": True, "cancel": False}
    STOP = ("cancelling", "cancelled", "failed")

    def beat():
        while alive["on"]:
            try:
                if post("/worker/heartbeat", {"worker_id": wid, "job": job["id"], "device": a.device}).get("job_status") in STOP:
                    alive["cancel"] = True
            except Exception:
                pass
            time.sleep(5)
    threading.Thread(target=beat, daemon=True).start()

    def fail(code, message, estimate=None):
        alive["on"] = False
        r = post("/worker/fail", {"job": job["id"], "code": code, "message": message, "estimate": estimate, "worker_id": wid})
        print("→", r["job"]["status"])

    total_w = sum(WEIGHT.get(s, 1) for s in STAGES)
    for st in STAGES:
        if st == "panoramas" and a.simulate == "no-street-view":
            return fail("NO_STREET_VIEW", "Google has no outdoor Street View imagery on this selection")
        if st == "plan" and a.simulate == "needs-approval" and not job.get("approved"):
            # the same estimate as the real worker, from the replayed run's own camera plan (the real worker uses the plan
            # of the clicked street); the cap is lowered only if this small replay would not reach it
            est = plan_estimate(json.load(open(os.path.join(src, "plan.json"), encoding="utf-8")), a.cap_photos)
            if est["photos"] <= est["cap_photos"]:
                est["cap_photos"] = max(1, est["photos"] // 2)
                print(f"simulated: cap lowered to {est['cap_photos']} photos so this replay needs approval")
            return fail("NEEDS_APPROVAL", "Estimated cost is above the cap.", est)
        if st == "vlm" and a.simulate == "expired":
            return fail("AWS_TOKEN_EXPIRED", "The cloud-AI keys expired; refresh them in the worker cell.")
        if st == "detect" and a.simulate == "die":
            alive["on"] = False
            print("stopping mid-job without a word: the job shows as interrupted after ~2 minutes"); return
        steps = 5
        for k in range(steps + 1):
            r = post("/worker/progress", {"job": job["id"], "stage": st, "done": k, "total": steps, "worker_id": wid})
            if alive["cancel"] or r.get("job_status") in STOP:
                return fail("CANCELLED", None) or print("cancelled in the app: stopped")
            time.sleep(a.seconds * WEIGHT.get(st, 1) / total_w / (steps + 1))
        print(f"✓ {st}")
    alive["on"] = False
    # the result: the replayed area's files, renamed so it is clearly a test replay
    exp = json.load(open(os.path.join(src, "export.json"), encoding="utf-8"))
    exp["meta"]["area"] = f"{street} (test)"
    names = [p for p in glob.glob(os.path.join(src, "*.json")) if os.path.basename(p) not in ("export.json", "run_report.json", "live_run.json", "worker_run.json")]
    files = [("files", ("export.json", json.dumps(exp).encode(), "application/json")),
             # a replay reuses another run's counters and timings: flagged like a resumed run, so Hood never calls them real
             ("files", ("worker_run.json", json.dumps({"attempts": 1, "resumed_from_saved_files": True,
                                                      "replay_of": a.replay}).encode(), "application/json"))]
    files += [("files", (os.path.basename(p), open(p, "rb").read(), "application/json")) for p in names]
    r = c.post("/worker/result", data={"job": job["id"], "worker_id": wid}, files=files, timeout=300)
    r.raise_for_status()
    print("✓ uploaded →", r.json()["job"]["status"], "·", r.json()["job"]["area_slug"])


if __name__ == "__main__":
    main()
