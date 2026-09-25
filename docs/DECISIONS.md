# Decisions log

Owner decisions that refine or override CLAUDE.md. Newest at the bottom. **Read before any work.**

## 2026-09-25 — after P0 orientation (confirmed by owner)

### D1. Run timings and cost (Q1)
The owner does not have the original full-run logs. `stage_seconds`, `total_minutes`, `street_view_requests`,
`places_calls` and (Trichy/Tiruppur) `vlm_calls` in `export.json` / `dashboard.json` / `run_report.json` come from
**resumed** pipeline runs, so they are not real full-run values (e.g. the Ward 29 export says 3.3 min; model_card says 11.5 GPU min).

- **Ward 29 cost/time:** comes from `data/model_card.json` → `cost_time`, labelled **"from model_card"** in the UI.
- **Stage timings** (from `dashboard.json` / `meta.run`, all areas): shown only with a **"resumed run, not representative"**
  badge. No Gantt or cost waterfall that implies they are real. That chart renders **greyed out** with the badge.
- If the owner later supplies the original logs, this rule is replaced.

### D2. Number conflicts
- **Countable facts** (triangulated assets, local-vs-VLM use-router split, building/asset/queue counts, route counts, …)
  are **computed from `export.json` records** (`backend/app/derived.py`). They are never copied from `story[]` text,
  `meta.run` counters or other stored strings.
- Mismatches (field, stored value, computed value, source) are listed on the **Trust page** ("data consistency").
  Known at P0 (from `python tools/p0_setup.py`):
  - Ward 29: `buildings_use_local/vlm` stored 193/73 vs 163/58 from per-building routes (also in model_card `full_ward29_run`).
  - Ward 29: run_report/story "29 triangulated / 239 approximate" vs 20 / 248 with `method=triangulated`
    (29 = assets seen by 2+ cameras).
  - Trichy: run_report `use_route` tier3_vlm 44 vs 41 exported.
- **Accuracy / evaluation metrics** come **only** from `model_card.json`. Floors validation uses **n=36**
  (not the n=33 in per-building `validated` strings).

### D3. Performance
- The "≤ 60 MB" target (CLAUDE.md §11 P7) means **JS heap ≤ 60 MB idle**, not tab RAM.
- deck.gl / map `devicePixelRatio` capped at **1.5**.
- **Reduce-motion / 2D toggle** (no tilt, no 3D extrusion, no camera animations); also honours `prefers-reduced-motion`.

### D4. Offline data mode
- If Supabase is unreachable or paused, the backend serves **read-only** data from `data/areas/*/export.json`
  (+ `run_report.json`). Writes (review decisions, jobs) return a clear "offline data mode — read only" error.
- The UI shows an **"offline data mode"** badge whenever the backend reports this mode.

### D5. Floors on the Trust page
- The **production** floors method (Nova Lite, 2-image few-shot, route `tier3_vlm_fewshot`) is shown separately from the
  **rejected** 3-example variant and the other rejected variants in `model_card.floors.rejected_variants`.

### D6. Supabase
- PostGIS lives in the **`extensions`** schema, so connections set `search_path=public,extensions`.
- Connect via the **session pooler** (IPv4) URI, not the direct host.

### D7. Technical notes accepted at P0
- `review_queue` asset rows carry no asset id. They link to assets by (lat, lon rounded to 7 dp, `asset_cls` = `type`),
  which is 100% joinable on all three areas.
- Route value `tier3_vlm_fewshot` (floors) is valid in addition to the §4 route values.
- `missing_asset_records[]` shape: `{asset_no, lat, lon, street, why}`, shown as a map layer ("register record, nothing detected").
- Fonts: Inter, with Noto Sans Tamil as fallback (Tamil OCR text appears in the data).

### D8. Toolchain versions (P0)
- Vite **8** + `@vitejs/plugin-react` 6, React **18.3**, TypeScript **5.9**, zod **4**, Node 24, Python 3.12.
- The zod schemas in `web/src/types/*` are the single source for TS types: `strict` for `npm run check:data`, `loose` in the app.
- `tools/p0_setup.py` rebuilds every `run_report.json` and prints the inventory plus the D2 mismatch list.

## 2026-09-25 — P1 (database)

### D9. Unclassified building use is shown, never hidden
- Ward 29: only 221 of 381 buildings have a use value/route; **160 have none** (Trichy 25 of 66). Every place that
  shows building use (KPIs, charts, filters, tables, Under the Hood) shows the gap explicitly,
  e.g. **"use: not classified — 160"**. It is never dropped from a denominator or a chart.
