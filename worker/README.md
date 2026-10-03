# Analysis worker

The worker runs the real pipeline for a street clicked in the app. It runs **somewhere with the models** (Colab GPU,
Kaggle GPU or your laptop CPU), asks the app's API for work through a Cloudflare quick tunnel, and uploads the results.
The API loads them like the three original areas.

```
browser (localhost:5173) → API (localhost:8000) ← tunnel (https://….trycloudflare.com) ← worker (Colab / Kaggle / laptop)
```

- `colab_worker.py`: **one cell**. Paste it into a notebook and run it. It keeps running until you stop it.
- `fake_worker.py`: replays a saved area with fake progress, to test the whole flow without Colab.

The worker never prints or saves your keys. It asks for them with hidden input and keeps them in memory only.

---

## 1. Shared Drive folder (pipeline + weights)

A fresh Google account needs nothing except a link to this folder. Share it as "Anyone with the link can view".

```
<shared folder>/
  geo_cascadia/                        ← copy of pipeline/geo_cascadia from this repo (the whole package folder)
  training_runs/v8s_640_s2/weights/best.pt    ← the YOLOv8s detector
  crops_building_v1/w1236978105.jpg    ← the two floor-count example photos (1 storey, 2 storeys)
  crops_building_v1/w1247744938.jpg
  models/use_router.joblib             ← the local building-use router (optional: without it every building goes to
                                         the cloud model, which costs more)
```

**Important: update the package after every pipeline change (now: D53, package 0.2.1 — the area stage asks the app for map data).** With an older copy the worker
stops at once and says so.

- **Colab with your setup cells (S0):** S0 takes the newest zip in `/MyDrive/alldataset`, deletes
  `/MyDrive/alldataset/geo_cascadia_pkg` and extracts the zip there. The zip's entries must be
  `geo_cascadia_pkg/geo_cascadia/<file>.py`. Build it from the repo root and upload the file to `/MyDrive/alldataset`
  (S0 picks the newest zip):
  ```powershell
  backend\.venv\Scripts\python tools\build_pkg_zip.py     # writes geo_cascadia_pkg_p7c.zip and checks every entry name
  ```
  It contains every `.py` file of `pipeline/geo_cascadia` (no `__pycache__`), and the tool fails if any entry is not
  under `geo_cascadia_pkg/geo_cascadia/`. Then restart the runtime and run S0, S1a, S1ba and S1bb again.
- **Shared Drive folder (Kaggle, another account):** copy the whole `pipeline/geo_cascadia` folder over the
  `geo_cascadia/` folder shown above.

PaddleOCR and CLIP download their own models on first use (internet needed, a few hundred MB).

---

## 2. Start the app side (laptop, every session)

Three terminals, from the repo root:

```powershell
# 1. API
cd backend; .venv\Scripts\python -m uvicorn app.main:app --port 8000

# 2. web app
cd web; npm run dev                      # http://localhost:5173

# 3. tunnel: a new https URL every time it starts
cloudflared tunnel --url http://127.0.0.1:8000   # 127.0.0.1, not localhost: on Windows localhost can resolve to IPv6 (::1) and the tunnel answers 502
```

Copy the `https://….trycloudflare.com` address that cloudflared prints. The worker token is `WORKER_TOKEN` in
`backend/.env`.

No CORS or Maps-key change is needed: the worker talks to the API server-to-server, and your browser stays on localhost.

---

## 3a. Colab (GPU)

1. Runtime → Change runtime type → **T4 GPU**.
2. Run your setup cells **S0** (install package), **S1a** (deps), **S1ba** (keys) and **S1bb** (config; worker/colab_setup_cells.md). They define `cfg` and `run_area`.
   - S1a needs these lines. They fixed the OCR crash of the real run (D37, D39):
     ```
     !pip install -q "transformers==4.57.6"
     !pip uninstall -y tensorflow tf-keras tensorflow-hub
     %env USE_TF=0
     %env TRANSFORMERS_NO_TF=1
     ```
     Why: transformers 4.x loads TensorFlow whenever it is installed (Colab has it pre-installed), and TensorFlow
     crashed Paddle (sign reading) with a segfault, even on CPU. After changing S1a, use Runtime → Restart session, then
     run S0, S1a, S1ba and S1bb again.
   - At start the worker prints the transformers version and warns if it is not the tested one. If TensorFlow is
     installed it warns and prints the exact fix.
3. New cell: paste all of `worker/colab_worker.py`, then run it.
4. Answer the questions:
   - *Pipeline + weights*: press **Enter** to use the setup cells, or paste the shared Drive folder link.
   - AWS access key id / secret / session token (hidden).
   - Google server key (hidden; Enter keeps the one from S1b).
   - Backend URL: the tunnel address from step 2.
   - Worker token (hidden).
