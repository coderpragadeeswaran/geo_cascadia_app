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
                         ▲  jobs table          (+ OpenStreetMap / Microsoft map data of 4 cities, D53)
                         │  cloudflared quick tunnel
                    Colab worker (GPU) — claims a job, runs the pipeline, uploads the results
```

---

## Demo day

### The day before
1. **Warm the map caches** (street lookups, roads for the mini-maps, cost estimates for the demo streets), so clicks
   work even if OpenStreetMap is slow or down on the day. Inside Coimbatore, Trichy, Tiruppur and Madurai the street
   lookups and map data come from the database (D53, see "Map data" below) and never wait for OpenStreetMap; the warm-up
   still matters for the cost estimates (they also ask Google Street View) and for streets outside those cities. Edit the list in [tools/demo_streets.json](tools/demo_streets.json)
   first (one point on each street you may click), then:
   ```powershell
   backend\.venv\Scripts\python tools\warm_osm_cache.py            # retries slow map servers until done; prints the time
   backend\.venv\Scripts\python tools\warm_osm_cache.py --check    # all network blocked: every demo click must say "from the cache"
   ```
   It takes **about 30 min, longer when OpenStreetMap is busy — start it the day before** (1 Oct: 28.4 and 29.4 min;
   most of it is the cost estimates). Run it again if it reports "NOT complete" (finished items are skipped). The caches live in `data/cache/` and survive API restarts.
2. Run the checks below (Tests) once.

### On the day, in this order
0. **Worker files changed in D53 (local map data):** re-paste the worker cell, and upload `geo_cascadia_pkg_p7c.zip`
   (`tools\build_pkg_zip.py`) to `/MyDrive/alldataset` once. The worker refuses an older package.
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

### Regression pass (run it the day before, and again on the morning of the demo)
With T1 (API :8000) and T2 (the production preview on :5173) running:
```powershell
backend\.venv\Scripts\python tools\regression.py            # everything, about 30–40 min; ends with a PASS / FAIL table
backend\.venv\Scripts\python tools\regression.py --quick    # questions, review round trip, estimates, reports: a few minutes
```
It checks the spec and extra questions, a review decision + undo (the review tables must be back exactly as before), the
Analyse estimate for a street inside and outside the local map data (no job is created), PDF + Excel reports for every
area and one street against the app's numbers, every page of every area in both themes with no console errors, the tour,
and the offline cases (it starts and stops two helper APIs on :8001 / :8002 itself). The log and screenshots go to
`docs/screenshots/regression/` (`run-<date-time>.log`). Exit code 1 = something failed: read the FAIL lines.

### If something fails during the demo

| What happened | What the app shows | What to do |
|---|---|---|
| OpenStreetMap slow / down | Nothing changes inside Coimbatore, Trichy, Tiruppur and Madurai (map data from the database). Elsewhere: warmed streets answer at once; any other street shows "Finding street…", then "Map server is busy — try again in a minute." | Click a street inside one of the four cities, or open a saved area |
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

- Python 3.12 venv for the API (repo root; also works from `backend\` with `requirements.txt`):
  `py -3.12 -m venv backend\.venv; backend\.venv\Scripts\pip install -r backend\requirements.txt`. The pipeline package
  (`pipeline/geo_cascadia`) is not pip-installed: the API puts `pipeline/` on its import path (D59).
- Web: `cd web; npm install` (Node 24)
- `backend/.env` (git-ignored; never commit keys): `DATABASE_URL` (Supabase session pooler URI), `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_MAPS_BROWSER_KEY` (referrer-restricted to `http://localhost:5173/*`),
  `GOOGLE_MAP_ID`, `GOOGLE_PLACES_SERVER_KEY` (server key: Street View Static + Places (New) + Geocoding), `WORKER_TOKEN`
  (any long random string), optional `JOB_COST_CAP_USD` (default 2).
- Database: `backend\.venv\Scripts\python backend\migrate.py`, then load each area:
  `backend\.venv\Scripts\python backend\load_area.py data\areas\<slug>`.
