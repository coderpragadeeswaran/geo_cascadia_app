# GEO-CASCADIA analysis worker — ONE cell. Paste it after the setup cells (S0 install package, S1a deps, S1b keys),
# or run it on its own (Kaggle, laptop): it then loads the pipeline from the path / shared Drive link you give it.
#
# It asks at start for: the backend URL (the Cloudflare quick-tunnel URL), the worker token, AWS keys and the Google
# server key. Nothing secret is printed or written to disk. Stop it with the stop button (or Ctrl+C); a job it was
# running shows as "interrupted" in the app after ~2 minutes and the next worker session resumes it.
# Steps: worker/README.md.

# ----------------------------------------------------------------------------------------------- settings you may edit
MAX_PHOTOS_PER_JOB = 300        # cost cap: pause for approval if the plan needs more Street View photos than this …
MAX_USD_PER_JOB = 1.00          # … or costs more than this (estimate; photos x price + cloud-AI calls)
PLACES_PER_DAY = 300            # daily cap on Google Places look-ups (the "also on Google" check), all jobs together
HEARTBEAT_S = 15                # the app shows "disconnected" after ~45 s without a heartbeat
IDLE_POLL_S = 10                # how often to ask for work when the queue is empty
WORK_DIR = None                 # where job files are kept (None: /content/gc_jobs on Colab, ~/gc_jobs elsewhere)
CPU_OCR_MODE = "fast"           # on a CPU, sign reading uses the fast mode (a few crops per building); "full" = all crops
SAVE_TO_DRIVE = True            # with Drive mounted, each street's progress is saved there after every stage, so a restarted
DRIVE_JOBS_DIR = "/content/drive/MyDrive/gc_worker_jobs"   # worker on the same account continues (no photo bought twice)

import _thread, dataclasses, getpass, glob, inspect, json, os, platform, shutil, socket, sys, threading, time, traceback, uuid

try:
    import requests
except ImportError:                                           # tiny dependency, present on Colab / Kaggle
    os.system(f"{sys.executable} -m pip -q install requests"); import requests

ON_COLAB = "google.colab" in sys.modules or os.path.isdir("/content")
WORK_DIR = WORK_DIR or ("/content/gc_jobs" if ON_COLAB else os.path.join(os.path.expanduser("~"), "gc_jobs"))
os.makedirs(WORK_DIR, exist_ok=True)
STAGES = ["panoramas", "area", "plan", "detect", "geometry", "ocr", "vlm", "reference", "match", "export"]
SUB = {"detect": "detect", "ocr": "ocr", "vlm_names": "vlm", "building_crops": "vlm", "vlm_buildings": "vlm", "places": "reference"}
# Ward 29 reference (model card): cloud-AI spend per building with the local router, used only for the ESTIMATE
VLM_USD_PER_BUILDING = 0.056 / 381
# transformers versions this worker was checked with (the S1a pin). Others usually work (the pipeline handles both the
# 4.x tensor and the 5.x output object from CLIP), but the worker says so.
TESTED_TRANSFORMERS = ("4.57.6",)


def clean(v):
    """A pasted URL, token or key: no spaces, tabs or line breaks anywhere, and no surrounding quotes."""
    return "".join((v or "").split()).strip("'\"")


def ask(prompt, secret=False, default=None, compact=True):
    """compact: remove every space (URLs, tokens, keys). Folder paths keep inner spaces (compact=False)."""
    v = getpass.getpass(prompt) if secret else input(prompt)
    v = clean(v) if compact else v.strip().strip("'\"").strip()
    return v or default


# ----------------------------------------------------------------------------------------------- 1. the pipeline
def _has(mod):
    import importlib.util
    return importlib.util.find_spec(mod) is not None


def _gpu():
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False


