# Colab setup cells (S0 → S1a → S1ba → S1bb → worker cell)

Run them in this order in a **T4 GPU** runtime (Runtime → Change runtime type), every new session. After S1a changes
anything (first run of the day), use Runtime → Restart session and run S0, S1a, S1ba, S1bb again. Steps for the app side
(API, web, tunnel) are in the [README](../README.md#demo-day); details of the worker are in [README.md](README.md).

What the worker cell needs from the setup cells: **`cfg`** (the pipeline's `Config`, with the Google key) and
**`run_area`** (the pipeline's entry point). At its first question, *Pipeline + weights*, press **Enter** to use them.

> Where a block below says **PASTE CELL HERE**, the exact cell text is not in this repository yet. Copy it from your
> notebook into that block, so the next person can rebuild the notebook from this file.

---

## S0 — install the pipeline package

**What it does.** Mounts Google Drive, takes the **newest** zip in `/content/drive/MyDrive/alldataset`, deletes
`/MyDrive/alldataset/geo_cascadia_pkg/` and extracts the zip there, then puts the package on the Python path.

**What it needs.** The zip built from this repo, uploaded to `/MyDrive/alldataset` (S0 picks the newest):

```powershell
backend\.venv\Scripts\python tools\build_pkg_zip.py      # writes geo_cascadia_pkg_<tag>.zip; every entry is geo_cascadia_pkg/geo_cascadia/<file>.py
```

Rebuild and re-upload after every change to `pipeline/geo_cascadia/`. The worker refuses an older copy (it checks
`run_area` for the hooks it needs) and says so. P7 R3 did not change the pipeline, so the current zip is still
`geo_cascadia_pkg_p7a.zip`.

```python
# PASTE CELL HERE — S0 (mount Drive, newest zip in /MyDrive/alldataset → /MyDrive/alldataset/geo_cascadia_pkg, sys.path)
```

## S1a — dependencies

**What it does.** Installs the pipeline's packages (ultralytics / YOLO, PaddleOCR, CLIP via transformers, boto3 for
Amazon Bedrock, shapely, …). Two fixes from the real runs **must** be in it (D37, D39):

```python
!pip install -q "transformers==4.57.6"                  # 4.x returns tensors, as the use router was trained with (D37)
!pip uninstall -y tensorflow tf-keras tensorflow-hub    # TensorFlow made Paddle (sign reading) segfault, even on CPU (D39)
%env USE_TF=0
%env TRANSFORMERS_NO_TF=1
```

`boto3` must be installed in this cell too (it is not on Colab by default). At start the worker prints the transformers
version and warns if TensorFlow is still installed, with the exact fix.

```python
# PASTE CELL HERE — S1a (full pip list, with the four lines above)
```

## S1ba — keys

**What it does.** Puts the keys in the environment for this session, from Colab secrets (🔑 in the left bar), never
typed into the notebook text:
- **AWS** (Amazon Nova Lite, the cloud model): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`. These
  are **temporary SSO keys**: take fresh ones from the AWS access portal before each session; they expire after a few
  hours. When they expire mid-street, the job shows "Paused: key expired" and the worker cell asks for new ones.
- **Google server key** as the secret `GOOGLE_MAPS_KEY`: the same server key as `GOOGLE_PLACES_SERVER_KEY` in
  `backend/.env` (D41). API restrictions: Street View Static API + Places API (New) (+ Geocoding API); application
  restriction: None. Never the browser key.

```python
# PASTE CELL HERE — S1ba (Colab secrets → environment)
```

## S1bb — config and `run_area`

**What it does.** Builds the pipeline's `Config` (`cfg`: data folder on Drive, Google key, device, the local building-use
router `models/use_router.joblib`, the YOLO weights `training_runs/v8s_640_s2/weights/best.pt`, the two floor-count
example photos in `crops_building_v1/`) and imports `run_area`. The worker cell reads `cfg` and `run_area` from here.

```python
# PASTE CELL HERE — S1bb (Config(...) → cfg; from geo_cascadia.run_area import run_area)
```

## Worker cell

**What it does.** Paste the **whole** of [`worker/colab_worker.py`](colab_worker.py) into a new cell and run it. It
keeps running until you stop it.

1. *Pipeline + weights*: **Enter** (uses `cfg` / `run_area` from S1bb).
2. Optional OCR self-test (Enter = yes): loads the sign reader in a child process, reads one test image, frees it.
3. AWS keys (hidden; Enter keeps the ones from S1ba) and the Google server key (hidden; Enter keeps S1ba's). One free
   Street View metadata call checks that it is a server key.
4. Backend URL: the `https://….trycloudflare.com` address that the tunnel printed (README, T3).
5. Worker token: `WORKER_TOKEN` from `backend/.env`.

It prints `Worker ready on GPU … Waiting for a street…`, and the app's top bar shows **Analysis on**. It asks the API for
work every 10 s, heartbeats every 15 s, saves each street's progress to `MyDrive/gc_worker_jobs/<job id>/` after every
stage, and uploads the result (retried with back-off on a network blip, P7 R3). A street above the cost cap ($2 by
default) waits as **Needs approval** before any photo is bought; approve it on the Jobs page.

**After any change to `worker/colab_worker.py`, paste the new version into this cell** (P7 R3 changed it: result upload
retries).