5. It prints `Worker ready on GPU … Waiting for a street…`. In the app the top bar shows **Worker · GPU**.

## 3b. Kaggle (GPU)

1. New notebook → Settings → Accelerator **GPU T4 x2** (or P100), **Internet on**.
2. No setup cells are needed. Paste `colab_worker.py` into one cell and run it.
3. At *Pipeline + weights* paste the **shared Drive folder link**. The worker downloads it once, offers to install the
   missing packages (answer Enter = yes), then asks for the keys, URL and token as above.

## 3c. Laptop CPU

Use a separate Python environment. The pipeline packages are large, so don't use the API's `.venv`.

```powershell
py -3.12 -m venv C:\gc-worker; C:\gc-worker\Scripts\activate
pip install requests gdown
python -c "exec(open('worker/colab_worker.py', encoding='utf-8').read())"
```

- At *Pipeline + weights* give a local folder with the layout of §1. You can use the repo's `pipeline` folder plus the
  weights copied next to `geo_cascadia/`, or the Drive link.
- The backend URL can be `http://localhost:8000`; no tunnel is needed on the same machine.
- On a CPU, sign reading runs in **fast mode** (a few sign crops per building). The worker says so, and the app shows
  **CPU** and the CPU time estimate.
- Only 8 GB RAM: close the browser tabs you don't need while it runs. YOLO, PaddleOCR and CLIP together use several GB.

