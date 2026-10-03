# pyright: reportMissingImports=false, reportMissingModuleSource=false
# GEO-CASCADIA analysis worker — ONE cell. Paste it after the setup cells (S0 install package, S1a deps, S1b keys),
# or run it on its own (Kaggle, laptop): it then loads the pipeline from the path / shared Drive link you give it.
#
# It asks at start for: the backend URL (the Cloudflare quick-tunnel URL), the worker token, AWS keys and the Google
# server key. Nothing secret is printed or written to disk. Stop it with the stop button (or Ctrl+C); a job it was
# running shows as "interrupted" in the app after ~2 minutes and the next worker session resumes it.
# Steps: worker/README.md.

# ----------------------------------------------------------------------------------------------- settings you may edit
MAX_PHOTOS_PER_JOB = 300        # cost cap: pause for approval if the plan needs more Street View photos than this …
MAX_USD_PER_JOB = 2.00          # … or costs more than this (estimate; photos x price + cloud-AI calls). A job queued by the
                                # app carries its own cap (backend JOB_COST_CAP_USD, default $2), which wins over this one
PLACES_PER_DAY = 300            # daily cap on Google Places look-ups (the "also on Google" check), all jobs together
HEARTBEAT_S = 15                # the app shows "disconnected" after ~45 s without a heartbeat
IDLE_POLL_S = 10                # how often to ask for work when the queue is empty
WORK_DIR = None                 # where job files are kept (None: /content/gc_jobs on Colab, ~/gc_jobs elsewhere)
CPU_OCR_MODE = "fast"           # on a CPU, sign reading uses the fast mode (a few crops per building); "full" = all crops
SAVE_TO_DRIVE = True            # with Drive mounted, each street's progress is saved there after every stage, so a restarted
DRIVE_JOBS_DIR = "/content/drive/MyDrive/gc_worker_jobs"   # worker on the same account continues (no photo bought twice)
OCR_SELF_TEST = "ask"           # at start: load the sign reader once, read one test image, free it. "ask" | True | False
OVERPASS_RETRY_S = (30, 60, 120)  # OpenStreetMap busy at the area stage: wait this long and try again, then fail (Retry)

import _thread, collections, dataclasses, gc, getpass, glob, inspect, json, os, platform, re, shutil, socket, subprocess, sys, \
    threading, time, traceback, uuid

try:
    import requests
except ImportError:                                           # tiny dependency, present on Colab / Kaggle
    os.system(f"{sys.executable} -m pip -q install requests"); import requests

# D39: transformers 4.x imports TensorFlow when it is installed, and TensorFlow crashed Paddle (sign reading) with a
# segfault on Colab, even on CPU. Tell transformers never to load it (this process and the OCR process inherit it).
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("TRANSFORMERS_NO_TF", "1")
TF_FIX = ('!pip uninstall -y tensorflow tf-keras tensorflow-hub  and  %env USE_TF=0  and  %env TRANSFORMERS_NO_TF=1  '
          '(then Runtime → Restart session and re-run the setup cells)')
BROWSER_KEY = "This Google key only works in a browser; use the server key (Enter keeps the one from the setup cells)."
ON_COLAB = "google.colab" in sys.modules or os.path.isdir("/content")
WORK_DIR = WORK_DIR or ("/content/gc_jobs" if ON_COLAB else os.path.join(os.path.expanduser("~"), "gc_jobs"))
os.makedirs(WORK_DIR, exist_ok=True)
STAGES = ["panoramas", "area", "plan", "detect", "geometry", "ocr", "vlm", "reference", "match", "export"]
SUB = {"detect": "detect", "ocr": "ocr", "vlm_names": "vlm", "building_crops": "vlm", "vlm_buildings": "vlm", "places": "reference"}
# Ward 29 reference: cloud-AI spend per building with the local router, used only for the ESTIMATE when the job carries no
# rates. P8: recounted like for like from the run's saved calls ($0.0702 for 381 buildings: use, floors, name and
# business-sign checks); the model card's $0.056 left out the name and business-sign checks (a resumed run's counter).
VLM_USD_PER_BUILDING = 0.0702 / 381
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


def check_tensorflow():
    """D39: TensorFlow next to Paddle crashed sign reading on Colab. Warn with the exact S1a fix when it is installed."""
    from importlib.metadata import PackageNotFoundError, version
    found = []
    for pkg in ("tensorflow", "tensorflow-cpu", "tf-keras", "tensorflow-hub"):
        try:
            found.append(f"{pkg} {version(pkg)}")
        except PackageNotFoundError:
            pass
    if found:
        print(f"⚠ TensorFlow is installed ({', '.join(found)}). With transformers 4.x it crashed Paddle (sign reading) on "
              f"Colab. Put this in S1a: {TF_FIX}"
              + (" TensorFlow is already loaded in this session." if "tensorflow" in sys.modules else ""))
    return found


