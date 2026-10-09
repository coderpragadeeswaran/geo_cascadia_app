"""GEO-CASCADIA analysis worker as an Ubuntu service (D63): the AWS GPU server, next to the API.

It runs the Colab cell's own code (worker/colab_worker.py, loaded without its last line `main()`, the way the tests load
it), so the job protocol, cost cap, Street View checks, OCR process, retries, crop deletion and statuses are exactly the
Colab worker's. Only the parts that need a person or Colab are replaced:
- no questions: settings and keys come from files (below); a question the cell would ask gets its Enter answer
  ("keep retrying"), except "start anyway?" after a failed OCR self-test, which is yes (a job's own OCR crash handling
  then falls back to the CPU, as on Colab);
- no Drive, no tunnel: the API is on the same machine (GC_API_URL, default http://127.0.0.1:8000);
- the pipeline package, the detector weights, the use router and the floor examples come from the server's folders;
- sign reading runs in its own Python (GC_OCR_PYTHON: the Paddle venv), so torch and Paddle never share an environment;
- keys: GC_ENV_FILE (WORKER_TOKEN, GOOGLE_MAPS_KEY = the Google server key) and GC_AWS_FILE (the Builder role's AWS keys,
  refreshed by tools/deploy/refresh_keys.ps1). Neither is printed. When AWS answers "expired" the job pauses as
  "expired_token" (as on Colab) and this worker waits for GC_AWS_FILE to change, then claims the same job again.

colab_worker.py stays the Colab fallback; nothing here changes it.
"""
import hashlib
import os
import sys
import time

os.environ.setdefault("USE_TF", "0")                      # D39: transformers must never load TensorFlow
os.environ.setdefault("TRANSFORMERS_NO_TF", "1")
os.environ.setdefault("PYTHONUNBUFFERED", "1")

HERE = os.path.dirname(os.path.abspath(__file__))
CELL = os.path.join(HERE, "colab_worker.py")
API_URL = os.environ.get("GC_API_URL", "http://127.0.0.1:8000").rstrip("/")
ENV_FILE = os.environ.get("GC_ENV_FILE", "/etc/geo-cascadia/worker.env")
AWS_FILE = os.environ.get("GC_AWS_FILE", "/etc/geo-cascadia/aws_builder.env")
PIPELINE_DIR = os.environ.get("GC_PIPELINE_DIR", os.path.join(os.path.dirname(HERE), "pipeline"))
ASSETS_DIR = os.environ.get("GC_ASSETS_DIR", "/opt/geo-cascadia/assets")
WORK_DIR = os.environ.get("GC_WORK_DIR", "/var/lib/gc-worker/jobs")
OCR_PYTHON = os.environ.get("GC_OCR_PYTHON") or None
KEY_POLL_S = 30
AWS_NAMES = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN")


def log(*a):
    print("[server worker]", *a, flush=True)


def read_env(path):
    """KEY=value lines (comments, blank lines, `export ` and quotes allowed). {} when the file is missing."""
    out = {}
    try:
        lines = open(path, encoding="utf-8-sig").read().splitlines()
    except OSError:
        return out
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip().removeprefix("export ").strip()] = "".join(v.split()).strip("'\"")
    return out


def fingerprint(path):
    try:
        return hashlib.sha256(open(path, "rb").read()).hexdigest()
    except OSError:
        return None


def load_cell():
    """colab_worker.py without its trailing main() call, in its own namespace (as backend/tests do)."""
    src = open(CELL, encoding="utf-8").read().rstrip()
    if not src.endswith("main()"):
        raise SystemExit(f"{CELL} no longer ends with main(); update server_worker.load_cell")
    g = {"__name__": "gc_colab_worker", "__file__": CELL}
    exec(compile(src[:-len("main()")], CELL, "exec"), g)
    return g