**CPU dry run, one short street.** With the API and web app running, start the worker as above with backend URL
`http://localhost:8000`. In the app, click Analyse and choose a short street (under ~300 m; drag the end dots to trim a
longer one). The confirm sheet shows the CPU estimate: about 11 min for 282 m with full sign reading, 2–3 min with fast
sign reading. Start it and watch the job card: Finding Street View → … → Saving results. When it finishes, the map flies
to the new area. Check its Hood page (Time and cost shows this run's own minutes and photo count), then delete it from
Jobs.

## 3d. Interrupted streets: same account vs another account

**Saved progress (Colab with Drive mounted).** While a street runs, the cell copies that job's folder to
`MyDrive/gc_worker_jobs/<job id>/` after every stage, and once a minute during long stages. The folder holds the run's
files and the photo crops. When the street finishes or is cancelled, the folder is deleted. Turn this off with
`SAVE_TO_DRIVE = False` at the top of the cell.

- **Same Google account** (Colab disconnected, runtime restarted, cell stopped):
  1. Run the setup cells and this cell again.
  2. The street shows **Interrupted** after ~2 minutes, then the worker picks it up.
  3. It copies the saved folder back and **continues from the last finished stage**. Photos already looked at are not
     bought again.
  4. The job card says "Continuing from the saved progress".
- **Another Google account** (Colab limit reached):
  1. Stop the cell. The app shows **No worker** within ~45 s.
  2. Start the cell in the other account (3a, or 3b with the Drive link). The tunnel URL is unchanged if cloudflared
     kept running.
  3. That account cannot see the first account's Drive, so the street **starts again from the beginning**. Street View
     photos already bought are bought again.
  4. The job card says so: "Started again from the beginning: this worker has no saved progress for this street".
- **Kaggle / laptop:** there is no Drive mount, so the same rule as another account applies. The laptop keeps its own
  `~/gc_jobs/<street>` folder, so restarting the cell on the same laptop continues from it.

---

## While it runs

- **Heartbeat** every 15 s. The top bar shows *Worker · GPU/CPU* and the street's progress.
- **One street at a time.** The app refuses a second street while one is queued or running.
- **Cost cap**: each job queued by the app carries its own cap (backend `JOB_COST_CAP_USD`, default **$2**, P7.2) and
  the rates the app's estimate used; the cell's `MAX_USD_PER_JOB = 2.00` applies only to jobs without one, and
  `MAX_PHOTOS_PER_JOB = 300` still applies. After planning the camera stops, and before any photo is bought, a larger
  street pauses as **Needs approval**. Approve it on the Jobs page (or
  on the job card); the next worker that asks for work runs it with the cap lifted for that street.
- **Google check**: at most `PLACES_PER_DAY = 300` look-ups per day on this machine, counted in `gc_jobs/places_<date>.json`.
- **Cloud-AI keys expired**: the job shows **Paused: key expired**. The cell asks for new AWS keys and then continues
  **the same street** from its saved files. Nothing already done is lost.
- **Cancel** (job card or Jobs): the job shows **Cancelling…**. The worker stops at its next heartbeat (≤ 15 s),
  deletes that street's saved files (Drive and local) and reports back; the job then shows **Cancelled**. If the worker
  is gone, the cancel completes by itself after ~2 minutes. A cancelled or failed job can be **removed from the list**.
- **Tunnel restarted** (new URL): after 3 failed calls the cell asks *"Paste the new tunnel URL"*. Paste it; there's no
  need to restart the cell.
- **No Street View / no road / no camera stops**: the job ends as *No Street View* with the reason. The worker waits
  for the next street.
- Stop with ■ (Colab/Kaggle) or Ctrl+C (laptop).

---

## Test without Colab: fake worker

It needs the API running (§2, no tunnel needed). It uses the API's own `.venv`.

```powershell
# 1. in the app: Analyse → click a street → Start analysis   (the job card says "Queued, waiting for a worker")
# 2. then:
backend\.venv\Scripts\python worker\fake_worker.py                       # replays Tiruppur in ~40 s
backend\.venv\Scripts\python worker\fake_worker.py --replay ward29 --seconds 90
backend\.venv\Scripts\python worker\fake_worker.py --simulate needs-approval   # then Approve in the app, run again
backend\.venv\Scripts\python worker\fake_worker.py --simulate expired          # run again without --simulate: resumes
backend\.venv\Scripts\python worker\fake_worker.py --simulate no-street-view
backend\.venv\Scripts\python worker\fake_worker.py --simulate die             # stops mid-job → "Interrupted" after 2 min
```

The fake worker turns the job into a **test job**. The area is named "<street> (test)", and its Under the Hood page
says it is a replay.

- Remove every test run and its area in one go: **Jobs → Clear test jobs…**. It lists them first and shows "Deleting…"
  while it works. Real analyses and the three original areas are never included.
- Or delete one area with **Jobs → the job → Delete this analysed area…**.
- Cancel while it runs: the fake worker stops within a few seconds, like the real one.
- `--simulate needs-approval` computes the estimate exactly as the real worker does, from the **replayed run's own
  camera plan** (Tiruppur: 78 photos, about $0.55). That replay is under the 300-photo cap, so the fake lowers the cap for
  itself and prints that it did. A real worker uses the camera plan of the clicked street.

## Retry after a failure (D37)

A job that fails with an error keeps its progress: on Drive (`MyDrive/gc_worker_jobs/<job id>/`) and in the session.
Press **Retry** on the job card or the Jobs page. The same job is queued again, and the worker continues from the
saved stages without fetching Street View photos again. Progress is deleted when the job finishes, is cancelled or is
removed from the list. On start, the worker asks the backend which saved folders are still needed.

## Sign reading crashes (D38)

Sign reading (OCR) runs in its own process. If that process crashes, the worker carries on: it prints the cause and
a `[mem]` line, then tries once more. After a second crash on the GPU it switches to CPU quick mode (at most 3 signs
per building), and the job card says so. Signs already read are kept.

At start the worker offers an **OCR self-test** (Enter = yes). It loads the sign reader, reads one test image, then
frees the memory. Set `OCR_SELF_TEST` at the top of the cell to `True` or `False` to stop being asked.

`[mem]` lines at every stage show RAM and GPU use. When a Colab session restarts, the last `[mem]` line shows how close
it was to the limit.

## Google key and map-server problems (D39)

- **Browser key given to the worker.** Places answers 403 "Requests from referer <empty> are blocked" when the key
  given to the worker is website-restricted (the browser key). At start the worker tests the key with one free
  Street View metadata call. If it is a browser key, it says "This Google key only works in a browser; use the
  server key (Enter keeps the one from the setup cells)" and asks again. If this happens during a job, the job card
  shows the same sentence, the worker asks for the key, and **Retry** continues from the saved progress.
- **OpenStreetMap (Overpass) busy.** If the map server is down at the area stage, the worker retries by itself after
  30 s, 60 s and 120 s. The card shows "Map server busy (OpenStreetMap), retrying…". The run continues from its saved
  stages, so no photo is bought again. After the last try the job fails, and Retry is available.

## "No Street View" or a request error? (D40)

The job ends as **No Street View** only when Google answered "no imagery here" for every point it searched. If Google
refused or failed the look-ups, the job **fails with the real cause** on the job card and in the cell, for example:

```
✗ Street View request failed: HTTP 200 REQUEST_DENIED — This API key is not authorized to use this service or API.
  (412 of 412 look-ups). This is not a lack of imagery: the Google key given to the worker is not allowed to use the
  Street View Static API (check that key's API restrictions in Google Cloud Console)
```

- **REQUEST_DENIED:** the cell asks for the Google key again (Enter keeps the setup cells' key). The server key must
  allow **Street View Static API** and **Places API (New)**, plus Geocoding API for road names (D36). Then press
  **Retry**: the search runs again.
- **OVER_QUERY_LIMIT / HTTP errors / network:** fix the quota or billing, or wait, then press **Retry**.
- The key itself is never printed or sent to the app.