def google_key_problem(key):
    """One free call (Street View metadata) with the Google key the worker will use: None when it works (or when the
    answer is unclear), else a plain sentence. A website-restricted (browser) key is refused with a referer message."""
    try:
        r = requests.get("https://maps.googleapis.com/maps/api/streetview/metadata",   # the pipeline's own search call
                         params={"location": "11.0296,76.9752", "radius": 15, "source": "outdoor", "key": key}, timeout=15)
        j = r.json()
    except Exception:
        return None                                                # no network answer: the first job will tell
    status, msg = j.get("status"), scrub(j.get("error_message") or "", key)
    if status in SV_FINE:
        return None
    if "referer" in msg.lower() or "referrer" in msg.lower():
        return BROWSER_KEY
    return f"Google refused this key (HTTP {r.status_code} {status}{': ' + msg[:160] if msg else ''})."


# ----------------------------------------------------------------------------------------------- Street View answers
SV_FINE = ("OK", "ZERO_RESULTS", "NOT_FOUND")     # real answers about imagery; anything else is a refused/failed request
SV_HINT = {"REQUEST_DENIED": "the Google key given to the worker is not allowed to use the Street View Static API "
                             "(check that key's API restrictions in Google Cloud Console)",
           "OVER_QUERY_LIMIT": "the key's Street View quota is used up, or billing is off on its project",
           "network": "the worker could not reach Google"}


def scrub(text, key=None):
    """Never show a key: the key itself, any key=… in a URL, any AIza… token."""
    t = str(text or "")
    if key:
        t = t.replace(key, "…")
    t = re.sub(r"key=[^&\s'\"]+", "key=…", t)
    return re.sub(r"AIza[0-9A-Za-z_\-]{20,}", "AIza…", t)


class StreetViewProblem(Exception):
    """The Street View look-ups were refused or failed, or no look-up was made: not "no imagery"."""
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class StreetViewTrace:
    """D40. The pipeline reads every Street View answer other than OK as "no panorama here" (and a photo that did not
    come back as "no photo"), so a refused key, a used-up quota or a network failure ended as "Google has no outdoor
    Street View imagery on this selection". The pipeline is not changed: for the run, the `requests` its streetview
    module uses is wrapped, and every answer is counted as (HTTP status, Google's status) with Google's message."""

    def __init__(self, key=None):
        self.key, self.lock = key, threading.Lock()
        self.meta, self.images, self.msgs = collections.Counter(), collections.Counter(), {}
        self.reported = False                  # the job already failed with this trace's reason

    def _add(self, counter, k, msg=None):
        with self.lock:
            counter[k] += 1
            if msg and k not in self.msgs:
                self.msgs[k] = scrub(msg, self.key)[:200]

    def get(self, real, url, *a, **k):
        counter = self.meta if str(url).rstrip("/").endswith("/metadata") else self.images
        try:
            r = real.get(url, *a, **k)
        except Exception as e:
            self._add(counter, ("network", type(e).__name__), str(e))
            raise
        if counter is self.meta:
            try:
                j = r.json()
            except ValueError:
                j = {}
            self._add(counter, (r.status_code, j.get("status") or "no answer"), j.get("error_message"))
        else:
            self._add(counter, (r.status_code, "OK" if r.status_code == 200 else "refused"),
                      None if r.status_code == 200 else (getattr(r, "text", "") or "").strip()[:200])
        return r

    def install(self, run_area):
        """Wrap the streetview module of the package run_area comes from; returns the undo."""
        pkg = (getattr(run_area, "__module__", "") or "").rpartition(".")[0]
        mod = sys.modules.get(f"{pkg}.streetview") if pkg else None
        if mod is None or not hasattr(mod, "requests"):
            return lambda: None
        real, trace = mod.requests, self

        class Wrapped:
            def __getattr__(self, n):
                return getattr(real, n)

            def get(self, url, *a, **k):
                return trace.get(real, url, *a, **k)
        mod.requests = Wrapped()

        def undo():
            mod.requests = real
        return undo

    def failed(self, counter):
        return {k: n for k, n in counter.items() if k[1] not in SV_FINE}

    def describe(self, counter, what):
        """'HTTP 200 REQUEST_DENIED — <Google's message> (412 of 412 look-ups)'"""
        bad = self.failed(counter)
        (http, status), _ = max(bad.items(), key=lambda kv: kv[1])
        msg = self.msgs.get((http, status))
        head = f"network error ({status})" if http == "network" else f"HTTP {http} {status}"
        return f"{head}{' — ' + msg if msg else ''} ({sum(bad.values())} of {sum(counter.values())} {what})"

    def no_imagery(self):
        """After the pipeline's NO_STREET_VIEW: (code, message). Only real answers (ZERO_RESULTS / NOT_FOUND, or
        panoramas outside the selection) mean there is no imagery; a refused or failed look-up never does."""
        total = sum(self.meta.values())
        if not total:
            return "BAD_AREA", ("Couldn't search this selection for Street View: no look-up was made, so the area the "
                                "worker received is empty or too small. Please report this street")
        bad = self.failed(self.meta)
        if not bad:
            return "NO_STREET_VIEW", f"Google has no outdoor Street View imagery on this selection ({total} points checked)"
        (http, status), _ = max(bad.items(), key=lambda kv: kv[1])
        if "referer" in self.msgs.get((http, status), "").lower():
            return "GOOGLE_BROWSER_KEY", BROWSER_KEY
        hint = SV_HINT.get("network" if http == "network" else status, "Google did not answer normally")
        return ("GOOGLE_KEY" if status == "REQUEST_DENIED" else "GOOGLE_REQUEST",
                f"Street View request failed: {self.describe(self.meta, 'look-ups')}. This is not a lack of imagery: {hint}")

    def warnings(self):
        """Look-ups or photos that failed in a run that still went on (points or views silently missing)."""
        out = []
        if self.reported:
            return out
        if self.failed(self.meta):
            out.append(f"Street View look-ups failed: {self.describe(self.meta, 'look-ups')}; panoramas there may be missing")
        if self.failed(self.images):
            out.append(f"Street View photos failed: {self.describe(self.images, 'photos')}; those views have no detections")
        return out