- In the DB, `buildings.use is null` means not classified.

### D10. Schema additions to CLAUDE.md §6 (P1)
- Every object table has `record jsonb` = the full export record, so the API returns the same shape as offline mode (D4).
- Extra tables: `streets` (from `streets.json`: geometry, length, coverage, for street-health colouring) and
  `missing_asset_records` (D7). Extra columns: `areas.polygon_source/computed/consistency/updated_at`,
  `jobs.heartbeat_at`, `review_items.street/geom/discrepancies`, `buildings.google_flags`, `assets.method/street`.
- Area polygon: `data/study_area/Study_area.geojson` when it contains ≥95% of the area's objects (Ward 29);
  otherwise the analysed streets buffered by 40 m (Trichy, Tiruppur). Stored in `areas.polygon_source`.
- Reloads are idempotent and **keep human review decisions**; only pending items that vanished from the export are deleted.
- RLS is enabled on every table with no policies: the backend (table owner) bypasses it, and the public anon key is blocked.
- `Study_area.geojson` had one stray character (`,S[`) that made it invalid JSON; it was removed. No coordinates changed.

## 2026-09-25 — P2 (API)

### D11. API design notes
- **One code path for online and offline.** `DbStore` (Supabase) and `JsonStore` (`data/areas/*.json`) each build the same
  per-area bundle (export.json shape + live review state). Every endpoint computes from the bundle, so shapes and values
  are identical in both modes (pytest compares all three areas). The only differences are DB-only fields:
  review item `id`/`updated_at`/`reviewer`/`note` (null offline).
- **Every JSON response has `"offline": true|false`.** After a DB failure the API serves JSON for 30 s, then retries.
  Writes (review decisions, jobs, worker) return **503 `offline data mode — read only`**.
- **Dashboard is recomputed** from the records with the pipeline's own `workspace.build_dashboard`; `building_use`
  reports `"not classified"` (D9) and `kpi.use_not_classified` is added. `cost_panel` is replaced by `cost`
  (`model_card` block for Ward 29, `run_stats` flagged `run_stats_representative: false` + badge text, D1).
- **§10 "5 spec queries"** = the four free-text queries (tests 1–4) via `/query` + test 5 (click → evidence) via
  `/buildings/{area}/{id}` and `/assets/{area}/{id}`. §10 has no fifth free-text query.
- `why_empty`: QueryEngine's own funnel for building queries; for gaps/assets/review queries the wrapper builds the
  same style of funnel (the engine only produces one for buildings). QueryEngine only has 60 m gaps (§7 input).
- `POST /jobs/preview {lat, lon}` (extra endpoint) resolves the click with `click_to_street` without creating a job —
  for the confirm sheet; it also reports `already_analysed_in` if the point lies inside an existing area.
- Jobs: `expired_token` jobs and `running` jobs with no heartbeat for 10 min are claimable again (resume after key
  refresh / worker crash). Drawn polygons are capped at 1.5 km² per job (`Settings.max_polygon_km2`).
- `PATCH /review/{id}` takes **multipart form** fields (`action`, `note`, `reviewer`, optional `photo`) so one call can
  carry a photo. Appeals need a note. Photos: jpeg/png/webp ≤ 8 MB, private bucket, read via
  `GET /review/{id}/photo` (10-minute signed URL).
- DB connections set `extra_float_digits = 3` so coordinates round-trip exactly (the pooler otherwise returns 15 digits).
- Dropped `sqlalchemy`/`geoalchemy2` (unused; plain psycopg 3 with a small fail-fast pool).

## 2026-09-25 — P3 (web foundation + map)

### D12. Map rendering notes
- **deck.gl draws in its own canvas** over the vector map (`GoogleMapsOverlay({ interleaved: false })`); tilt/heading stay
  synced. Interleaved mode (shared WebGL context) rendered **nothing** with deck.gl 9.4 + Maps JS 3.65/3.66 in testing:
  deck reads its size from Google's canvas, which is 0×0 when deck attaches, so it draws a 0×0 viewport. `?interleaved=1`
  re-tests it after library upgrades. Side effect: 3D buildings do not occlude Google's own labels/icons.
- **Maps JS pinned to the `quarterly` (stable) channel.**
- **Extrusion height = observed floors × 3.2 m** — a display scale only, stated in the legend. Buildings with no floor
  count (Ward 29: 160) are **flat + hatched**, never a guessed height (D9). Low-confidence floor counts are drawn faded.