def install_deps():
    """Kaggle / laptop (no setup cells): install what the pipeline imports, once. Colab after S1a has them already."""
    missing = [pkg for pkg, mod in (("ultralytics", "ultralytics"), ("paddleocr", "paddleocr"), ("transformers", "transformers"),
                                    ("boto3", "boto3"), ("shapely", "shapely"), ("scikit-learn", "sklearn"),
                                    ("joblib", "joblib")) if not _has(mod)]
    if not _has("paddle"):
        missing.append("paddlepaddle-gpu" if _gpu() else "paddlepaddle")
    if missing and (ask(f"Missing packages: {', '.join(missing)}. Install them now? [Y/n]: ") or "y").lower().startswith("y"):
        os.system(f"{sys.executable} -m pip -q install " + " ".join(missing))


def check_transformers():
    """Print the transformers version at start; warn when it is not the tested one."""
    try:
        import transformers
    except ImportError:
        print("transformers is not installed: building use goes to the cloud model (no local router).")
        return
    v = transformers.__version__
    if v in TESTED_TRANSFORMERS:
        print(f"transformers {v} (tested).")
    else:
        print(f"⚠ transformers {v} is not a tested version (tested: {', '.join(TESTED_TRANSFORMERS)}). It should work, "
              f"but to be safe put  !pip install -q \"transformers=={TESTED_TRANSFORMERS[-1]}\"  in S1a, restart the "
              "runtime and re-run the setup cells.")


def check_pipeline(run_area):
    """This worker needs the P6 version of the package (live progress + cost cap). An older copy on Drive lacks them."""
    params = inspect.signature(run_area).parameters
    if "plan_check" not in params or "on_stage" not in params:
        raise SystemExit("The pipeline package is older than this worker. Copy pipeline/geo_cascadia from the repo to your "
                         "Drive folder (worker/README.md, 'Shared Drive folder'), re-run the setup cells, then this cell.")


def load_pipeline():
    """Use the setup cells' cfg / run_area when present; otherwise load the package + weights from a folder or a
    shared Google Drive folder link, so a fresh account needs no code change."""
    g = globals()
    have = "run_area" in g and "cfg" in g
    src = ask("Pipeline + weights: folder path or shared Drive folder link "
              f"[Enter = {'use the setup cells' if have else 'required'}]: ", compact=False)
    if src and src.lower().startswith("http"):
        src = clean(src)
    if not src and have:
        check_pipeline(g["run_area"])
        return g["cfg"], g["run_area"]
    if not src:
        raise SystemExit("Give the folder path or the shared Drive link of the pipeline folder (worker/README.md).")
    if src.startswith("http"):
        try:
            import gdown
        except ImportError:
            os.system(f"{sys.executable} -m pip -q install gdown"); import gdown
        dest = os.path.join(os.path.dirname(WORK_DIR), "gc_assets")
        if not os.path.isfile(os.path.join(dest, "geo_cascadia", "__init__.py")):
            print("Downloading the pipeline folder from Drive (once per session)…")
            gdown.download_folder(url=src, output=dest, quiet=True, use_cookies=False)
        src = dest
    if not os.path.isfile(os.path.join(src, "geo_cascadia", "__init__.py")):
        raise SystemExit("That folder has no geo_cascadia/ package in it (worker/README.md lists the layout).")
    sys.path.insert(0, src)
    install_deps()
    from geo_cascadia.config import Config
    from geo_cascadia.run_area import run_area as ra
    check_pipeline(ra)
    c = Config(data_dir=src)
    router = os.path.join(src, "models", "use_router.joblib")
    if os.path.isfile(router):
        c.use_router_path = router
    else:
        print("No models/use_router.joblib in that folder: building use goes to the cloud model for every building.")
    return c, ra


def keys(cfg, only_aws=False):
    """AWS (cloud AI) and Google (Street View + Places) keys, asked without echo; kept in memory / env only. Keys from the
    setup cells are cleaned too (a space pasted into S1b breaks signing just the same)."""
    os.environ["AWS_ACCESS_KEY_ID"] = ask("AWS access key id: ", secret=True) or os.environ.get("AWS_ACCESS_KEY_ID", "")
    os.environ["AWS_SECRET_ACCESS_KEY"] = ask("AWS secret access key: ", secret=True) or os.environ.get("AWS_SECRET_ACCESS_KEY", "")
    tok = ask("AWS session token (Enter if none): ", secret=True)
    if tok:
        os.environ["AWS_SESSION_TOKEN"] = tok
    if not only_aws:
        g = ask("Google server key (Street View + Places) [Enter = keep the one from the setup cells]: ", secret=True)
        if g:
            cfg.maps_key = g
    for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        if os.environ.get(k):
            os.environ[k] = clean(os.environ[k])
    cfg.maps_key = clean(cfg.maps_key)
    if not cfg.maps_key:
        raise SystemExit("A Google server key is needed for Street View.")