def check_pipeline(run_area):
    """This worker needs the P7a version of the package (live progress, cost cap, OCR process; D42-D45 register, location
    matching, sign links, pole uncertainty). An older copy on Drive lacks them."""
    params = inspect.signature(run_area).parameters
    try:                                   # P7a (D42-D45): the register, location matching, sign links, pole uncertainty
        import importlib, importlib.util
        mod = importlib.import_module(run_area.__module__.rsplit(".", 1)[0])
        p7a = all(importlib.util.find_spec(f"{mod.__name__}.{m}") for m in ("register", "signlink", "poleunc"))
    except Exception:
        p7a = False
    try:                                   # D53: the area stage's map-source hook (local map data from the app)
        hook = hasattr(importlib.import_module(f"{mod.__name__}.area"), "MAP_SOURCE")
    except Exception:
        hook = False
    if not {"plan_check", "on_stage", "ocr_runner"} <= set(params) or not p7a or not hook:
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


def keys(cfg, only_aws=False, only_google=False):
    """AWS (cloud AI) and Google (Street View + Places) keys, asked without echo; kept in memory / env only. Keys from the
    setup cells are cleaned too (a space pasted into S1b breaks signing just the same)."""
    if not only_google:
        os.environ["AWS_ACCESS_KEY_ID"] = ask("AWS access key id: ", secret=True) or os.environ.get("AWS_ACCESS_KEY_ID", "")
        os.environ["AWS_SECRET_ACCESS_KEY"] = ask("AWS secret access key: ", secret=True) or os.environ.get("AWS_SECRET_ACCESS_KEY", "")
        tok = ask("AWS session token (Enter if none): ", secret=True)
        if tok:
            os.environ["AWS_SESSION_TOKEN"] = tok
    setup_key = clean(getattr(cfg, "setup_maps_key", None) or cfg.maps_key)
    cfg.setup_maps_key = setup_key                                 # "Enter keeps the one from the setup cells"
    if not only_aws:
        g = ask("Google server key (Street View + Places) [Enter = keep the one from the setup cells]: ", secret=True)
        cfg.maps_key = g or setup_key
    for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        if os.environ.get(k):
            os.environ[k] = clean(os.environ[k])
    cfg.maps_key = clean(cfg.maps_key)
    if not cfg.maps_key:
        raise SystemExit("A Google server key is needed for Street View.")
    if only_aws:
        return
    for _ in range(3):                                             # D39: a browser key is caught here, not after a paid run
        why = google_key_problem(cfg.maps_key)
        if not why:
            return
        print(f"✗ {why}")
        cfg.maps_key = clean(ask("Google server key: ", secret=True) or setup_key)
    raise SystemExit("No working Google server key: create or unrestrict a server key (worker/README.md), then re-run the cell.")


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