- **Streetlight gaps** — *corrected, see D13.* The P3 note here said Ward 29 `gap60-001` has endpoints 176 m / 195 m
  from every street line. **That was wrong:** the check compared each OSM way piece separately; against the merged
  Sathy Main Road line the ends are 0.5 m / 10.7 m away. Gap display is now computed in the backend (D13).
- **Zoom bands:** city < 13.5 ≤ area < 16.5 ≤ street < 18.5 ≤ object. Auto base map: dark roadmap at city level,
  hybrid satellite below; tilt 45° at street level (not in 2D / reduce-motion mode).
- **Minimap** is an SVG of the area outline + street health + current view (no second Google map, D3).
- **Theme toggle remounts the map** (Maps `colorScheme` is init-only). Measured on the production build, JS heap after GC:
  **21.7 MB** idle (area), **24.8 MB** (street), **40.4 MB** after two theme toggles — within the D3 ≤ 60 MB target.
  Dev-mode numbers are ~3× higher (React dev tooling) and are not the target.
- Asset icon ring colour = synthetic asset-register status (matched teal / discrepancy amber / not in register red /
  unconfirmed slate). Google POI icons come from the Map ID's cloud style (JS `styles` do not apply with a Map ID);
  hide them in Cloud Console → Map Styles if they clutter the demo.
- Places search box is deferred to P4 (it belongs in the top-bar search with the query bar).

## 2026-09-25 — P3 review fixes

### D13. Street names and streetlight-gap display
- **Street names.** `streets.json` keeps raw OSM labels for unnamed ways ("(unnamed residential #907980850)"); every
  building/asset/gap record carries the pipeline's display name from `street_names.json` ("Korathottam Road",
  `run_area.py` `nm()`). The exact-name join matched only 3 of Ward 29's 10 streets and painted 7 streets "healthy"
  (0.0 issues/km instead of 17.9–41.1). Now the loader and the JSON store apply `street_names.json` to the street lines:
  `name` = display name, `osm_name` = raw label (migration 003). All 10/10 join (Trichy 1/1, Tiruppur 1/1); pytest
  asserts it for all three areas. A street with no joined stats is shown **grey "no data"**, never a healthy 0.
- **Gap display** (`backend/app/streetgeo.py`, shared by DB and offline mode; stored in `streetlight_gaps.display`):
  merge the street's OSM pieces (as the pipeline's plan does); if both gap ends lie ≤ 25 m from the merged line **and no
  lit camera stop** (streetlight within interval/2 = 30 m, the pipeline's rule) lies on the road between them → draw
  along the road (`along_road`). If lit camera stops lie between the ends → keep the recorded straight segment in an
  amber dotted **"check"** style with a note (`check`). No line near both ends → recorded straight segment (`straight`).
  Ward 29: 10 along the road, `gap60-006` = check (4 lit stops; longest unlit stretch along the road ≈ 302 m).
- **Gap length.** The recorded `length_m` is always shown (and QueryEngine sorts by it). When the along-road length
  (+ the pipeline's 12 m end padding) differs by > 10 %, the UI adds "≈ X m along the road" and the Trust page's
  data-consistency list gets a row: Ward 29 `gap60-001` 376 → ≈ 424 m, `gap60-003` 313 → ≈ 349 m, `gap60-005`
  203 → ≈ 251 m, `gap60-006` (check row); Trichy `gap60-004` 304 → ≈ 402 m.
- **Low-coverage banner** on the area card when `meta.run.coverage.verdict` is not "full" (Trichy 33 %, Tiruppur 90 % of
  views face no mapped building). View counts come from the run's coverage stats; building/asset/business counts are
  computed from the records (D2).
- **3D switch** is labelled and on by default (storage key `gc.threeD`); OS reduced-motion still starts in 2D (D3).
  Band pills (City / Area / Street / Object) are buttons that fly the camera to that band.
- **Street-health ramp** stops widened to 0 / 10 / 20 / 40 issues per km (was 0 / 4 / 10 / 20): with correct joins,
  Ward 29 streets span 0–41 per km and 8 of 10 would otherwise all be the same saturated red.
- Band-specific deck.gl layers stay mounted and switch with `visible`. The city badge TextLayer is created only once area
  data exists (with no text its font atlas was a 1024×0 canvas → "WebGL: texSubImage2D: no canvas" when the API was slow).
  Production heap after GC re-measured: 22.6 MB (area) · 25.4 MB (street) · 43.4 MB after two theme toggles.

### Pipeline follow-up (not app work)
`match.py` gap length uses a straight-line fit; on curved streets it understates length and can mis-order cameras
(`gap60-006`). Fix in the pipeline later. The app shows the recorded values and flags the difference (D13).