# ----------------------------------------------------------------------------------------------- 2. the backend
class Backend:
    """Talks to the app's API through the tunnel. If the tunnel URL changed, the main loop asks for the new one."""
    def __init__(self):
        self.url = (ask("Backend URL (the https://…trycloudflare.com address): ") or "").rstrip("/")
        self.token = ask("Worker token: ", secret=True)
        self.lock = threading.Lock()

    def call(self, path, body=None, files=None, data=None, timeout=30):
        h = {"X-Worker-Token": self.token}
        if files is not None:
            r = requests.post(self.url + path, headers=h, files=files, data=data, timeout=600)
        else:
            r = requests.post(self.url + path, headers=h, json=body or {}, timeout=timeout)
        if r.status_code == 401:
            raise SystemExit("The backend refused the worker token. Check WORKER_TOKEN in backend/.env and re-run the cell.")
        r.raise_for_status()
        return r.json()

    def call_or_ask(self, *a, **k):
        """Main-thread calls: on connection trouble, offer to re-enter the tunnel URL (it changes on every restart)."""
        fails = 0
        while True:
            try:
                return self.call(*a, **k)
            except SystemExit:
                raise
            except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as e:
                fails += 1
                code = getattr(getattr(e, "response", None), "status_code", None)
                if code and code < 500 and code != 404:
                    raise
                if fails < 3:
                    time.sleep(3 * fails); continue
                new = ask("The backend is not responding. Paste the new tunnel URL (Enter = keep retrying): ")
                if new:
                    self.url = new.rstrip("/")
                fails = 0


# ----------------------------------------------------------------------------------------------- 3. one job
class NeedsApproval(Exception):
    def __init__(self, estimate):
        super().__init__("needs approval")
        self.estimate = estimate


def places_left():
    path = os.path.join(WORK_DIR, f"places_{time.strftime('%Y-%m-%d')}.json")
    used = json.load(open(path))["used"] if os.path.exists(path) else 0
    return path, used, max(0, PLACES_PER_DAY - used)


class Cancelled(Exception):
    """A person cancelled the job in the app: stop, report, delete its files."""


def drive_dir(job):
    """The job's saved-progress folder on Google Drive (same account only), or None when Drive is not mounted."""
    if not SAVE_TO_DRIVE or not os.path.isdir(DRIVE_JOBS_DIR.rsplit("/", 1)[0]):
        return None
    return os.path.join(DRIVE_JOBS_DIR, job["id"])


def sync(src, dst):
    """Copy new or changed files from src to dst (the run's JSON files and its photo crops). Cheap when little changed."""
    if not src or not dst or not os.path.isdir(src):
        return
    for root, _, files in os.walk(src):
        rel = os.path.relpath(root, src)
        tgt = os.path.join(dst, rel) if rel != "." else dst
        os.makedirs(tgt, exist_ok=True)
        for f in files:
            a, b = os.path.join(root, f), os.path.join(tgt, f)
            try:
                sa = os.stat(a)
                if os.path.exists(b):
                    sb = os.stat(b)
                    if sb.st_size == sa.st_size and sb.st_mtime >= sa.st_mtime:
                        continue
                shutil.copy2(a, b)
            except OSError:
                pass                                               # a file being written: the next sync takes it


# files run_area saves as it goes and reuses on a resumed run (earliest first)
STAGE_FILES = ("panos.json", "plan.json", "buildings.json", "_views_done.json", "detections.json")


def forget(job, out):
    """The job finished or was cancelled: delete its saved progress (Drive) and its local files, photo crops included."""
    for d in (drive_dir(job), out):
        if d and os.path.isdir(d):
            shutil.rmtree(d, ignore_errors=True)