class MapSource:
    """D53: geo_cascadia.area.MAP_SOURCE for a job. The area stage's OpenStreetMap queries and Microsoft footprints come
    from the app (POST /worker/mapdata): its PostGIS copy for the covered cities, else the app's Overpass call with a
    30-day cache. When the app can't answer (outside the cities for Microsoft, Overpass busy, tunnel trouble) it returns
    None and the pipeline asks Overpass / Microsoft itself, exactly as before. Counts what answered, for worker_run.json."""
    WAIT_S = 180                         # how long to keep asking while the app is still waiting for Overpass

    def __init__(self, api):
        self.api, self.used, self.dates = api, {}, {}

    def _count(self, kind, src):
        self.used.setdefault(kind, {}).setdefault(src, 0)
        self.used[kind][src] += 1

    def __call__(self, kind, arg):
        body = {"kind": kind, **({"query": arg} if kind == "overpass" else {"bbox": list(arg)})}
        t_end = time.time() + self.WAIT_S
        try:
            while True:
                r = self.api.call("/worker/mapdata", body, timeout=90)
                if r.get("source") != "pending" or time.time() > t_end:
                    break
                time.sleep(r.get("retry_after_s") or 5)
        except SystemExit:
            raise
        except Exception as e:                                         # tunnel / API trouble: the pipeline's own call
            print(f"  map data from the app unavailable ({type(e).__name__}); asking OpenStreetMap / Microsoft directly")
            self._count(kind, "worker_direct")
            return None
        src = r.get("source")
        if src == "local":
            self.dates.update({k: r.get(k) for k in ("city", "osm_snapshot", "ms_release")})
        if src in ("local", "overpass", "cache"):
            self._count(kind, "app_" + src)
            return r.get("elements") if kind == "overpass" else r.get("rings")
        self._count(kind, "worker_direct")
        return None

    def summary(self):
        """{"local": True when every answer came from the app's snapshot, "answers": counts, + snapshot dates}"""
        if not self.used:
            return None
        srcs = {k for d in self.used.values() for k in d}
        return {"local": srcs == {"app_local"}, "answers": self.used, **self.dates}


def install_map_source(run_area, src):
    """set geo_cascadia.area.MAP_SOURCE for this run; returns the undo function"""
    import importlib
    try:
        mod = importlib.import_module(run_area.__module__.rsplit(".", 1)[0] + ".area")
    except ImportError:                    # not the pipeline package (a test's stand-in run_area): nothing to install
        return lambda: None
    old = getattr(mod, "MAP_SOURCE", None)
    mod.MAP_SOURCE = src
    def undo():
        mod.MAP_SOURCE = old
    return undo


# ----------------------------------------------------------------------------------------------- 3. memory + sign reading
def _gb(b):
    return f"{b / 2 ** 30:.1f}"


def mem_line():
    """RAM used / total on the machine (this worker's share) and GPU memory used / total (all processes, nvidia-smi, so
    the OCR process is included). Never initialises CUDA itself."""
    parts = []
    try:
        import psutil
        vm = psutil.virtual_memory()
        parts.append(f"RAM {_gb(vm.total - vm.available)}/{_gb(vm.total)} GB (worker {_gb(psutil.Process().memory_info().rss)})")
    except Exception:
        try:
            m = {ln.split(":")[0]: int(ln.split()[1]) * 1024 for ln in open("/proc/meminfo")}
            parts.append(f"RAM {_gb(m['MemTotal'] - m['MemAvailable'])}/{_gb(m['MemTotal'])} GB")
        except Exception:
            parts.append("RAM ?")
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=5)
        used, total = (float(x) for x in r.stdout.strip().splitlines()[0].split(","))
        parts.append(f"GPU {used / 1024:.1f}/{total / 1024:.1f} GB")
    except Exception:
        pass                                                       # no NVIDIA GPU
    return " · ".join(parts)


def log_mem(label):
    print(f"  [mem] {label}: {mem_line()}", flush=True)


def free_memory():
    """Before sign reading: the detector (YOLO) is no longer referenced once detection returns; collect it and hand its
    cached GPU memory back, so the OCR process gets the RAM and GPU."""
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass


# The OCR process. It imports the pipeline's own OCR code and runs it unchanged; it only reports when the models are
# loaded (where the Colab crashes happened), progress, and the result. "@@" lines are for the worker.
OCR_CHILD = r'''
import json, os, sys, time
spec = json.load(open(sys.argv[1]))
if spec.get("pkg"):
    sys.path.insert(0, spec["pkg"])
from geo_cascadia.config import Config
from geo_cascadia import ocr as O
base = Config()
tup = lambda v: tuple(tup(x) for x in v) if isinstance(v, list) else v      # JSON made the tuple settings lists
cfg = Config(**{k: tup(v) if isinstance(getattr(base, k, None), tuple) else v for k, v in spec["cfg"].items()})
say = lambda *a: print("@@", *a, flush=True)
if spec["mode"] == "selftest":
    from PIL import Image, ImageDraw, ImageFont
    t = time.time()
    eng = O.OCR(cfg); say("LOADED")
    im = Image.new("RGB", (360, 90), "white")
    try:
        font = ImageFont.load_default(size=56)
    except TypeError:
        font = ImageFont.load_default()
    ImageDraw.Draw(im).text((12, 12), "HOTEL", fill="black", font=font)
    path = spec["result"] + ".png"; im.save(path)
    det = {"pano_id": "selftest", "heading": 0, "pitch": 0, "conf": 1.0, "y1": 100, "y2": 190, "H": 640,
           "footprint_faced": None}
    r = eng.read(path, det)
    json.dump({"text": r.get("best") or r.get("text") or "", "mode": eng.mode, "seconds": round(time.time() - t, 1)},
              open(spec["result"], "w"))
else:
    dets = json.load(open(spec["dets"]))
    real = O.OCR
    def loaded(c):
        e = real(c); say("LOADED"); return e
    O.OCR = loaded
    res, names, stats = O.run_ocr(dets, cfg, spec["out_dir"], lambda name, n, total: say("PROGRESS", n, total))
    json.dump({"names": names, "stats": stats}, open(spec["result"], "w"))
say("DONE")
'''