def install(g):
    os.makedirs(WORK_DIR, exist_ok=True)
    g.update(WORK_DIR=WORK_DIR, SAVE_TO_DRIVE=False, KEEPS_JOB_FILES=True, OCR_SELF_TEST=True, OCR_PYTHON=OCR_PYTHON)
    seen = {"aws": None}

    def ask(prompt, secret=False, default=None, compact=True):
        """No one to answer: Enter (keep retrying), or yes to 'start anyway?'."""
        p = " ".join(str(prompt).split())
        if "Start the worker anyway" in p:
            log("OCR self-test failed; starting anyway (each job falls back to the CPU if sign reading crashes).")
            return "y"
        if "tunnel URL" in p:
            log(f"the API at {API_URL} is not answering; retrying in {KEY_POLL_S} s")
            time.sleep(KEY_POLL_S)
        else:
            log(f"(question skipped, default used): {p[:120]}")
        return default

    def load_pipeline():
        sys.path.insert(0, PIPELINE_DIR)
        from geo_cascadia.config import Config
        from geo_cascadia.run_area import run_area
        g["check_pipeline"](run_area)
        c = Config(data_dir=ASSETS_DIR)
        router = os.path.join(ASSETS_DIR, "models", "use_router.joblib")
        if os.path.isfile(router):
            c.use_router_path = router
        else:
            log(f"⚠ no {router}: building use goes to the cloud model for every building (costs more)")
        need = [os.path.join(ASSETS_DIR, "training_runs", "v8s_640_s2", "weights", "best.pt")] + \
               [os.path.join(ASSETS_DIR, s) for s in c.floors_shots]
        missing = [p for p in need if not os.path.isfile(p)]
        if missing:
            raise SystemExit("Missing model files on the server: " + ", ".join(missing) + " (tools/deploy/make_bundle.ps1)")
        return c, run_area

    def apply_keys(cfg):
        env, aws = read_env(ENV_FILE), read_env(AWS_FILE)
        for k in AWS_NAMES:
            if aws.get(k):
                os.environ[k] = aws[k]
            else:
                os.environ.pop(k, None)
        cfg.maps_key = env.get("GOOGLE_MAPS_KEY") or env.get("GOOGLE_PLACES_SERVER_KEY") or ""
        seen["aws"] = fingerprint(AWS_FILE)
        return env, aws

    def keys(cfg, only_aws=False, only_google=False):
        """At start: read both files. After an expired AWS key (only_aws) or a refused Google key (only_google): wait
        until the matching file changes (refresh_keys.ps1 / a new app env), then read it again. The heartbeat keeps the
        worker 'online' meanwhile; the paused job resumes on the same job id."""
        if only_aws or only_google:
            path = AWS_FILE if only_aws else ENV_FILE
            old, t0 = fingerprint(path), time.time()
            log(f"waiting for new {'AWS' if only_aws else 'Google'} keys in {path} "
                f"({'tools/deploy/refresh_keys.ps1' if only_aws else 'fix the server key, then deploy.ps1 -Env'})")
            while fingerprint(path) == old:
                time.sleep(KEY_POLL_S)
                if int(time.time() - t0) % 300 < KEY_POLL_S:
                    log("still waiting for new keys…")
            log("new keys found")
        env, aws = apply_keys(cfg)
        if not all(aws.get(k) for k in AWS_NAMES[:2]):
            log(f"⚠ no AWS keys in {AWS_FILE}: cloud-model steps will fail until refresh_keys.ps1 is run")
        if not cfg.maps_key:
            raise SystemExit(f"No Google server key (GOOGLE_MAPS_KEY) in {ENV_FILE}.")
        while True:                                                # D39: a browser key is caught before any paid run
            why = g["google_key_problem"](cfg.maps_key)
            if not why:
                return
            log(f"✗ {why}")
            old = fingerprint(ENV_FILE)
            while fingerprint(ENV_FILE) == old:
                time.sleep(KEY_POLL_S)
            apply_keys(cfg)

    class Backend(g["Backend"]):
        def __init__(self):                                        # no questions: same machine, token from the file
            env = read_env(ENV_FILE)
            self.url, self.token = API_URL, env.get("WORKER_TOKEN", "")
            if not self.token:
                raise SystemExit(f"No WORKER_TOKEN in {ENV_FILE}.")
            import threading
            self.lock = threading.Lock()

    cell_run_job = g["run_job"]

    def run_job(api, job, base_cfg, run_area, state):
        """Each job starts with the AWS keys currently in GC_AWS_FILE, so refresh_keys.ps1 needs no restart."""
        if fingerprint(AWS_FILE) != seen["aws"]:
            apply_keys(base_cfg)
            log("AWS keys re-read from the refreshed file")
        return cell_run_job(api, job, base_cfg, run_area, state)

    g.update(ask=ask, load_pipeline=load_pipeline, keys=keys, Backend=Backend, install_deps=lambda: None, run_job=run_job)


def main():
    log(f"API {API_URL} · pipeline {PIPELINE_DIR} · assets {ASSETS_DIR} · jobs {WORK_DIR} · "
        f"OCR python {OCR_PYTHON or sys.executable}")
    g = load_cell()
    install(g)
    g["main"]()


if __name__ == "__main__":
    main()