def run_job(api, job, base_cfg, run_area, state):
    inp = job["input"]
    slug = inp.get("slug") or job["id"][:8]
    out = os.path.join(WORK_DIR, slug)
    os.makedirs(out, exist_ok=True)
    state["out"] = out
    saved = drive_dir(job)
    # continue from the progress saved on Drive by an earlier session of this Google account (no photo bought twice)
    from_drive = bool(saved and any(os.path.isfile(os.path.join(saved, f)) for f in STAGE_FILES))
    if from_drive:
        sync(saved, out)
    # ONE answer to "does this attempt continue?", for the printed line AND the job card's note: a stage file run_area
    # resumes from is present
    continuing = any(os.path.isfile(os.path.join(out, f)) for f in STAGE_FILES)
    cfg = dataclasses.replace(base_cfg)
    if cfg.device == "cpu":
        cfg.ocr_mode = CPU_OCR_MODE
    note_p = os.path.join(out, "worker_run.json")
    note = json.load(open(note_p)) if os.path.exists(note_p) else {"attempts": 0}
    note["attempts"] += 1
    # photos fetched by an earlier attempt (keys expired, cell stopped): the pipeline resumes from its saved files, so this
    # run's timings and photo count cover only the rest, and the app says so. A pause for cost approval happens before
    # any photo is fetched, so it does not count.
    note["resumed_from_saved_files"] = bool(note.get("resumed_from_saved_files")
                                            or os.path.exists(os.path.join(out, "_views_done.json"))
                                            or os.path.exists(os.path.join(out, "detections.json")))
    note["ocr_mode"] = cfg.ocr_mode
    json.dump(note, open(note_p, "w"))
    # a note for the job card when this is not the first attempt
    people_note = None
    if continuing:
        people_note = ("Continuing from the progress saved on Drive" if from_drive else "Continuing from the saved progress"
                       ) + ": stages already finished are not repeated and photos already fetched are not bought again."
    elif job.get("resumed_claim"):
        people_note = ("Started again from the beginning: this worker has no saved progress for this street "
                       "(a different Google account, or Drive not connected).")
    ppath, pused, pleft = places_left()
    cfg.places_max_calls = min(cfg.places_max_calls, pleft)
    price = cfg.sv_price
    last = {"t": 0.0, "stage": None, "sync": time.time()}

    def check():
        if state.get("cancel"):
            raise Cancelled()

    def post(stage, done=None, total=None, force=False):
        check()
        state["stage"] = stage
        now = time.time()
        if saved and now - last["sync"] > 60:                     # during long stages: save progress once a minute
            last["sync"] = now; sync(out, saved)
        if not force and stage == last["stage"] and now - last["t"] < 3:
            return
        last.update(t=now, stage=stage)
        try:
            r = api.call("/worker/progress", {"job": job["id"], "stage": stage, "done": done, "total": total,
                                              "worker_id": state["id"], "note": people_note})
            if r.get("job_status") in ("cancelling", "cancelled", "failed"):
                state["cancel"] = True
        except Exception:
            pass                                                   # progress is best effort; the heartbeat keeps the job
        check()

    def progress(name, done, total):
        post(SUB.get(name, name), done, total)

    def on_stage(name, seconds):
        if saved:
            last["sync"] = time.time(); sync(out, saved)          # a finished stage is safe on Drive
        nxt = STAGES[STAGES.index(name) + 1] if name in STAGES and STAGES.index(name) + 1 < len(STAGES) else name
        post(nxt, 0, None, force=True)

    def plan_check(plan):
        est = plan_estimate(plan, price)
        if not job.get("approved") and (est["photos"] > MAX_PHOTOS_PER_JOB or est["usd"] > MAX_USD_PER_JOB):
            raise NeedsApproval(est)
        post("plan", 1, 1, force=True)

    poly = inp.get("polygon")
    name = inp.get("name") or inp.get("street") or "New street"
    print(f"\n▶ {name}: analysing on {cfg.device.upper()}"
          + (f" ({cfg.ocr_mode} sign reading on CPU)" if cfg.device == "cpu" else "")
          + (" - continuing from the progress saved on Drive" if from_drive else
             " - resuming from the files saved by the last attempt" if continuing else
             " - starting from the beginning (no saved progress)" if job.get("resumed_claim") else "")
          + (f"\n  progress is saved to Drive after each stage ({saved})" if saved else ""))
    post("panoramas", 0, None, force=True)
    exp, _ = run_area(poly, out, cfg, area_name=name, way_ids=inp.get("way_ids"), progress=progress,
                      on_stage=on_stage, plan_check=plan_check, resume=True)
    check()
    used = (exp.get("meta", {}).get("run") or {}).get("places_calls") or 0
    json.dump({"used": pused + used}, open(ppath, "w"))
    post("export", 1, 1, force=True)
    names = sorted(glob.glob(os.path.join(out, "*.json"))) + glob.glob(os.path.join(out, "export.geojson"))
    names = [p for p in names if os.path.getsize(p) <= 40 * 1024 * 1024]
    print(f"  uploading {len(names)} result files…")
    files = [("files", (os.path.basename(p), open(p, "rb"), "application/json")) for p in names]
    try:
        api.call_or_ask("/worker/result", files=files, data={"job": job["id"], "worker_id": state["id"]})
    finally:
        for _, (_, fh, _) in files:
            fh.close()
    forget(job, out)
    print(f"✓ {name}: done — it appears in the app's area list.")