def pkg_parent():
    """The folder holding the geo_cascadia package this worker imported, for the OCR process's sys.path."""
    m = sys.modules.get("geo_cascadia")
    f = getattr(m, "__file__", None) if m else None
    return os.path.dirname(os.path.dirname(os.path.abspath(f))) if f else ""


def crash_reason(rc, tail):
    if rc in (-9, 137):
        return "the system killed it, which usually means it ran out of memory (RAM)"
    if rc in (-11, 139):
        return "a native crash (segmentation fault) inside Paddle / CUDA"
    if rc in (-6, 134):
        return "a native abort inside Paddle / CUDA"
    if rc == 0:
        return "it ended without a result"
    last = next((ln for ln in reversed(tail) if ln.strip()), "")
    return f"exit code {rc}" + (f": {last.strip()[:160]}" if last else "")


def run_child(mode, cfg, extra=None, progress=None, script=None, label=""):
    """Run the OCR process once. Returns (ok, result, why). The worker survives whatever happens to it; a cancel or a stop
    (Cancelled / KeyboardInterrupt from progress or the heartbeat) kills it."""
    tmp = os.path.join(WORK_DIR, "_ocr")
    os.makedirs(tmp, exist_ok=True)
    if not script:
        script = os.path.join(tmp, "ocr_child.py")
        open(script, "w", encoding="utf-8").write(OCR_CHILD)
    spec_p, result = os.path.join(tmp, f"{mode}_spec.json"), os.path.join(tmp, f"{mode}_result.json")
    for f in (result, result + ".png"):
        if os.path.exists(f):
            os.remove(f)
    # no secret goes to disk (keys stay in the environment); class ids are ints, which JSON would turn into strings
    c = {k: v for k, v in dataclasses.asdict(cfg).items() if k not in ("maps_key", "classes")}
    json.dump({"mode": mode, "pkg": pkg_parent(), "cfg": c, "result": result, **(extra or {})}, open(spec_p, "w"), default=str)
    env = dict(os.environ, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
    env["PYTHONPATH"] = os.pathsep.join(x for x in (pkg_parent(), env.get("PYTHONPATH")) if x)
    if cfg.device == "cpu":
        env["CUDA_VISIBLE_DEVICES"] = ""                           # the CPU fallback never touches the GPU
    tail = collections.deque(maxlen=30)
    proc = subprocess.Popen([sys.executable, script, spec_p], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
                            text=True, encoding="utf-8", errors="replace", bufsize=1)
    try:
        for line in proc.stdout:
            line = line.rstrip()
            if line.startswith("@@ PROGRESS"):
                _, _, n, total = line.split()
                if progress:
                    progress("ocr", int(n), int(total))
            elif line.startswith("@@ LOADED"):
                log_mem(f"OCR models loaded{label}")
            elif not line.startswith("@@"):
                tail.append(line)
                print("  │ " + line, flush=True)
        rc = proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
    ok = rc == 0 and os.path.exists(result)
    return ok, (json.load(open(result)) if ok else None), (None if ok else crash_reason(rc, tail))


def cpu_fallback(cfg):
    return dataclasses.replace(cfg, device="cpu", ocr_mode="fast")


def ocr_runner_for(tell, log, script=None):
    """run_area's ocr_runner: sign reading in its own process. A crash is retried once the same way; a second crash
    on the GPU falls back to CPU quick mode. The OCR stage saves ocr.json as it goes, so each try continues."""
    def runner(dets, cfg, out_dir, progress):
        free_memory()
        log_mem("before OCR (detector freed)")
        tmp = os.path.join(WORK_DIR, "_ocr")
        os.makedirs(tmp, exist_ok=True)
        dets_p = os.path.join(tmp, "dets.json")
        json.dump(dets, open(dets_p, "w"))
        tries = [cfg, cfg] + ([cpu_fallback(cfg)] if cfg.device == "gpu" else [])
        why = None
        for i, c in enumerate(tries):
            where = f" ({c.device.upper()}, {c.ocr_mode} mode)"
            ok, r, why = run_child("run", c, {"dets": dets_p, "out_dir": out_dir}, progress, script, where)
            log.append({"try": i + 1, "device": c.device, "ocr_mode": c.ocr_mode, "ok": ok, "why": why})
            if ok:
                log_mem("after OCR (OCR process ended)")
                names = {fp: tuple(v) for fp, v in (r.get("names") or {}).items()}
                return json.load(open(os.path.join(out_dir, "ocr.json"))), names, r["stats"]
            log_mem("after the OCR crash")
            print(f"✗ Sign reading crashed{where}: {why}.")
            if i + 1 < len(tries):
                nxt = tries[i + 1]
                if nxt.device == c.device:
                    tell(f"Sign reading crashed ({why}); trying once more. Signs already read are kept.")
                else:
                    tell(f"Sign reading crashed twice on the GPU ({why}), so it continues on the CPU in quick mode: "
                         f"at most {nxt.fast_max_crops_per_building} signs per building, and slower.")
                print("  " + ("retrying once" if nxt.device == c.device else "falling back to CPU quick mode") + "…")
        raise RuntimeError(f"Sign reading crashed {len(tries)} times ({why}). Press Retry: it continues from the saved "
                           "progress.")
    return runner


def ocr_self_test(cfg):
    """Load the sign reader once, read one test image, free it: before claiming a job, so a runtime that cannot read
    signs is known before any photo is bought."""
    go = OCR_SELF_TEST
    if go == "ask":
        go = (ask("Run the OCR self-test first? It loads the sign reader, reads one test image and frees it "
                  "(about 1 min) [Y/n]: ") or "y").lower().startswith("y")
    if not go:
        return
    first = dataclasses.replace(cfg, ocr_mode=CPU_OCR_MODE) if cfg.device == "cpu" else cfg
    tries = [first] + ([cpu_fallback(cfg)] if cfg.device == "gpu" else [])
    for c in tries:
        where = f"{c.device.upper()}, {c.ocr_mode} mode"
        log_mem(f"before the OCR self-test ({where})")
        ok, r, why = run_child("selftest", c, label=f" ({where})")
        if ok:
            print(f"✓ OCR self-test ({where}): OK. It read “{r['text'] or 'nothing'}” in {r['seconds']} s. "
                  "The OCR process has ended and its memory is free.")
            if c is not first:
                print("  Jobs still run: when sign reading crashes on the GPU, the worker switches to the CPU on its own.")
            return
        print(f"✗ OCR self-test ({where}) failed: {why}.")
    if not (ask("Sign reading does not work in this runtime. Runtime → Restart session and re-run the setup cells is "
                "the usual fix. Start the worker anyway? [y/N]: ") or "n").lower().startswith("y"):
        raise SystemExit("Stopped before claiming a job: fix sign reading first (worker/README.md).")


# ----------------------------------------------------------------------------------------------- 4. one job
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


IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")


def count_images(d):
    """(number, bytes) of image files under d: the Street View photo crops the pipeline saved (crops_signboard/,
    crops_building/). Full photos are never written to disk (detect.py keeps them in memory)."""
    n = size = 0
    for root, _, files in os.walk(d or ""):
        for f in files:
            if f.lower().endswith(IMAGE_EXT):
                n += 1
                try:
                    size += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
    return n, size


def forget(job, out):
    """The job finished or was cancelled: delete its saved progress (Drive) and its local files, photo crops included.
    P8 (Google terms): after a delivered result only the derived data stays, in the app; this says how many Street View
    crops were deleted and checks that none is left."""
    n = size = 0
    for d in (drive_dir(job), out):
        if d and os.path.isdir(d):
            k, s = count_images(d)
            n, size = n + k, size + s
            shutil.rmtree(d, ignore_errors=True)
            if os.path.isdir(d) and count_images(d)[0]:            # a locked file: delete the images one by one
                for root, _, files in os.walk(d):
                    for f in files:
                        if f.lower().endswith(IMAGE_EXT):
                            try:
                                os.remove(os.path.join(root, f))
                            except OSError:
                                pass
            left = count_images(d)[0] if os.path.isdir(d) else 0
            if left:
                print(f"  ⚠ {left} photo crop(s) could not be deleted in {d}: delete them by hand (Google terms).")
    if n:
        print(f"  deleted {n:,} Street View photo crops ({size / 1e6:.1f} MB); only the derived results are kept, in the app.")
    return n


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
    drop_empty_panos(out)
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
    people_note = None                                             # the job card's note (card["note"] once running)
    if continuing:
        people_note = ("Continuing from the progress saved on Drive" if from_drive else "Continuing from the saved progress"
                       ) + ": stages already finished are not repeated and photos already fetched are not bought again."
    elif job.get("resumed_claim"):
        people_note = ("Started again from the beginning: this worker has no saved progress for this street "
                       "(a different Google account, or Drive not connected).")
    card = {"note": people_note}
    ocr_log = []
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
                                              "worker_id": state["id"], "note": card["note"]})
            if r.get("job_status") in ("cancelling", "cancelled", "failed"):
                state["cancel"] = True
        except Exception:
            pass                                                   # progress is best effort; the heartbeat keeps the job
        check()

    def progress(name, done, total):
        post(SUB.get(name, name), done, total)

    def tell(msg):
        card["note"] = msg                                         # on the job card from the next report on
        post(state.get("stage") or "ocr", None, None, force=True)

    def on_stage(name, seconds):
        nxt_name = STAGES[STAGES.index(name) + 1] if name in STAGES and STAGES.index(name) + 1 < len(STAGES) else None
        log_mem(f"{name} done" + (f" → {nxt_name} starts" if nxt_name else ""))
        if saved:
            last["sync"] = time.time(); sync(out, saved)          # a finished stage is safe on Drive
        post(nxt_name or name, 0, None, force=True)

    def plan_check(plan):
        est = plan_estimate(plan, price, inp.get("rates"), inp.get("cost_cap_usd"))
        if not job.get("approved") and (est["photos"] > est["cap_photos"] or est["usd"] > est["cap_usd"]):
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
    log_mem("panoramas starts")
    waits = list(OVERPASS_RETRY_S)
    trace = StreetViewTrace(getattr(cfg, "maps_key", None))       # D40: every Street View answer, to tell why
    undo_trace = trace.install(run_area)
    maps = MapSource(api)                                          # D53: map data from the app (PostGIS / cached Overpass)
    undo_maps = install_map_source(run_area, maps)
    try:
        while True:
            try:
                exp, _ = run_area(poly, out, cfg, area_name=name, way_ids=inp.get("way_ids"), progress=progress,
                                  on_stage=on_stage, plan_check=plan_check, resume=True, ocr_runner=ocr_runner_for(tell, ocr_log))
                break
            except Exception as err:
                if str(err).startswith("NO_STREET_VIEW"):
                    code, msg = trace.no_imagery()
                    if code == "NO_STREET_VIEW":
                        raise RuntimeError(f"NO_STREET_VIEW: {msg}") from None
                    drop_empty_panos(out)                          # Retry must search again, not reload "nothing found"
                    trace.reported = True
                    raise StreetViewProblem(code, msg) from None
                if not map_server_busy(err) or not waits:
                    raise
                # D39: OpenStreetMap is often busy for a minute or two; the run resumes from its saved stages
                w, n = waits.pop(0), len(OVERPASS_RETRY_S) - len(waits)
                tell(f"Map server busy (OpenStreetMap), retrying in {w} s… (try {n} of {len(OVERPASS_RETRY_S)})")
                print(f"  OpenStreetMap is busy; retrying in {w} s (try {n} of {len(OVERPASS_RETRY_S)})…")
                for _ in range(w):
                    check()
                    time.sleep(1)
                tell(f"Map server was busy (OpenStreetMap); continuing after {n} {'retry' if n == 1 else 'retries'}.")
    finally:
        undo_trace()
        undo_maps()
        md = maps.summary()
        if md:
            note["map_data"] = md
            print("  map data: " + ("the app's OpenStreetMap snapshot " + str(md.get("osm_snapshot") or "")[:10]
                                    if md["local"] else f"{md['answers']}"))
            json.dump(note, open(note_p, "w"))
        warns = trace.warnings()                                   # look-ups / photos that failed in a run that went on
        for w in warns:
            print(f"  ⚠ {w}")
        if warns:
            note["street_view_errors"] = note.get("street_view_errors", []) + warns
        if ocr_log:                                                # what sign reading went through, kept with the run
            note["ocr_tries"] = note.get("ocr_tries", []) + ocr_log
        if warns or ocr_log:
            json.dump(note, open(note_p, "w"))
    check()
    used = (exp.get("meta", {}).get("run") or {}).get("places_calls") or 0
    json.dump({"used": pused + used}, open(ppath, "w"))
    post("export", 1, 1, force=True)
    names = sorted(glob.glob(os.path.join(out, "*.json"))) + glob.glob(os.path.join(out, "export.geojson"))
    names = [p for p in names if os.path.getsize(p) <= 40 * 1024 * 1024]
    print(f"  uploading {len(names)} result files…")
    upload_result(api, job["id"], state["id"], names)
    forget(job, out)
    print(f"✓ {name}: done — it appears in the app's area list.")


