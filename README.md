# GEO-CASCADIA

A city official picks a street on a map. The app pulls Google Street View imagery for it, finds buildings, poles,
streetlights and shop signs with small local models (YOLO, PaddleOCR), sends only uncertain cases to a cloud model
(Amazon Nova Lite), compares everything with a property / asset register (**synthetic, demo data**) and shows what is
missing, changed or wrong — each finding with its Street View evidence and a review workflow. Ward 29, Coimbatore is the
pre-computed showcase; any other street can be analysed on demand by a Colab GPU worker.

- Product spec: [CLAUDE.md](CLAUDE.md) · decisions: [docs/DECISIONS.md](docs/DECISIONS.md) · design: [docs/DESIGN.md](docs/DESIGN.md)
- How it all works, in plain words: [docs/explainer/00_START_HERE.md](docs/explainer/00_START_HERE.md)
- Worker and Colab: [worker/README.md](worker/README.md), [worker/colab_setup_cells.md](worker/colab_setup_cells.md)

```
web (React, :5173) ──> API (FastAPI, :8000) ──> Supabase Postgres + PostGIS
                         ▲  jobs table
                         │  cloudflared quick tunnel
                    Colab worker (GPU) — claims a job, runs the pipeline, uploads the results
```

---

## Demo day

### The day before
1. **Warm the map caches** (street lookups, roads for the mini-maps, cost estimates for the demo streets), so clicks
   work even if OpenStreetMap is slow or down on the day. Edit the list in [tools/demo_streets.json](tools/demo_streets.json)
   first (one point on each street you may click), then:
   ```powershell
   backend\.venv\Scripts\python tools\warm_osm_cache.py            # retries slow map servers until done; prints the time
   backend\.venv\Scripts\python tools\warm_osm_cache.py --check    # all network blocked: every demo click must say "from the cache"
   ```
   It takes **about 30 min, longer when OpenStreetMap is busy — start it the day before** (1 Oct: 28.4 and 29.4 min;
   most of it is the cost estimates). Run it again if it reports "NOT complete" (finished items are skipped). The caches live in `data/cache/` and survive API restarts.
2. Run the checks below (Tests) once.

### On the day, in this order
0. **Worker files changed in P8:** re-paste the worker cell, and upload `geo_cascadia_pkg_p7b.zip`
   (`tools\build_pkg_zip.py`) to `/MyDrive/alldataset` once.
1. **Fresh AWS keys.** Open the AWS access portal and copy new SSO credentials (access key id, secret, session token).
   They expire after a few hours, so take them just before the demo and put them in the Colab secrets.
2. **T1 — API** (repo root):
   ```powershell
   backend\.venv\Scripts\python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
   ```
   **Start it early and open the app once** before the audience arrives: the first load after an API restart reads
   every area from the database (~18 s); after that pages answer in under a second.
3. **T2 — web: use the production preview for the demo, not `npm run dev`.** The preview is the build that was
   measured (JS heap 22–46 MB); the dev server uses about three times the memory (D3) on the 8 GB laptop.
   ```powershell
   cd web; npm run build; npx vite preview --port 5173 --strictPort     # http://localhost:5173
   ```
   `npm run dev` is for development only (and for `web/scripts/screenshots.ts`, which needs the dev-only map hook).
   Port 5173 matters: the Maps browser key is restricted to it, and the API only accepts calls from it.
4. **T3 — tunnel** (for the worker):
   ```powershell
   cloudflared tunnel --url http://127.0.0.1:8000
   ```
   Use **127.0.0.1**, not `localhost`: on Windows `localhost` can resolve to IPv6 (::1), where the API is not listening,
   and the tunnel then answers 502. Copy the `https://….trycloudflare.com` address it prints (new on every start).
5. **Colab** (T4 GPU): run **S0 → S1a → S1ba → S1bb → the worker cell**
   ([worker/colab_setup_cells.md](worker/colab_setup_cells.md)). In the worker cell press Enter at *Pipeline + weights*,
   give the AWS keys (or Enter to keep S1ba's), the Google server key (Enter keeps S1ba's), the tunnel URL from T3 and the
   worker token (`WORKER_TOKEN` in `backend/.env`). The app's top bar then shows **Analysis on**.
6. **Analyse a street:** Analyse → click a blue Street View line → the sheet shows photos, cost and time → Start.
   A street estimated above the **$2 cap** waits as **Needs approval** before any photo is bought: open **Jobs** and
   press **Approve** (or Cancel). You can also raise the cap in the sheet before starting.
7. The guided tour (**?** on the left rail) walks through the app on the saved data, with or without the worker.

### If something fails during the demo