def prune_drive(api):
    """Saved progress of jobs that can no longer continue (done, cancelled, removed from the list) is deleted; a failed
    job's progress is kept for Retry. Best effort: on any trouble nothing is deleted."""
    if not SAVE_TO_DRIVE or not os.path.isdir(DRIVE_JOBS_DIR):
        return
    ids = [d for d in os.listdir(DRIVE_JOBS_DIR) if os.path.isdir(os.path.join(DRIVE_JOBS_DIR, d))]
    if not ids:
        return
    try:
        keep = set(api.call("/worker/known", {"ids": ids})["keep"])
    except Exception:
        return
    for d in ids:
        if d not in keep:
            shutil.rmtree(os.path.join(DRIVE_JOBS_DIR, d), ignore_errors=True)
    if keep:
        print(f"Saved progress kept on Drive for {len(keep)} unfinished or failed street(s) (Retry continues from it).")


def plan_estimate(plan, price):
    """The cost cap's estimate, from the REAL camera plan of the clicked street: one photo per planned view, plus one
    building crop per building faced (an upper bound), plus cloud-model spend per building (Ward 29 rate, model card)."""
    views = sum(len(e["views"]) for e in plan)
    faced = len({v["footprint"] for e in plan for v in e["views"] if v.get("footprint")})
    photos = views + faced
    return {"photos": photos, "usd": round(photos * price + faced * VLM_USD_PER_BUILDING, 2), "cameras": len(plan),
            "buildings": faced, "cap_photos": MAX_PHOTOS_PER_JOB, "cap_usd": MAX_USD_PER_JOB}


def classify(err):
    m = str(err)
    for code in ("NO_STREET_VIEW", "NO_STREETS", "NO_CAMERAS"):
        if m.startswith(code):
            return code, m.split(":", 1)[-1].strip()
    if any(k in m for k in ("AWS token expired", "ExpiredToken", "security token included in the request is expired",
                            "security token included in the request is invalid", "UnrecognizedClientException")):
        return "AWS_TOKEN_EXPIRED", "The cloud-AI keys expired; refresh them in the worker cell."
    return "FAILED", (m.splitlines() or ["error"])[0][:300]