UPLOAD_RETRY_S = (5, 15, 30, 60, 120)    # P7 R3: a failed result upload (network blip, tunnel hiccup) is sent again


def upload_result(api, job_id, worker_id, names):
    """POST /worker/result with retries and backoff. The files are opened again for every try (a failed try has already
    read them, and a retry would send them empty). If an earlier try reached the backend but its answer was lost, the
    backend answers 409 "job is done": the result is already delivered. After the last retry, ask for a new tunnel URL
    (Enter = keep retrying), as the other calls do. The run's files stay on disk/Drive until the upload succeeds."""
    tries, sent = 0, False                       # sent: an earlier try may have reached the backend
    while True:
        files = [("files", (os.path.basename(p), open(p, "rb"), "application/json")) for p in names]
        try:
            return api.call("/worker/result", files=files, data={"job": job_id, "worker_id": worker_id})
        except SystemExit:
            raise
        except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as e:
            resp = getattr(e, "response", None)
            code = getattr(resp, "status_code", None)
            if code == 409 and sent and "job is done" in (resp.text or ""):
                print("  the backend already has this result (an earlier try got through)")
                return None
            if code and code < 500 and code != 404:          # 404: an old tunnel URL, as in call_or_ask
                raise
            sent = True
            if tries < len(UPLOAD_RETRY_S):
                w = UPLOAD_RETRY_S[tries]
                tries += 1
                why = f"HTTP {code}" if code else type(e).__name__
                print(f"  upload failed ({why}); retrying in {w} s (try {tries} of {len(UPLOAD_RETRY_S)})…")
                time.sleep(w)
                continue
            new = ask("The backend is not responding. Paste the new tunnel URL (Enter = keep retrying): ")
            if new:
                api.url = new.rstrip("/")
            tries = 0
        finally:
            for _, (_, fh, _) in files:
                fh.close()


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