- Map data for the four cities (D53; measured 3 Oct: ~20 min to download ~630 MB here, 18 min to load; adds 241 MB to the database):
  `backend\.venv\Scripts\python tools\import_osm_local.py`.
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
npx tsx scripts/d53-shots.ts       # D53 (dev server): Hood map-data line, map attribution, the 50 m dark-stretch question; MODE=daylight
npx tsx scripts/lighting-shots.ts  # D54/D55 (dev server): priority list, stretch card, map colours, priority question, report buttons + real downloads; MODE=daylight
npx tsx scripts/extras-shots.ts    # D58 (dev server): "continues outside this area", GIS downloads, OSM question + map tags, floor confidence, Hood/Trust; MODE=daylight
npx tsx scripts/ui-polish2-shots.ts  # D59 (dev server): street list + full list, photo tags + key, Review questions, a No with a value (undone), OSM; MODE=daylight, TAG=before|after
backend\.venv\Scripts\python tools\audit_numbers.py    # (repo root) Ward 29 numbers straight from the database
```

## Map data (OpenStreetMap + Microsoft footprints, D53)

Roads, building outlines and shop points from OpenStreetMap, and Microsoft's building footprints, are held in the
database for **Coimbatore, Trichy (Tiruchirappalli), Tiruppur and Madurai** (city boundary + 550 m; Tiruppur, which has
no city boundary on OpenStreetMap, a 16 × 16 km box). The street click, the mini-maps, the cost estimate and the
worker's "Reading the map" stage read them from there. Under the Hood shows the snapshot dates; the map footer carries
the attribution (© OpenStreetMap contributors, building footprints © Microsoft, both ODbL).

**Monthly refresh** (one command; ~30 min on this connection, of which ~20 min is the download: it downloads the latest extract and tiles, rewrites only what changed, prints
the database size before and after, and stops if it passes 325 MB = 65 % of Supabase's free 500 MB):
```powershell
backend\.venv\Scripts\python tools\import_osm_local.py --refresh
backend\.venv\Scripts\python tools\verify_local_map.py      # optional: compare with OpenStreetMap's live servers
```

**Outside the four cities** nothing is stored: the app asks OpenStreetMap's public servers (Overpass) as before and keeps
each answer 30 days on disk (`data/cache/streetpick/`), so a second click or run in the same place is fast. When those
servers are down, a street there can't be picked ("Map server is busy — try again in a minute."), and the worker asks
OpenStreetMap / Microsoft itself. `LOCAL_MAP_DATA=0` in `backend/.env` switches the database copy off (everything goes
to OpenStreetMap's servers, as before D53).

## Lighting priority and the area report (D54, D55)

**Which possible dark stretch first?** Each possible dark stretch gets High / Medium / Low and one plain reason
("376 m on a main road, 37 shops and businesses along it"). A fixed points rule, 0–3 each, written down before any result
was seen: **length** (under 120 m = 1, 120–239 m = 2, 240 m+ = 3), **road type** from the OpenStreetMap copy (main road = 3,
connecting road = 2, residential / service = 1, unknown = 0), **shops and businesses within 30 m** (none = 0, 1–4 = 1,
5–9 = 2, 10+ = 3; buildings that are commercial or mixed use or carry a shop name read clearly from their sign (D56),
OpenStreetMap shop / amenity / office points, businesses read from signs with no analysed building). High = 7–9, Medium = 5–6, Low = 0–4. The list opens in this order ("Fix first"; "Longest first" switches), the map's
dark bands get a brighter / wider edge for higher priority, and you can ask "High priority dark stretches". These are
*possible* dark stretches (the lamp detector finds about 43% of lamp heads), so the priority ranks candidates. It needs
the database (not available in offline data mode). Ward 29's table: DECISIONS D54.

**Download report.** "Download report: PDF · Excel" on the area's *What stands out* panel, the "Street report" button on a
street's panel (it opens PDF · Excel · GeoJSON · Shapefile; or `GET /areas/{slug}/report.pdf|.xlsx?street=`). The PDF is a summary for officials (sources with dates,
the key numbers as the app shows them, a map drawn from our own data with © OpenStreetMap contributors, findings,
possible dark stretches by priority, review queue, cost, Gate 1, limits); the Excel file has the same tables. No Google
map or photo is in it: each row links to Google Maps instead. Registers are marked SYNTHETIC throughout. Ward 29 takes
about 4 s once loaded (19 pages since D58; 27 before). Libraries: fpdf2, openpyxl, uharfbuzz (pip only). `tools\build_report_fonts.py` rebuilds the
report's fonts from the app's typeface (only needed if the font changes).

## Report v2, GIS export, OpenStreetMap cross-checks (D58)

**Downloads** (What stands out, or "Street report" on a street): **PDF** (all landscape A4: at a glance, charts, map, what to
do next, method & limits, how sure the counts are — then an appendix with the key columns; Ward 29 19 pages), **Excel** (every
column and row; new columns floor-count confidence, OSM building:levels, "in OpenStreetMap"; a new sheet "OSM shops"),
**GeoJSON** and **Shapefile** (zipped; buildings with findings as outlines, poles and streetlights, possible dark stretches as
lines, review items, businesses vs OpenStreetMap; WGS84 with .prj; `fields.csv` maps the 10-character field names to the
Excel columns). `GET /areas/{slug}/report.pdf|.xlsx|.geojson|.shp.zip?street=`. Render a report to PNG pages:
`backend\.venv\Scripts\python tools\render_report.py ward29 [--street "Sathy Main Road"]`.

**OpenStreetMap as a real reference** (not an official register; it never changes our results): our businesses vs
OpenStreetMap's shop points along the analysed streets (Under the Hood, Trust, the question "Businesses not in
OpenStreetMap", the report). Pairs within 25 m are "near each other (location only)": Ward 29's 9 pairs share no name
(D59). OpenStreetMap's building:levels shows in the building card only where the building has the tag (Ward 29: 2 of 381). The names
and tags come from one OpenStreetMap look-up per area (free, no Google call), saved in `data/areas/<slug>/osm_tags.json`:
```powershell
backend\.venv\Scripts\python tools\fetch_osm_tags.py          # areas without the file (new worker areas fetch it themselves)
backend\.venv\Scripts\python tools\fetch_osm_tags.py --all    # refresh all (e.g. after the monthly map refresh)
```

## Review: how to answer (D59)

Each item asks one question in plain words, e.g. "Is there a building here that's missing from the register?", "The register
says 1 floor, the photo suggests 2 floors. Is the photo right?", "Does this building have 2 floors?", "Does the orange box show
this building?". Answer **Yes** (key **A**) or **No** (key **R**). Yes = the finding is right (stored as approved); No = it is
not (rejected). After a No on a question about a value (floors, use, a sign's name), a box asks for the right value and an
optional note (**Enter** saves). The value is saved with your answer as "Reviewer says: …" in the drawer, the report, Excel
and GIS; the AI's value and the register are never changed. **E** = not sure: send back with a note (and a photo).
**U** = undo (it also removes a corrected value). One line under the buttons says what was saved.
The photo: the orange box is the item; small tags mark the other boxes (B building, P pole, S sign, L streetlight;
light-orange = part of this building); the key under the photo lists them; hover a tag or a key line for the confidence.

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

Registers are synthetic demo data. Prototype — imagery © Google. Map data © OpenStreetMap contributors (ODbL);
building footprints © Microsoft (Global ML Building Footprints, ODbL).