# ----------------------------------------------------------------------------------------------- 4. the loop
def main():
    check_transformers()
    cfg, run_area = load_pipeline()
    cfg = cfg.resolve() if hasattr(cfg, "resolve") else cfg
    keys(cfg)
    api = Backend()
    prune_drive(api)
    state = {"id": f"{socket.gethostname()[:20]}-{uuid.uuid4().hex[:6]}", "job": None, "stage": None, "stop": False,
             "cancel": False, "busy": False}
    dev = cfg.device
    print(f"Worker ready on {dev.upper()} ({platform.node() or 'this machine'}).",
          f"CPU: sign reading uses the {CPU_OCR_MODE} mode." if dev == "cpu" else "",
          "Progress is saved to Drive per street." if SAVE_TO_DRIVE and os.path.isdir(DRIVE_JOBS_DIR.rsplit("/", 1)[0])
          else "Drive is not mounted: an interrupted street starts again from the beginning.", "Waiting for a street...")
    resume = None                                                   # after fresh AWS keys: claim that same job again

    def beat():
        while not state["stop"]:
            try:
                r = api.call("/worker/heartbeat", {"worker_id": state["id"], "job": state["job"], "device": dev}, timeout=15)
                if state["job"] and r.get("job_status") in ("cancelling", "cancelled", "failed") and not state["cancel"]:
                    state["cancel"] = True
                    if state["busy"]:
                        _thread.interrupt_main()                   # stop a long step now, not at the next stage
            except Exception:
                pass                                               # the main loop deals with an unreachable backend
            time.sleep(HEARTBEAT_S)
    threading.Thread(target=beat, daemon=True).start()

    def cancelled(job):
        print("■ Cancelled in the app: stopped, and its saved files were deleted.")
        forget(job, state.get("out"))
        try:
            api.call("/worker/fail", {"job": job["id"], "code": "CANCELLED", "worker_id": state["id"]})
        except Exception:
            pass                                                   # the app finishes the cancel by itself after 2 minutes

    try:
        while True:
            r = api.call_or_ask("/worker/next", {"worker_id": state["id"], "device": dev, **({"job": resume} if resume else {})})
            job, resume = r.get("job"), None
            if not job:
                time.sleep(IDLE_POLL_S); continue
            state.update(job=job["id"], cancel=False, out=None, busy=True)
            try:
                run_job(api, job, cfg, run_area, state)
            except Cancelled:
                state["busy"] = False; cancelled(job)
            except KeyboardInterrupt:
                state["busy"] = False
                if not state["cancel"]:
                    raise                                          # the person pressed stop
                cancelled(job)
            except NeedsApproval as na:
                state["busy"] = False
                e = na.estimate
                print(f"⏸ Needs approval: about {e['photos']} photos (~${e['usd']}) is above the cap "
                      f"({MAX_PHOTOS_PER_JOB} photos / ${MAX_USD_PER_JOB}). Approve it in the app to run it.")
                api.call_or_ask("/worker/fail", {"job": job["id"], "code": "NEEDS_APPROVAL", "worker_id": state["id"],
                                                 "message": "Estimated cost is above the cap.", "estimate": e})
            except Exception as err:
                state["busy"] = False
                code, msg = classify(err)
                if code == "FAILED":
                    traceback.print_exc(limit=2)
                print(f"✗ {msg}")
                api.call_or_ask("/worker/fail", {"job": job["id"], "code": code, "message": msg, "worker_id": state["id"]})
                if code == "AWS_TOKEN_EXPIRED":
                    print("Enter fresh AWS keys; the same job resumes from where it stopped.")
                    keys(cfg, only_aws=True)                        # the job is claimable again; its files are kept
                    resume = job["id"]
                elif code == "FAILED":
                    if state.get("out") and drive_dir(job):
                        sync(state["out"], drive_dir(job))         # keep everything for Retry in the app
                    print("  Its progress is kept" + (" on Drive" if drive_dir(job) else " in this session") +
                          ": press Retry on the job in the app to continue from here (no photo is bought again).")
                else:
                    forget(job, state.get("out"))                  # no Street View on this street: nothing to keep
            finally:
                state.update(job=None, stage=None, busy=False)
    except KeyboardInterrupt:
        print("\nWorker stopped. A job in progress shows as interrupted and resumes with the next worker"
              + (" (from its progress saved on Drive, on this Google account)." if SAVE_TO_DRIVE else "."))
    finally:
        state["stop"] = True


main()