def plan_estimate(plan, price, rates=None, cap_usd=None):
    """The cost cap's estimate, from the REAL camera plan of the clicked street: one photo per planned view, plus one
    building crop per building faced (an upper bound). With the job's rates (P7.2, the same ones the app's estimate
    used): photos x (Street View price + cloud-AI cost per photo); without: cloud-model spend per building (Ward 29)."""
    views = sum(len(e["views"]) for e in plan)
    faced = len({v["footprint"] for e in plan for v in e["views"] if v.get("footprint")})
    photos = views + faced
    r = rates or {}
    if r.get("sv_price") is not None and r.get("cloud_usd_per_image") is not None:
        usd = photos * (r["sv_price"] + r["cloud_usd_per_image"])
    else:
        usd = photos * price + faced * VLM_USD_PER_BUILDING
    return {"photos": photos, "usd": round(usd, 2), "cameras": len(plan), "buildings": faced,
            "cap_photos": MAX_PHOTOS_PER_JOB, "cap_usd": cap_usd if cap_usd is not None else MAX_USD_PER_JOB}


def map_server_busy(err):
    """the area stage could not reach OpenStreetMap (all Overpass mirrors busy)"""
    m = str(err)
    return "Overpass" in m or "overpass" in m


def drop_empty_panos(out):
    """run_area saves panos.json before it checks it; an empty one would make every later attempt skip the search."""
    p = os.path.join(out, "panos.json")
    try:
        with open(p) as f:
            empty = json.load(f) == []
        if empty:
            os.remove(p)
    except (OSError, ValueError):
        pass