| What happened | What the app shows | What to do |
|---|---|---|
| OpenStreetMap slow / down | Warmed demo streets answer at once; any other street shows "Finding street…", then "Map server is busy — try again in a minute." | Click a warmed demo street, or open a saved area |
| Colab / worker not running | Top bar "Analysis off"; a new street waits as "Queued. The analysis computer is not connected yet" | Show the saved areas; start the worker cell — it picks the queued street up |
| Tunnel down or restarted | Same as worker offline; a running street shows "Interrupted" after ~2 min | Restart T3, paste the new URL when the worker cell asks ("Paste the new tunnel URL"); it continues from the saved progress |
| AWS keys expired | The job shows "Paused: key expired" | New keys from the portal; the worker cell asks for them and continues the same street |
| Supabase unreachable | "Offline" badge; everything readable from the saved files; reviews and new analyses say "Offline — read-only" | Carry on with the saved areas; it reconnects by itself |
| Google browser key / Map ID missing | "The map can't be shown", with links to Review, Under the Hood, Trust and Jobs, which still work | Fix `GOOGLE_MAPS_BROWSER_KEY` / `GOOGLE_MAP_ID` in `backend/.env`, restart T1 |
| Google server key missing | The sheet says the cost can't be estimated (warmed demo streets keep their estimate); Start still works | Fix `GOOGLE_PLACES_SERVER_KEY` in `backend/.env`, restart T1 |
| API stopped mid-demo | Banner "The API isn't answering … What is on screen stays" | Restart T1; the banner clears on the next call |

Not tested: the laptop with no internet at all (Google's map script and Supabase both need it).

---

## First-time setup

- Python 3.12 venv for the API: `py -3.12 -m venv backend\.venv; backend\.venv\Scripts\pip install -r backend\requirements.txt`
- Web: `cd web; npm install` (Node 24)
- `backend/.env` (git-ignored; never commit keys): `DATABASE_URL` (Supabase session pooler URI), `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_MAPS_BROWSER_KEY` (referrer-restricted to `http://localhost:5173/*`),
  `GOOGLE_MAP_ID`, `GOOGLE_PLACES_SERVER_KEY` (server key: Street View Static + Places (New) + Geocoding), `WORKER_TOKEN`
  (any long random string), optional `JOB_COST_CAP_USD` (default 2).
- Database: `backend\.venv\Scripts\python backend\migrate.py`, then load each area:
  `backend\.venv\Scripts\python backend\load_area.py data\areas\<slug>`.
- Colab package: `backend\.venv\Scripts\python tools\build_pkg_zip.py`, upload the zip to `/MyDrive/alldataset`.

## Tests

```powershell
cd backend; .venv\Scripts\python -m pytest -q          # API, loader, worker protocol (tests use their own test area and test jobs)
cd web; npm run typecheck; npm run build; npm run test:ui; npm run check:data
```

Live checks (API on :8000 and the app on :5173; Playwright screenshots under `docs/screenshots/`):

```powershell
cd web
npx tsx scripts/tour-shots.ts      # the guided tour, both themes, every step; first visit opens it once
npx tsx scripts/audit.ts           # every page in both themes, keyboard (Tab, Esc, Ctrl K), the numbers the UI shows
npx tsx scripts/heap.ts            # production build only: JS heap after GC (target ≤ 60 MB)
npx tsx scripts/offline.ts         # fallbacks; needs extra APIs on :8001 (outgoing requests blocked) and :8002 (no Google keys)
npx tsx scripts/gate1-shots.ts     # Gate 1 per building in the drawer (dev server): the three cases, a corner, Trust › Gate 1; MODE=daylight
npx tsx scripts/p8-shots.ts        # P8 screens (dev server): Routing and cost, photo dates, front wall, dark stretches, Tamil; MODE=daylight for Daylight
backend\.venv\Scripts\python tools\audit_numbers.py    # (repo root) Ward 29 numbers straight from the database
```

## Field check: the review queue as a walking route

```powershell
backend\.venv\Scripts\python tools\review_route.py ward29     # waiting items -> data/exports/review_route_ward29.csv / .geojson
```
Stops in walking order (nearest next, then 2-opt), with a Google Maps link each; distances are straight lines, so the
real walk is longer. `--all` includes decided items.

## Street View imagery (Google terms)

No Street View photo is stored by the API or in `data/`. The worker keeps photo crops only while a job runs and
deletes them once the result is delivered (it prints how many). Local screenshots in `docs/screenshots/` (git-ignored)
can show Street View photos: delete them when no longer needed. Details: explainer 04 §6.9.

Registers are synthetic demo data. Prototype — imagery © Google.