def classify(err):
    if isinstance(err, StreetViewProblem):                         # D40: refused / failed look-ups, not "no imagery"
        return err.code, str(err)
    m = str(err)
    if "referer" in m.lower() or "referrer" in m.lower():
        return "GOOGLE_BROWSER_KEY", BROWSER_KEY
    if map_server_busy(err):
        return "FAILED", ("The map server (OpenStreetMap) stayed busy after several tries. Press Retry in a few minutes: "
                          "the analysis continues from where it stopped.")
    for code in ("NO_STREET_VIEW", "NO_STREETS", "NO_CAMERAS"):
        if m.startswith(code):
            return code, m.split(":", 1)[-1].strip()
    if any(k in m for k in ("AWS token expired", "ExpiredToken", "security token included in the request is expired",
                            "security token included in the request is invalid", "UnrecognizedClientException")):
        return "AWS_TOKEN_EXPIRED", "The cloud-AI keys expired; refresh them in the worker cell."
    return "FAILED", (m.splitlines() or ["error"])[0][:300]


# ----------------------------------------------------------------------------------------------- 5. the loop
def main():
    check_transformers()
    check_tensorflow()
    cfg, run_area = load_pipeline()
    cfg = cfg.resolve() if hasattr(cfg, "resolve") else cfg
    log_mem("worker start")
    ocr_self_test(cfg)
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
                      f"({e['cap_photos']} photos / ${e['cap_usd']}). Approve it in the app to run it.")
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
                elif code in ("FAILED", "GOOGLE_BROWSER_KEY", "GOOGLE_KEY", "GOOGLE_REQUEST", "BAD_AREA"):
                    if state.get("out") and drive_dir(job):
                        sync(state["out"], drive_dir(job))         # keep everything for Retry in the app
                    print("  Its progress is kept" + (" on Drive" if drive_dir(job) else " in this session") +
                          ": press Retry on the job in the app to continue from here (no photo is bought again).")
                    if code in ("GOOGLE_BROWSER_KEY", "GOOGLE_KEY"):
                        keys(cfg, only_google=True)                # a working server key now; Retry then finishes the job
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
