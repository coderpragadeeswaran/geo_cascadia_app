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

## 2026-09-25 — P4 (Explore page)

### D14. Explore page notes
- **One global store** (`web/src/store/ui.ts`): `filter` (subject, street, match, use, name quality, Google, asset type,
  triangulated, review), `kpi`, `query`. KPI ribbon, map emphasis (everything else dimmed; result dots at area level),
  Findings table and Charts all read it. KPIs, charts and table are computed client-side from the full records with the
  same formulas as `workspace.build_dashboard` (D2); with no filter the ribbon equals the API dashboard (checked).
  Picking a record type in the table (buildings/assets/unmapped) is not a filter and does not dim the map.
- **Editable query chips** still run through the pipeline's QueryEngine: `POST /query {area, filters}` composes canonical
  English (`views.compose_query`), re-parses it with QueryEngine and refuses (422) anything that does not read back to
  exactly the same filters. pytest round-trips every street of every area.
- **why_empty** is rendered as an explained funnel (query card + Findings panel), never an empty table.
- **Gaps (D13 in the UI):** Streetlights tab and query 2 show the recorded length (sorted by it) and "≈ X m along the road"
  only for gaps drawn along the road; `check` gaps show the check note instead of an along-road length.
- **Evidence:** the drawer shows a live Street View Static image (browser key, never stored) of the exact stored view with
  the box drawn in 640×640 space. Assets have no stored box → the aimed view with a crosshair, labelled as such.
  Google place names are fetched live by `place_id` (§9.6), not taken from the stored copy. Route badges quote only
  `model_card.json` (per-building `validated` strings are not shown: they say n=33, model_card n=36).
- **Street View dive** uses the map's own `StreetViewPanorama` (one map instance, D3) with a 250 ms veil cross-fade;
  the minimap draws the panorama camera. Esc / "Back to map" reverses it.
- **Analyse a street:** Street View coverage is shown as the snapping guide (hovering arbitrary streets would need road
  geometry the browser does not have). `POST /jobs/preview` now returns an **estimate** scaled by length from the Ward 29
  run (planned views per metre; GPU minutes and $/image from model_card; VLM calls not included). New
  `POST /jobs/{id}/cancel` (→ failed "cancelled by user", never claimed again); `/worker/result` rejects non-running jobs.
- **Review page (lean):** list + evidence + A/R/E/J/K; "Send N to Review" opens it filtered to those items (test 3).
  P5 turns it into the full split view.
- **Places search** lives in the Ctrl+K palette (Places API New, session tokens, "powered by Google").
- Light-theme status colours use darker steps (#0d9488 / #d97706 / #e11d48) — validated with the dataviz palette check
  (CVD separation and ≥ 3:1 contrast on white); the dark theme keeps the brighter ones (contrast passes on the dark surface).
- Recharts and the Review page are lazy-loaded. Production heap after GC: 22.3 MB (area) · 28.7 MB (street) · 46.9 MB
  after two theme toggles (D3 ≤ 60 MB).
- DbStore version check relaxed from 5 s to 20 s (writes in this process invalidate immediately; a CLI reload shows
  within 20 s) — cuts pooler round-trips, e.g. `/jobs/preview` from ~3.3 s.

## 2026-09-26 — Design pass B (Night Survey applied to the app)

### D15. Design system and shell
- **Night Survey is the app's design system** (docs/DESIGN.md; tokens in `web/src/design/tokens.ts`, the only palette).
  `applyMode()` writes the `--ns-*` variables onto `<html>`; the Tailwind colour names (`bg`, `fg`, `muted`, `accent`,
  status colours…) are aliases of those tokens; deck.gl reads the same values. Night is the default (new storage key
  `gc.mode`), Daylight via the rail toggle. Fonts: Anek Tamil + Martian Mono, self-hosted; the Maps JS Roboto
  stylesheet is blocked (`design/fonts.ts`). `/design-preview` stays as the reference route.
- **Shell:** a 64 px left rail (Explore · Review · Under the hood · Trust · Jobs + Night/Daylight). The map is home and
  stays mounted under every page (one map instance, D3). Explore, Analyse and Drive the street are modes of the map.
  Pages have hash routes with section anchors (`#/trust/detector`).
- **At most one panel** (`store/ui.ts` `panelOf`): a selection (evidence) › drive › a question › a key number's list ›
  a selected street › "What stands out". The panel stops 26 px above the bottom so Google's attribution stays visible.
- **Declutter:** five key numbers + More (every `dashboard.kpi` value stays reachable); a findings table without
  horizontal scroll (container-query column priority); one chart per question (a List / Chart toggle in a key number's
  panel, the grouped chart for a "by street" question). Findings density, road colour by findings, Street View coverage
  and the minimap are off by default. The key is collapsed and lists only what is on screen.
- **Area level shows findings only.** Poles, matched buildings and unmapped-business rings appear from street level in
  **both** modes. The preview still showed them faintly at night; this follows the pass-B instruction. Lit roads and
  dark stretches are the area-level read; streetlights glow and fade on after the opening flight.
- **Base map:** Night = the Map ID's dark-mode Cloud style on roadmap only (Cloud dark mode does not apply to satellite).
  Daylight = the light-mode style, with satellite as an option in Layers. Tilt is allowed only at street zoom
  (`tiltInteractionEnabled` follows the band), and extrusion happens only there, so no tilted low-zoom map.
- **Cloud styles:** park, sports-ground, nature-reserve, cemetery and land-cover green is muted in both files. Every rule
  is now checked against Google's schema (`cbms-json-schema.json`, copied into `CLOUD_STYLERS`). The check found one
  invalid rule in the files from pass A: `political.landParcel` has no label stylers, so it is now
  `geometry.visible: false`. **Both files must be re-uploaded.**
- The deck.gl overlay is created one tick after mount (the StrictMode double-mount fix from the preview).
  `tsconfig.app.json`: `baseUrl` removed and `paths` made relative (`./src/*`), the TS 6-compatible form.

### D16. Two audiences: USER screens vs VERIFIER pages (rule for P5–P7)
- **USER screens** (Explore, Analyse, Review, Drive the street): plain language, minimal reading.
  - Findings are sentences computed from the records (`lib/sentences.ts`), e.g. "Korathottam Road: 9 buildings not in
    the register", "376 m of Sathy Main Road has no visible streetlight".
  - KPI and status labels are in plain words (`lib/labels.ts`).
  - No model routes, tiers, confidences or n= values by default.
- Deviation from the brief's wording: streetlight sentences say **"no visible streetlight" / "no streetlight seen"**, not
  "no working streetlight". The detector sees lamp heads in photos; it cannot tell whether a lamp works.
- **"How do we know?"** (`components/HowWeKnow.tsx`) is the one door to technical detail on every finding (building,
  asset, gap row, evidence photo).
  - It shows routes with model_card accuracy, all detection boxes with confidence, triangulated vs approximate with the
    uncertainty, register ids (SYNTHETIC), recorded vs along-road length, and check notes.
  - It is collapsed by default. The last choice is remembered for the session (sessionStorage) and applies to every
    finding.
  - Each links to the matching section of Under the Hood or Trust.
- **VERIFIER pages** are the only place for deep technical content.
  - **Under the Hood:** the pipeline story, in the scroll-story format of preview 07, per area, with anchors
    #imagery … #review.
  - **Trust:** model_card numbers with n; what was tried and dropped; stored-vs-computed mismatches; gap-length checks;
    limits (use not classified, low OSM coverage, single-camera positions, lamps can't be judged working, synthetic
    registers); how questions are answered (no LLM); and the routed vs all-VLM cost panel (§10 test 6 lives here now).
- **P5 builds Review, Under the Hood, Trust and Jobs inside this shell**, and Under the Hood keeps the scroll-story
  format. Pass B ships first versions of all four on real data, so the links and test 6 work. P5 completes them
  (Sankey, stage timeline, cost waterfall, compare runs, benchmark chart).

### D17. Query UX (the rule-based QueryEngine stays; no LLM) — docs/QUERY.md
- `backend/app/queryparse.py` applies cheap synonyms before QueryEngine and reports what was understood and what was
  ignored. It uses a concept check against the parsed filters plus ablation against QueryEngine itself.
- Anything ignored sets `understanding.status` to "partial" or "not_understood" and adds the closest supported questions.
  The UI applies **nothing** to the map until the person accepts or edits, so there is never a silent wrong answer.
- The four spec questions parse exactly as before, with nothing ignored (tested).
- The ask bar shows six example questions (with this area's street names) on focus, plus "Build a question by clicking"
  and "How questions are understood".
- Chips are always visible after a question. "+ Filter" adds use, floors, register, difference, Google,
  chart-by-street and street. The Show chip switches to poles, streetlights, dark stretches or review items.

### D18. Evidence photos and the 360° view
- `GET /areas/{slug}/evidence/{kind}/{id}` reads the run's `detections.json` (plus `ocr.json` for sign views). It returns
  every box on each evidence photo with class and confidence, with the object's own box marked.
  - Ward 29: all 221 building photos and all 166 sign photos match their stored box exactly, as do all 30 business
    signs.
- Asset photos are re-aimed views (fov 60) that the pipeline never ran detection on.
  - Boxes from the same panorama's planned views are projected into them (pinhole model, same camera centre).
  - The pole or lamp box nearest the aimed direction is the asset's (lamp ≤ 12°, pole ≤ 6°).
  - Ward 29: 271 of 298 asset photos get a box (median 0.2° off centre). The other 27 keep a crosshair labelled "not a
    detection".
- User view: the photo with the object's box. "How do we know?" draws all boxes with per-class toggles.
- Live 360°: pins are projected through the panorama's POV and stay attached while looking around or moving.
  - The horizontal field of view is 2·atan(2^(1−zoom)), checked against a sign visible in both the static photo and the
    live view.
  - The deprecated `google.maps.Marker` is not used.
  - Single-camera assets are labelled "approx.", because their pin can sit ~10° off the pole.

### D19. Analyse a street: picker
- `backend/app/streetpick.py` replaces the direct call to `geo_cascadia.picker.click_to_street`. It is a port with the
  same queries, road classes and caps; the pipeline is unchanged.
  - Analysed areas answer from their own streets.json when the click is ≤ 15 m from an analysed street, with no
    Overpass call.
  - Overpass gets one mirror plus one fallback within 14 s. The browser gives up at 18 s with "OpenStreetMap is busy —
    try again".
  - A disk cache holds Overpass answers and resolved clicks (rounded to 4 decimals; partial answers kept 10 min).
  - When Overpass is busy, the nearest analysed street within 60 m is offered with a note.
  - The browser cancels a pending lookup when a new click arrives and shows elapsed seconds.
- Display names:
  - street_names.json for analysed streets;
  - the OSM name elsewhere;
  - an unnamed road is "Unnamed <type> road" (+ "near <named road>"), never "(unnamed residential #…)".
- "Already analysed in <area>" (with Open / Analyse anyway) appears when OSM way ids are shared or ≥ 30 % of the street
  lies within 15 m of an analysed street.
- The confirm sheet draws the exact snapped street (chalk line, sodium ends), distinct from Google's blue coverage. The
  flashlight is switched off once a street is picked.
- **The CPU estimate scales with length.** model_card's "18 min per street" (fast OCR "3–5") is taken per average
  Ward 29 street (4,829 m / 10 = 483 m): 282 m → 11 min (2–3), 1,161 m → 43 min (7–12). The sheet states it as an
  estimate.

### D20. Drive the street
- `GET /areas/{slug}/drive?street=` (`backend/app/drive.py`, reads plan.json) builds the drive as follows.
  - The street's OSM pieces are merged, and each merged piece is its own branch. Sathy Main Road: 803 m with 34 stops,
    111 m with 6, and 37 m with none (not offered).
  - Each stop belongs to the nearest branch, is ordered by distance along it, and is de-duplicated (≥ 4 m apart), so
    every step moves forward.
  - Forward is the road tangent (±8 m) in the travel direction; left and right are ∓90°.
  - Dark stretches, lamps, poles, buildings and businesses are placed by the same along-road distance.
- The preview's jumps and backward flips came from ordering stops along one fitted line and pointing "forward" at the
  next stop. The rules above fix both; tested on Sathy Main Road and the hairpin Sri Ganapathy Gardens 3rd Street
  (headings 160° → 85° → 167° → 256°, no flip).
- UI:
  - "Drive this street" starts from a selected street;
  - the map follows the camera (travel direction up), with a direction arrow and a view wedge;
  - a road-strip scrubber (drag, click, ← →, ▶ Drive) and a forward / left / right view;
  - the next stop's image is preloaded;
  - a billing note in the panel: each stop you stop at loads one Street View image.

### D21. Memory (D3 target ≤ 60 MB JS heap, idle) after design pass B
- Production build, 1366×768, JS heap after GC:

  | state | 3D (default) | 2D |
  |---|---|---|
  | area level, idle | 24.9 MB | 23.4 MB |
  | street level, idle | 42.0 MB | 32.4 MB |
  | evidence panel open (zoomed onto a building) | 59.6 MB | 44.2 MB |
  | after visiting all four pages | 59.8 MB | 44.4 MB |
  | Night → Daylight → Night at close zoom | **91.1 MB** | 54.7 MB |

  Six Night/Daylight switches at area level: 25.1 → 44.5 MB.
- **Why it rose since P4 (street 28.7 MB):** Night is roadmap only (D15). The vector roadmap keeps its tile geometry in
  the JS heap, while P4 used satellite below city zoom (raster, not in the JS heap). A/B check: the pass-A build forced to
  the roadmap measured street 37–45 MB and object 43–51 MB. A tilted view loads tiles toward the horizon: street tilt is
  now 40° and object tilt 42° (`map/camera.ts`); 30° made little difference.
- **Leak fixed:** each Night/Daylight switch remounted the map (Google's colorScheme is fixed at creation), and every old
  map instance stayed in memory (+8–11 MB per switch, unbounded). With vis.gl `reuseMaps` there is one cached map per
  scheme (the camera is restored explicitly). Growth is now ~2.4 MB per switch.
- Switching Night ↔ Daylight while zoomed in held both maps' close-zoom tiles (~91 MB). Parking the cached map (zoomed
  out, 1 px) did not release them, so that was removed.
- Also fixed: Esc did not close the command palette (present since P4).

**Decision (owner, 2026-09-26): accepted.**
- **The target is ≤ 60 MB JS heap in normal use:** area, street and the evidence view.
- A theme switch made while zoomed in may reach ~90 MB. This is accepted, to keep the Night roadmap style.
- **Mitigation (`map/bands.ts` `switchMode`):** a Night/Daylight switch made at street or object zoom first flies out to
  area level, top-down, then switches, so the map left behind holds area-level tiles only. A Street View dive is closed
  first. Used by the rail toggle and the command palette.
- Re-measured, production build, 3D, three runs:

  | state | runs |
  |---|---|
  | area | 24.8–24.9 MB |
  | street | 42.0–43.2 MB |
  | evidence view | 56.3–63.1 MB (around the limit, as before) |
  | Night → Daylight → Night at close zoom | **63.8–73.5 MB** (was ~91 MB) |
  | the same in 2D | 57.4 MB |
  | six switches at area level | 24.8 → 44.3 MB |

**D21 amendment (26 Sep, owner decision).** The evidence view may use **60–63 MB** of JS heap. Four production runs
measured 60.1 / 60.7 / 62.6 / 62.6 MB, against 59–60 MB before the D23 fixes. A heap snapshot at that point shows the
same makeup as the original D21 analysis:
- about 32 MB of object-element arrays (Google's vector-tile data);
- about 15 MB native and 13 MB code;
- our own objects, arrays and strings, about 6 MB, unchanged.

The variation follows how many tiles Google has loaded at object zoom. The tilt is not changed. The other targets stand:
≤ 60 MB for area and street views, ~90 MB accepted for a theme switch while zoomed in.

### D22. Pass B review fixes (readability, D2 counts, review reasons)
- **Type scale +3 px** for reading at 1366×768: micro labels 10.5 → 13, small 12.5 → 15, body 14 → 17, data 11.5 → 14,
  table text ~15.5. Titles (18 → 20), the display size (30 → 32) and KPI figures (24 → 26) grow by 2 px. KPI labels wrap
  onto two lines so the five numbers still fit; the panel is 420 px. No panel scrolls sideways (checked in the browser).
- **Text contrast ≥ WCAG AA (4.5:1) on every surface, in both modes:**

  | mode | ink2 | ink3 | sodium (text) |
  |---|---|---|---|
  | Night | `#bec4d9`, ≥ 9.9:1 | `#9098b5`, ≥ 6.0:1 | unchanged |
  | Daylight | `#3d4356`, ≥ 8.6:1 | `#5b6070`, ≥ 5.5:1 | `#9c4e07`, ≥ 5.3:1 |

  The daylight status palette was re-validated with the new sodium: colour-blind separation still passes (worst ΔE 8.5,
  deutan). The pale "matched" colour keeps its documented outline + label relief.
- **Night map marks** are lifted 18 % toward white: finding dots, footprints and asset status rings. The dots are
  slightly larger with a dark ring, and poles are brighter. The soft v2 hues are kept.
- **Ward outline:** a dark ink core on a light halo in both modes, readable on the dark map, paper and satellite. The
  sodium glow stays at city level. The zoom-level labels got a backdrop so they read on satellite.
- **D2 on Trust:** "Full Ward 29 run" shows the export's counts, **163 local / 58 VLM**. The model_card counter
  (193 / 73, VLM-stage records) is given as a note; the accuracy figures are unchanged. "Stored vs computed" renders
  object values as text ("local 193 / VLM 73" vs "local 163 / VLM 58"); previously "[object Object]".
- **Review reasons follow the finding** (`lib/labels.ts` `reviewReasons`):
  - "high-severity discrepancy" on a no-record building → "Not in the register";
  - on a discrepancy → the actual differences ("Extra floor vs register", "Use differs from register", "Register pin
    in the wrong place", "Bigger than recorded");
  - "attribute discrepancy — verify on imagery" → the attribute differences;
  - the rest are reworded; duplicates are removed.
  This is used on the Review page and in the evidence drawer.
- Memory re-measured after these changes (production, 3D): area 25 MB, street 39–42 MB, evidence 59–60 MB, theme switch
  while zoomed in 70–71 MB (D21 unchanged).

### D23. Browser-walkthrough fixes (15 items)
**Questions**
- **Filler words are neutral.** Grammar and filler (segments, was, were, detected, generate, bar, …) never make a
  question "partial". The spec questions (CLAUDE.md §10 wording and the brief's "street segments … was detected within
  60 metres") and their documented variants run directly. Test: every one parses to the expected filters with zero
  ignored words.
- **Gaps at any interval.** The pipeline computes 40 / 60 / 100 m but exported only 60 m. `backend/app/gaps.py` ports the
  loop from `match.asset_layer`; the pipeline is not modified. The port uses plan.json camera stops per
  (street, carriageway) along an SVD line. A stop is lit when a streetlight is within interval/2, and an unlit run of at
  least the interval (+12 m) is a gap.
  - At 60 m it reproduces every stored gap in all three areas (test).
  - Other intervals are labelled "computed by the app with the pipeline's method (pipeline stored only 60 m)" and
    drawn along the road. Ward 29: 100 m → 7 stretches, 150 m → 3.
  - Without plan.json the answer is `total: null` with a plain note, never 0.
- **One scope.** A typed question that names no street is answered on the street that is selected, shown as a Street
  chip (× removes it). Any question replaces the KPI / street filter with its own street, so the KPIs, map and answer
  count the same thing. A by-street chart covers every street.
- **Google count explained.** "Businesses not on Google" = 34. These are shops (commercial + 1 mixed-use) whose sign name
  was not found on Google within 40 m. In total, 93 named buildings are not on Google (116 named − 23 confirmed); the
  other 59 are not shops (use not known 33, homes 23, other 2, institutional 1). The answer carries this sentence.
- **Any script.** Words are tokenised in any script. An unknown word (e.g. Tamil "கடைகள்") appears under Ignored and
  follows the didn't-understand flow; it is never dropped silently. No Tamil synonyms yet.
- **Loose street names.** Matching ignores case, spacing and punctuation; road ~ rd and street ~ st; the generic words
  (main, road, street, salai) are optional; a distinctive word may be a prefix of the name or the reverse, ≥ 4 letters
  (sathy ~ sathyamangalam). The matched span is rewritten to the full name for QueryEngine and shown ("Street: read
  ‘sathy road’ as Sathy Main Road"). If the words fit two streets equally ("ganapathy gardens"), there is no guess.
- **Ask bar = the question being answered.** Chip edits rewrite it; closing the question clears it.

**Offline flicker**
- The 10:08–10:09 "Offline" could not be traced in the logs: that API ran in a terminal whose output was not kept.
  The code path points to one cause. The Supabase session pooler closes idle connections, and the next request fails on
  the stale pooled connection. Before this fix that failure marked the API offline for 30 s.
- Now:
  - a failure on a reused idle connection is retried once, quietly, on a fresh connection;
  - every fallback logs one line with a secret-free reason, e.g. `database unavailable - OperationalError on a reused
    idle connection: the server closed the connection (Supabase pooler idle timeout) - serving the offline JSON copy
    (read-only) for 30 s`;
  - recovery logs "database back online".
- While offline, write buttons say **"Offline — read-only"**.

**Map / Analyse**
- **Flashlight.** Google's coverage tiles are DOM images in their own pane. That pane gets a CSS mask: a 150 px circle
  at the pointer, at every zoom. The pane is hidden once a street is picked, and restored when you leave Analyse. The
  tiles are Google's own, clipped, never re-hosted.
- **Trim.** The picked street's end dots can be dragged, or moved with the arrow keys (±10 m, Shift ±50 m). They are
  DOM handles placed with the map projection, so the map doesn't pan while you drag. They snap to the street's main
  piece; the kept stretch is bright and the rest faint.
  - The estimate updates live (`POST /jobs/estimate`, same rule).
  - `POST /jobs` takes the stretch (`lines`); the backend checks it lies on the street (≤ 8 m), is at least 20 m, and
    rebuilds the job polygon with the pipeline's 45 m buffer.
  - The picked street is framed above the confirm sheet.
- **Evidence labels.** Greedy placement (`lib/labelLayout.ts`) keeps every label inside the photo and above the caption,
  with no overlaps. Target labels are placed first. Each label tries above, inside-top, below, then inside-bottom of its
  box, then stacks further out.

**Review / Jobs**
- **Review saves.**
  - Profiled: 3–5 s → 0.3–0.5 s per decision. One SQL statement updates the item and the object's review_status and
    returns the new cache version. The cached area is patched in place, not reloaded.
  - The UI patches its caches instead of refetching.
  - "Saving…" shows at once; buttons and keys are locked until the answer arrives. The page advances only on success,
    to the next item still waiting, then shows "Approved ✓ · Undo" (U / Ctrl+Z; `action=reset` → pending).
  - Root cause of the skipped items: a key press between a save returning and React re-rendering re-decided the
    previous item. The current item is now read from a ref that moves to the next item before the lock opens.
  - Tests: pytest (four decisions → exactly those four items, then undo); browser (four fast presses → one decision;
    four accepted presses → the first four waiting items, none skipped).
- **Cancelled jobs** show "Cancelled" in a neutral colour; "Failed" stays red for real failures.

**Polish**
- **Plurals** go through one helper (`lib/utils.ts` `plural` / `noun`; `queryparse.plural` in the backend). Tests: UI and
  pytest.
- **Map banners** (coverage notice, Analyse and Drive hints) have a backdrop in both themes.
- **Zoom label.** It showed "from 15.8" because Chrome's auto-translate read the label "z 15.8" as Polish ("z" =
  "from"). The label is now "zoom 15.8", and the app sets `translate="no"`.

### D24. Review history and single-item Undo
**What happened.**
- The app never ran a bulk update: the old Undo sent `action=reset` for one id. Reproduced: three approvals, then Undo;
  only that one item changed in both the UI and the DB.
- Decisions were nevertheless lost, for two reasons:
  1. Automated checks shared the live review table. The rapid-review browser test's cleanup reset *every* item whose
     status changed during its run, not just its own. It reset #91 (had been rejected or appealed) at 08:07 UTC.
  2. "Undo" meant "set to pending", not "go back to the previous decision". Undoing a second decision on an item erased
     the first one. #92 had been approved at 07:14 UTC and was back to pending at 08:30:21.
- There was no history, so none of this could be seen or restored.

**Now.**
- **`review_events`** (migration 004) is append-only: a trigger refuses UPDATE and DELETE, and there are no foreign
  keys, so it outlives items and areas. Each row holds: item, area, ref, action (approve / reject / appeal / undo),
  status after, previous status / reviewer / note / photo, reviewer, note, `undoes`, time.
- Each decision writes its event **in the same SQL statement** that changes the item, so the history can't miss an API
  change.
- `PATCH /review/{id}` accepts only approve / reject / appeal and returns `event_id`. `reset` is gone (422).
- **Undo** = `POST /review/{item_id}/undo {item_id, event_id}`. The item id must be given twice (path and body) and match;
  the event must be a decision on that item. It restores that item to exactly what it was before that decision (status,
  reviewer, note, photo link) and logs an `undo` event.
  - Refused (409) if the decision was already undone, or a later decision on the item is still live: undo steps back
    newest first.
  - Nothing else is touched.
  - `GET /review/{id}/events` lists an item's history.
- **Tests restore only their own events** (undo, newest first); they never reset by status snapshot.
  - pytest: three items decided (approve / reject / appeal), the last undone: the other two unchanged, the undone one
    exactly as before, nothing else moved. Undo without the item id or with a mismatched id → 422; undo of an older
    decision → 409; stacked undo works.
- **Review UI.** The toast names the item by display name ("Commercial · 2nd Street, Gandhi Nagar") and Undo sends that
  item's id and event id. "Undone: …" shows only while that item is on screen. The header shows the live "N waiting"
  count, also for a queue sent from Explore ("N sent from Explore · M waiting").
- **Explore drawer.** Its Undo also uses the event id.

**Other walkthrough-2 fixes**
- **Photo labels.** Label widths are measured with the real font (canvas `measureText` of Martian Mono, again once the
  web fonts are loaded) instead of 10.9 px per character. The real width is about 12.6. That gap made text overflow its
  backing rect: overlaps and right-edge clipping. Review and Explore use the same component (`EvidenceViews` → `Boxes` →
  `lib/labelLayout.ts`).
- **Map cards** (`.map-card`): width fits the content, 220–300 px, text wraps, status labels wrap in cards (`StatusDot wrap`).
- **Plurals.** Hover cards, KPI tiles (`KpiDef.one`), the Analyse estimate units, camera counts and "differ/differs" go
  through `noun` / `plural`.
- **Dark-stretch card.** "2 of 3 dark stretches on Uthukuli Road (516 m total)". Ranked longest first from the stretches
  the map shows: stored 60 m, or a question's computed interval. Recorded lengths (D13).

### D25. P4.5 part 1: building positions predicted from camera rays (pipeline + numbers, no UI)
**Why.** FarmwiseAI Gate 1 asks for a predicted building position with error <= 3.5 m. Until now a building's only
position was its OSM footprint centroid (`plan.py`); rays were only used to assign boxes to footprints.

**Pipeline change** (owner request; existing logic and outputs unchanged):
- New module `pipeline/geo_cascadia/buildloc.py`:
  - `building_rays` casts every level (`geom_ok`) building / sign box ray into the footprints with `Area.cast()`.
  - `locate_buildings` groups the rays by the footprint hit (grouping only) and keeps one ray per camera (the
    highest confidence).
    - 2+ cameras >= 30 deg apart: `triangulate_multiview`, uncertainty = largest residual (>= 0.5 m, as for assets),
      method `triangulated`.
    - Otherwise: the best ray's hit on the footprint edge, method `single_ray`, approximate, uncertainty =
      `cfg.single_cam_uncertainty_m` (3.5).
  - `locate_unmapped_buildings`: rays that hit no footprint are crossed pairwise (in front of both cameras,
    >= 30 deg, <= 60 m, same class). Crossings within 3 m are linked. A cluster seen from >= 3 cameras is solved
    and kept if its residual is <= 3 m.
- Hooks for future runs: `run_area.py` saves `building_positions.json`; `export.py` adds an optional
  `predicted_position {lat, lon, method, n_cameras, uncertainty_m, approximate}` per building.
- `lat`/`lon` stay the centroid. The hooks are untested end to end: the laptop has no PIL, and the full run needs Colab.
- `buildloc` avoids scikit-learn (its own single-link clustering) so it also runs on the laptop.

**Laptop recompute:** `tools/p45_building_positions.py`.
- **Inputs:** `detections.json`, `buildings.json` and `building_views.json`, read only.
- **Footprints:** the runs did not keep their footprint set, so OSM footprints were fetched once from Overpass into
  `data/cache/p45_overpass/` (OSM only, as the runs: coverage.json microsoft = 0). No YOLO / OCR / VLM / Street View.
- **Sanity:** every registered footprint is in today's OSM with no geometry change > 0.5 m. Re-casting the pipeline's
  own best view hits the same footprint in 418/418 (Ward 29), 59/59 (Trichy) and 1/1 (Tiruppur).
- **Output:** new `data/areas/<slug>/building_positions.p45.json`. export.json is not changed until approved.

**Results.** "facade" = the distance to the footprint edge the best camera's ray meets. "footprint" = the distance to
the polygon, 0 if inside.

| area | registered | triangulated | single_ray | none | no-footprint points |
|---|---|---|---|---|---|
| Ward 29 | 381 | 171 | 167 (17 had 2+ cameras, angle too small) | 43 | 9 |
| Trichy | 66 | 38 | 15 (7) | 13 | 79 |
| Tiruppur | 1 | 1 | 0 | 0 | 12 |

| area / method | n | to footprint: median / p90 / % <= 3.5 m | to facade: median / p90 / % <= 3.5 m | inside footprint |
|---|---|---|---|---|
| Ward 29 triangulated | 171 | 0.0 / 2.0 / 94.7% | 3.9 / 13.9 / 46.8% | 114 |
| Ward 29 single_ray | 167 | 0 / 0 / 100% (by construction) | 0 / 0 / 100% (by construction) | — |
| Trichy triangulated | 38 | 0.0 / 3.6 / 89.5% | 6.4 / 15.2 / 28.9% | 28 |
| Trichy single_ray | 15 | 0 / 0 / 100% (by construction) | 0 / 0 / 100% (by construction) | — |
| Tiruppur triangulated | 1 | 0 | 30.5 | 1 |

**Findings (not yet accepted as a Gate 1 result):**
1. **No ground truth.** Neither check measures true error. The only labels (`trichy/spot_labels.csv`) are floors and
   use, not positions.
2. **Triangulated points fall inside buildings.** 67% of Ward 29 triangulated points lie inside the footprint, a median
   4.1 m behind the facade. The rays aim at the box centre, which is a different facade point for each camera on a wide
   building, so they cross behind the facade. "Within 3.5 m of the footprint" (95%) flatters this.
3. **Two-camera uncertainty is meaningless.** Two rays always meet exactly, so 85 of 171 Ward 29 triangulations report
   the 0.5 m floor.
4. **`single_ray` is on the facade by construction.** Its distance along the ray comes from the footprint, so the check
   is circular and it is not an independent position.
5. **43 Ward 29 buildings get nothing.** 40 had one planned view; no level box-centre ray reached them.
6. **126 unregistered footprints** also got positions; they are not in the export.

Owner decision needed before part 2: accept, change the aiming point, and / or get ground truth.

### D26. P4.5: building position = the front wall (wall-corner rays); Gate 1 evaluation
**Owner decision.** The target point is on the front wall (facade). No manual labelling.

**Method** (`pipeline/geo_cascadia/buildloc.py` `locate_buildings`, `aim="corners"`, the default):
- Rays are still grouped by the footprint the box-centre ray hits; the footprint is used for grouping only.
- The box's **left and right edges** are triangulated separately across cameras. Edges within 3% of the image border
  count as clipped and are left out. The point is the **midpoint of the two corners**.
- If a corner is clipped in every view, the part-1 box-centre triangulation is used instead:
  `triangulated_centre`, `fallback: "corner_clipped_all_views"`, approximate.
- If both corners are visible but can't be triangulated (< 2 unclipped cameras, or < 30 deg apart): `single_ray`
  with `fallback: "corner_not_triangulable"`. Strict reading of the decision: the centre method is used only for
  clipped corners.
- `single_ray` stays marked `uses_footprint`.
- **Uncertainty is null ("not estimated") whenever a solution rests on exactly 2 cameras.** Otherwise it is the largest
  residual (>= 0.5 m).
- The export hook carries `fallback` and `uses_footprint`.
- Unit tests: `backend/tests/test_buildloc.py`, on a synthetic street with an exact answer.

**Evaluation** (`tools/eval_gate1.py`; any area folder, no hard-coded ids; the same code will score P6 runs). Results
go to `data/areas/<slug>/gate1_eval.json` and `model_card.json` `"gate1_position"` (the last key; the rest of the file
is untouched). References:
- **"vs OSM facade":** distance to the footprint edge whose midpoint is nearest the building's street line.
  - Scored for triangulated points only; `single_ray` is listed as "(uses footprint)".
  - The footprint centroid is scored as a do-nothing baseline.
- **"vs Google pin":** Places API (New) Text Search on the sign text, biased to 50 m around the building. A match needs
  to be <= 50 m away and pass `textmatch.same_business`.
  - Only place_id and distances are stored (`gate1_places.json`).
  - Needs a server-side key `GOOGLE_PLACES_SERVER_KEY` in `backend/.env`. The Maps browser key is referrer-restricted
    and is not used from the server. **Not run yet: no such key on the laptop.**

**Results "vs OSM facade"** (median / p90 / % <= 3.5 m):

| area | method | before (box centre) | after (wall corners) |
|---|---|---|---|
| Ward 29 | triangulated | n=171: 4.07 / 15.4 / 45.0% | n=47: 5.26 / 12.2 / 38.3% |
| Ward 29 | triangulated_centre (fallback) | — | n=34: 5.94 / 18.2 / 35.3% |
| Ward 29 | single_ray (uses footprint) | n=167: 0.0 / 4.9 / 85.0% | n=257: 0.0 / 6.4 / 80.2% |
| Ward 29 | footprint centroid (baseline) | n=381: 7.02 / 14.2 / 7.3% | same |
| Trichy | triangulated | n=38: 7.62 / 16.0 / 23.7% | n=23: 5.70 / 12.3 / 39.1% |
| Trichy | single_ray (uses footprint) | n=15: 0.0 / 5.3 / 80.0% | n=30: 0.0 / 5.3 / 83.3% |
| Trichy | footprint centroid (baseline) | n=66: 9.31 / 23.1 / 6.1% | same |
| Tiruppur | triangulated | n=1: 30.5 | n=1: 26.6 |

**Paired comparison** (the same buildings triangulated before and after):
- Ward 29 (n=47): before 4.07 m / 47% → after 5.26 m / 38%; after is better on 25 of 47.
- Trichy (n=23): before 8.11 m / 17% → after 5.70 m / 39%; after is better on 20 of 23.

**Coverage after the fix** (Ward 29): 47 triangulated + 34 centre fallback, down from 171 triangulated.
- 101 buildings have `corner_not_triangulable` and fall to `single_ray`.
- 62 of the 81 triangulated positions have uncertainty "not estimated" (2 cameras).

**Sanity.** The triangulated corner-to-corner width is a median 0.9x the OSM frontage (Ward 29; 0.73x in Trichy), so
the corners do find walls.

**Owner decision (26 Sep):** the 101 `corner_not_triangulable` buildings stay `single_ray` (no box-centre fallback).

**"vs Google pin"** (run 26 Sep with `GOOGLE_PLACES_SERVER_KEY`: 158 + 51 + 1 Text Search calls; only place_id and
distances are stored).

| area | buildings with sign text | place found <= 50 m (= used) |
|---|---|---|
| Ward 29 | 158 | 24 (15%) |
| Trichy | 51 | 15 (29%) |
| Tiruppur | 1 | 0 |

Median / p90 / % <= 3.5 m vs the pin, after the fix (before in brackets):

| area | method | vs Google pin |
|---|---|---|
| Ward 29 | triangulated | n=4: 24.7 / 37.7 / 0% (before n=13: 18.2 / 38.1 / 0%) |
| Ward 29 | triangulated_centre (fallback) | n=2: 8.1 / 9.0 / 0% |
| Ward 29 | single_ray (uses footprint) | n=17: 12.0 / 36.0 / 11.8% (before n=10: 10.8 / 13.8 / 10%) |
| Ward 29 | footprint centroid (baseline) | n=24: 16.7 / 41.6 / 4.2% |
| Ward 29 | **production rule** (tri >= 3 cameras, else single_ray, else centroid; fixed in advance, not tuned) | n=24 (4 / 19 / 1): 12.0 / 36.0 / 8.3% |
| Trichy | triangulated | n=4: 16.3 / 31.7 / 0% (before n=9: 26.1 / 40.0 / 11.1%) |
| Trichy | single_ray (uses footprint) | n=9: 11.3 / 44.0 / 0% |
| Trichy | footprint centroid (baseline) | n=15: 19.2 / 31.2 / 0% |
| Trichy | **production rule** | n=15 (4 / 9 / 2): 15.3 / 37.4 / 0% |

**Reference check** (distance between the Google pin and the road-facing OSM wall, same buildings):
- Ward 29: n=24, median 7.7 m, p90 21.4 m.
- Trichy: n=15, median 7.1 m, p90 34.1 m.

The two references disagree by more than twice the 3.5 m target.

**Match audit** (sign text vs Google display name; names only):
- Most matches are the right business.
- 4 rest on a generic word ("MILK", "COMPLEX", "AUTOMOBILES", "studio").
- 4 places are matched to two buildings each (UCO Bank, Narmatha Industries, Hindustan Motors, Padmakshi), so at
  least one building in each pair is wrong.
- Correct matches still sit a median ~17 m from the footprint centroid. Google business pins are placed by owners or
  by geocoding, often at the road or entrance, and are not metre-accurate.

**Status.** Gate 1 (<= 3.5 m) is **not met** against either reference. **Neither reference can confirm or refute
3.5 m:**
- the OSM wall is circular for single_ray and disagrees with the pins by ~7 m;
- the pins are ~10-20 m noisy and cover only 24 + 15 buildings.

On the evidence here, the production rule is not better than the footprint centroid against the pin. A 3.5 m claim
needs a reference that is itself accurate to about 1 m (surveyed points, or hand-marked facade points on imagery). The
owner ruled out manual labelling, so this is left open for the owner.

### D27. P4.5 closed: building position by a fixed rule, self-consistency, UI
**No more method tuning or accuracy experiments** (owner). The same code runs for any area and every live P6 street.

**Rule** (`pipeline/geo_cascadia/buildloc.py` `predict_positions`, called by `run_area.py`; `export.py` writes
`buildings[].predicted_position = {lat, lon, method, n_cameras, uncertainty_m}`; the building's `lat`/`lon` stays the
footprint centroid). Every registered building gets one of:
1. **`triangulated`:** the wall corners (left and right box edges, unclipped) triangulate (pairs >= 30 deg apart, in
   front of the camera, <= 60 m) and >= 3 camera positions take part. The point is the midpoint of the two corners.
2. **`wall_hit`:** the highest-confidence camera ray whose first hit on this footprint is its **road-facing** wall. The
   road-facing wall is the edge whose midpoint is nearest the building's street line (`Area.streets` live;
   `streets.json` on the laptop). Uses the map footprint.
3. **`footprint_centre`:** the fallback.

**Plausibility check** (added 26 Sep, owner; `buildloc.py` `PLAUSIBLE_MAX_M = 10`):
- A triangulated point more than 10 m from its own footprint polygon (0 when inside) is rejected. The building falls
  back to `wall_hit`, then `footprint_centre`.
- `predicted_position.reason` stores "triangulation rejected: implausible (X m from footprint)"; it is null otherwise.
  The export now writes six fields: `{lat, lon, method, n_cameras, uncertainty_m, reason}`.
- The reason appears in the method badge's tooltip, and `method_counts` counts `triangulation_rejected`.
- Result: 1 rejection (Ward 29 `w1247745245`, 14.3 m off → wall_hit).
- Tiruppur's single building stays triangulated. Its point is inside its large footprint, 35 m from the centre.

**Uncertainty (self-consistency, a precision measure, not accuracy).**
- For a triangulated building, every camera pair that sees **both** corners unclipped gives its own corner midpoint.
  `uncertainty_m` = the median distance of those pair estimates from the final point.
- It is null when no pair sees both corners, and null ("not estimated") for `wall_hit` and `footprint_centre`.

**Official outputs** (recomputed from the saved run files with `tools/building_positions.py`; footprints from the
cached Overpass pull; no YOLO / OCR / VLM / Street View):
- `data/areas/<slug>/building_positions.json`: the same file a live run saves.
- `export.json` `predicted_position`: the only change to export.json, checked field by field against a backup.
- All three areas reloaded into the database. Review decisions were kept, and row counts match `meta.counts`.
- The experimental `building_positions.p45.json` files and `tools/p45_building_positions.py` are removed; their
  helpers moved to `tools/building_positions.py`.

| area | buildings | triangulated | wall_hit | footprint_centre | self-consistency: n / median / p90 (not estimated) |
|---|---|---|---|---|---|
| Ward 29 | 381 | 38 | 224 | 119 | 21 / 2.46 m / 6.48 m (17) |
| Trichy | 66 | 21 | 28 | 17 | 11 / 3.99 m / 5.45 m (10) |
| Tiruppur | 1 | 1 | 0 | 0 | 0 (1) |

**Evaluation** (`tools/eval_gate1.py` → `model_card.json` `gate1_position`: status "not verified", rule, method
counts, self_consistency, "vs OSM wall", "vs Google pin" with the pin-vs-OSM disagreement). The development tables
(box centre vs corners, D26) stay in `data/areas/<slug>/gate1_eval.json`.
- **Status:** not verified. No reference accurate to ~1 m is available, so a 3.5 m result can't be confirmed or ruled
  out. The evaluation tool is ready for surveyed points.

**UI** (no new map instance):
- **Building "How do we know?":** a small SVG plan in the design tokens (both themes) with the footprint outline, the
  footprint centre (+), the predicted point, the uncertainty circle or "not estimated", and the method badge
  (`labels.ts` `positionMethodLabel`).
- **Main map:** the selected building's predicted point and uncertainty circle at OBJECT zoom (`layers.ts` `pred-unc`,
  `pred-pt`).
- **Trust:** section "Position accuracy — target <= 3.5 m (FarmwiseAI Gate 1)". Every number comes from model_card.
  Wall hit is labelled "on the wall by construction", and no pooled "all buildings vs OSM wall" figure is shown
  because it would be circular.
- **Schemas:** the export and model-card schemas carry the new fields (`npm run check:data` passes).

**Colab worker:** copy `pipeline/geo_cascadia/buildloc.py` (new), `run_area.py` and `export.py` (changed) to Drive.
`buildloc.py` needs no new dependency: shapely and numpy are already used, and there is no scikit-learn.

### D28. Plausibility against the road-facing wall; rule variants A (>= 3 cameras) vs B (>= 2) — B chosen
**Plausibility fix** (owner, `buildloc.py`):
- A triangulated point is rejected when it is > 10 m from the building's **road-facing wall** (the footprint edge it
  should lie on). The footprint polygon is used only when no street line is available. Fallback: wall_hit →
  footprint_centre.
- Reason text: "triangulation rejected: implausible (X m from road-facing wall)".
- `predict_positions(..., min_cameras=3)` is the production rule. `min_cameras=2` exists only for this comparison.
  With exactly 2 cameras, the uncertainty is null.

**Comparison** (`tools/compare_position_rules.py`; saved files + cached OSM footprints only, no YOLO / OCR / VLM /
Street View / Places; output `data/areas/<slug>/rule_variants.json`). Distances are to the road-facing OSM wall:

| area | variant | triangulated / wall_hit / footprint_centre / rejected | triangulated vs OSM wall: n, median, p90, % <= 3.5 m | 2-camera-only subset |
|---|---|---|---|---|
| Ward 29 | A (>= 3) | 28 / 232 / 121 / 11 | 28, 3.33 m, 9.29 m, 50.0% | — |
| Ward 29 | B (>= 2) | 36 / 224 / 121 / 11 | 36, 3.48 m, 8.00 m, 50.0% | 8, 3.75 m, 8.00 m, 50.0% |
| Trichy | A | 17 / 32 / 17 / 4 | 17, 4.75 m, 8.92 m, 47.1% | — |
| Trichy | B | 19 / 30 / 17 / 4 | 19, 4.04 m, 8.92 m, 47.4% | 2, 3.49 m, 4.04 m, 50.0% |
| Tiruppur | A and B | 0 / 1 / 0 / 1 (26.6 m) | — | — |

**Notes:**
- The check and the score use the same reference, so surviving points are capped at 10 m from the wall. These numbers
  are not independent of the check.
- **The official output is not switched.** export.json, the database and model_card still hold the D27 output, made
  with the footprint-polygon check.
- Regenerating the official output with the new check changes 10 + 4 + 1 buildings (listed in `rule_variants.json`).
  It also needs `eval_gate1.py`, which re-fetches the pins, to refresh model_card. That waits for the owner's decision.

**Also fixed:** a positive cost that rounds to zero shows "< $0.0001", never "$0.0000" (`lib/utils.ts` `usd`, used by
the evidence drawer and the cost panel).

**Decision (owner, 26 Sep): variant B.** Triangulated needs >= 2 camera positions, with the road-facing-wall
plausibility check (`predict_positions(min_cameras=2)` is the default, so live P6 runs use it).
- A 2-camera result shows as "Triangulated (2 cameras)" with uncertainty "not estimated".
- The official output was regenerated for all three areas: `tools/building_positions.py`, then the database reload
  (review decisions kept: #94 and #97 still approved), then `tools/eval_gate1.py` (39 Places detail lookups for the
  cached place_ids, no new searches).
- New counts (triangulated / wall_hit / footprint_centre, rejected):
  - Ward 29: 36 / 224 / 121, 11 rejected;
  - Trichy: 19 / 30 / 17, 4 rejected;
  - Tiruppur: 0 / 1 / 0, 1 rejected.
- Self-consistency (estimated n / median / p90): Ward 29 17 / 2.51 m / 7.46 m; Trichy 9 / 3.14 m / 5.45 m.
- The Trust page adds: "The pass rate rose mainly because implausible points (>10 m from the wall) were rejected, and
  the check and the score use the same wall, so this is a comparison, not accuracy."


## 2026-09-27 — P5 (Review, Under the Hood, Trust, Jobs)

### D29. P5 pages and rules
**Numbers.**
- `backend/app/hood.py` (`GET /areas/{slug}/hood`, `/hood/examples?key=`) computes every Hood number from the records and
  the run files (panos, plan, plan_anomalies, _views_done, detections, ocr, building_views, vlm_unmapped); each value has
  its source in `src`. pytest recounts them from the raw files independently.
- **Story sentences** are rebuilt from computed numbers (same template as `build_run_report.py`); the stored text is kept
  and every change is listed (Hood › story, Trust › Stored vs computed). Corrected:
  - Ward 29 "29 triangulated / 239 approximate" → **20 / 248** (29 = seen by 2+ cameras).
  - Ward 29 "266 had a usable view, 0 had no building box" → **221 / 43**; Trichy 44 / 7 → **41 / 13**. The report counted
    building_views.json rows, which include footprints that are not registered buildings (80 in Ward 29, 6 in Trichy).
  - Tiruppur: singular/plural only ("1 user photosphere", "1 building registered", "1 building named").
- `backend/app/trust.py` (`GET /trust`): result cards and experiments quote **only** model_card.json; every number
  carries its dotted path (`src`), resolved by pytest. `confusion_matrix` is null: model_card has per-class P/R only.
  `GET /trust/consistency` lists stored-vs-computed rows for all areas with a jump target.
- Timings/run cost counters stay greyed with "resumed run, not representative" (D1). Cost lines: Street View =
  photos fetched × model_card price (computed); VLM = model_card (Ward 29, Trichy) or "not recorded"; Places "not recorded".

**Review.**
- `reviewer` is **required** on every decision (asked once in the browser, `gc.reviewer`); Undo records who pressed it.
- A **note or photo is accepted only with an appeal** (422 otherwise). The item's note/photo now reflect the current
  decision only (history keeps earlier ones). Photo type/size checked before upload (415 / 413).
- Migration 005: `review_events.photo` (photo uploaded with that decision; `GET /review/{id}/events/{event_id}/photo` →
  10-min signed URL) and `jobs.is_test`.
- `dashboard.kpi.waiting_for_review` = pending only; the Explore KPI "Waiting for review" uses it
  (`low_confidence_observations` stays the queue size).
- Live 360° on Review: the page overlay turns see-through and the evidence column transparent (one map instance).
- **Tests never touch real items:** review tests use a copy of the Tiruppur run loaded as area `pytest_review_items`
  (deleted after the session) and `reviewer='test'`. Note: before this change, the P4 test suite ran once more on Ward 29
  items (≈160 events, reviewer `pytest`/null, 26 Sep 17:56 UTC, all undone). #94 (approved, reviewer `pytest`, note
  "1 floor", 08:30 UTC) and #97 predate review_events; left as they are.

**Jobs.**
- `display_status` adds **cancelled** (failed + "cancelled by user", grey) and **interrupted** (running, no heartbeat 10 min).
- `POST /jobs/clear-test {dry_run, ids}` removes only jobs that ended without a result (failed / no_street_view, no area)
  **and** are `is_test` or were cancelled before any worker started them. The UI lists them first, then removes exactly
  those ids. `GET /jobs/{id}` adds the length-scaled estimate.

**Explore wording.** A matched building whose use is not known reads "Register entry exists — use not compared"
(`matchLabel(status, long, useKnown)`), everywhere the status appears; the legend says "In the register, no difference found".

## 2026-09-27 — P5 browser round

### D30. One-time review reset; P5 browser-round fixes
**Reset (owner request, run once on 27 Sep):** `tools/reset_review_history.py --yes` (refuses without `--yes`).
- In one transaction: disables the append-only trigger, deletes every `review_events` row, **re-enables the trigger**;
  sets every review item to waiting (reviewer, note and photo cleared); sets `buildings/assets.review_status` back to
  pending. Then deletes every file in the private `appeal-photos` bucket. Prints counts only.
- Result: 485 events deleted, 7 items and 5 map objects reset, 1 photo deleted; afterwards 350 of 350 items waiting and
  clean (Ward 29 260, Trichy 77, Tiruppur 13), 0 events, trigger enabled, 0 photos.
- A script, not a migration: a migration would run again on any new database.
- Tests write only to the test area `pytest_review_items`, always with reviewer `test` (after the reset: 42 test
  events, none on real areas).

**Review.** The selection is an item, not a list position. Every filter is strict: a decided item leaves
"Waiting for review" at once, so "N shown" = the list = the header count. Undo is a button in the confirmation (never
clipped) and "Undo this decision" on the item's latest live decision in History. U undoes the confirmation's decision,
or else the current item's latest live decision. Each decision and undo is written into History at once (then
refetched). A waiting item shows no reviewer. No horizontal overflow on the right column.

**Hood.** Skipped panoramas are split by the planner's own rules (`plan.py`): more than 15 m from every analysed street
(Ward 29: 443), or on the street but thinned: stops ≥ 12 m apart along the road / ≥ 6 m apart, or a street piece
shorter than 25 m (74). P5's first version said "another stop already covers that frontage" for all 517; that was a
guess, now replaced.
- Example maps draw what their sentence says:
  - camera stops: view wedges and the faced building outlines;
  - dropped stops: the outline the camera stands in;
  - poles and lights: the cameras and their sight lines;
  - dark stretches: the lights and poles around them;
  - "no building box": the outline and the cameras that looked at it.
- Developer facts (panorama ids, bearings, OCR confidence, ids) are Technical only.
- Plain shows one line for time and cost and "N sentences corrected — see Technical". Technical shows a fixed-column
  cost table and the greyed stage timings.
- Counters always show their final value.
- 156 vs 116: Hood counts buildings given **any** name from a sign (156). Explore counts names **read clearly**
  (quality "good", 116). The Explore label is now "Shop names read clearly", and Hood says both.

**Layout.** Every topic on Hood, Trust and Jobs is its own panel (heading, divider, spacing). Hood and Trust have a
sticky section nav that follows the scroll.

**Jobs.** Stages are listed one per row with short names. The end time is labelled "Cancelled at", "Failed at" or
"Finished". The estimate shows one short line; the method is behind "How is this estimated?".

### D31. P5 last items (owner, 27 Sep)
- **H7: evidence box for buildings with no matched box.**
  - The orange "This building" box on "No building box in any photo" was a real detection, not a projected outline.
    For buildings with no stored box, `evidence.py` fell back to "the most confident building box in a photo planned
    to face this outline". The pipeline never matched that box to the building.
  - Now only the pipeline's own box-to-outline match (`building_views.json`) is marked:
    - A match that failed the quality gate is shown first as "Best photo", with the reason.
    - With no match, no building box is marked, and a sentence says so.
    - A marked sign box is labelled "This building's sign".
  - Ward 29: 117 buildings show their rejected box with the reason; 31 have no match and no marked box. Trichy: 12 and 5.
    pytest checks every such building in all areas. This also corrects Explore and Review.
- **H6:** "Photos where the map has no building outline". Each photo example has a small plan beside it: the camera,
  the photo's direction as a wedge, and the outlines around it (none inside the wedge for these).
- **H8:** the example sheet shows the explanation sentence under the title, then the tabs (underline style), then the
  photo, sized to fit the sheet.
- **H9:** Hood and Trust are plain-only; the Plain / Technical toggle is removed. Hood shows only the correct story
  sentences, and time and cost as one line. The corrections are listed only on Trust › Stored vs computed, with plain
  sources ("the saved run summary", "the model card", …). Trust cards say "Source: the team's model card, checked by
  hand on n examples".
- **J4 / J5:** one "Estimate" heading on Jobs. Developer terms removed from visible text: model_card → "model card";
  worker stage text: "Progress appears here once a worker runs the analysis."

## 2026-09-27 — pipeline fix: sign text → building use

### D32. Building use from a readable business sign; stricter display names
**Diagnosis.** `vlm.finalize_buildings` takes use only from the building-photo step (local router / VLM). That step
runs only for buildings with a usable building box (`building_views` reliable). Sign names come from a separate OCR
path (`ocr.run_ocr`, linked by the view's footprint). A building whose box was missing or failed the quality gate kept
use "not known" even with a readable shop sign. Buildings with use unknown and a linked name before the fix: Ward 29
59, Trichy 18, Tiruppur 0.

**Rule** (`pipeline/geo_cascadia/signuse.py` `fill_use_from_signs`, called by `run_area` right after
`finalize_buildings`; no model call). Only a use that is still unknown is filled: `use = commercial`,
`use_route = "sign_text"`, `validated = "rule: readable business sign (not measured against hand labels)"`. It needs:
- a kept name supported by OCR (`ocr` or `vlm_verified_by_ocr`);
- a tier-2 OCR read of the building's own sign (confidence ≥ `ocr_min_conf` 0.55) that supports that name
  (`support ≥ name_gate` 0.7);
- a sign crop of at least 50 px wide and 3,000 px² (`sign_use_min_crop_w / _area`);
- text that is a business name or a generic business word (`textmatch.name_kind`); one word of ≤ 6 letters is too little;
- no house-name word (`cfg.sign_use_house_words`: illam, nilayam, nivas, bhavan, house, villa, residency, …, Tamil forms).

**Names** (`textmatch.name_kind`, used by `name_quality`). A sign text is a display name only if it reads as a name.
These are rated "fragment" (shown as sign text only):
- street signs ("… Road", "… Gardens");
- cut-off words (COIMBATO, EDICINES);
- OCR junk (rOI Go);
- generic business words ("COACHING").

Google-confirmed names stay good. The app shows the name only when it is good; otherwise "<Use> on <street>".

**Applied to the saved runs** (`tools/sign_use_recompute.py --write`: saved files only, no YOLO / OCR / VLM /
Street View / Places). It first checks that the pipeline's own matching on the saved attributes reproduces the old
export exactly (it does, all 3 areas). Then `run_report.json` was rebuilt and all 3 areas reloaded (review decisions
kept).

| area | use not known | named clearly | differs from register | matches | review items |
|---|---|---|---|---|---|
| Ward 29 | 160 → 134 (+26 commercial) | 116 → 107 | 102 → 117 | 260 → 245 | 260 → 276 |
| Trichy | 25 → 14 (+11) | 38 → 37 | 19 → 21 | 45 → 43 | 77 → 79 |
| Tiruppur | 0 → 0 | 0 → 0 | — | — | 13 → 13 |

- Knock-on: the synthetic register records "house" on residential streets, so a sign-proven shop there becomes "use
  differs from register" (Ward 29: 15 matched → differs, 2 gained a difference). This is the pipeline's existing
  matching rule, unchanged.
- The "not on Google" flag is dropped for names that became fragments (the pipeline's existing rule: 9 in Ward 29,
  1 in Trichy).

**Validation.**
- The Ward 29 hand-label set (n=31) is not in the repository (only its numbers in model_card), so it could not be
  re-scored. The rule fills only buildings the model left unknown, and a held-out accuracy is computed on model
  predictions, so those buildings are untouched if the set contains only model-predicted buildings.
- Trichy `spot_labels.csv`: 8/12 before, 8/12 after; none of its buildings changed.
- The accuracy of the sign rule itself is not measured.

**Known limit:** OCR garble that forms a plausible word ("OPENING", "DEXENTERARSSES") still passes the name check; a
dictionary would be needed.

**D32 addendum (owner browser check, 27 Sep).**
- **Generic sign words** (`config.GENERIC_SIGN_WORDS`: open, opening, grand, sale, offer, welcome, new, today, …). A sign
  made only of these is `name_kind = "nonname"`: never a display name and not evidence of use. Re-applied from saved
  files as above (regression check passed).
  - Ward 29: use not known 160 → **135** (25 from a shop sign; "OPENING" no longer counts); names read clearly
    116 → **105**; differs from register 102 → 117; review items 260 → 276.
  - Trichy: unchanged from D32 (25 → 14, 11 from a sign; 38 → 37 names).
  - Tiruppur: no change.
- **Hood step 06:** the sentence reads "N local, N cloud, N from a shop sign (no clear photo), N not known". Every count
  defaults to 0, so an API without the sign count shows 0, never NaN. The NaN seen in the browser came from an API
  process started before D32.
- **a / an:** one helper (`lib/utils.ts` `article` / `withArticle`), used for the register sentence ("An apartment with
  3 floors"); UI test.
- **Trust:** a card "Building use from a shop sign": accuracy "not measured", source "a fixed rule in the analysis, not
  checked by hand yet". Known limits: adverts/posters can mislead (e.g. "FOOTBALL COACHING" on a wall, w1236978198);
  OCR garble can pass; a random spot-check is planned. The rule itself is unchanged.

## 2026-09-27 — Gate 1 clarified by FarmwiseAI

### D33. Building position = the centre of the building's front; OSM footprints accepted as reference
**Organiser guidance:** OpenStreetMap footprints are accepted as the reference; a building's position is the centre of
the building as seen from the street (≈ the midpoint of its front wall). `lat`/`lon` stay the footprint centroid.

**Rule** (`buildloc.predict_positions`, same code for every area and live run):
1. `triangulated` (unchanged);
2. `wall_hit` (unchanged). Its camera ray is aimed at the horizontal centre of the building's box
   (`detect.py` `u = (x1 + x2) / 2`), so the hit is the centre of the *visible* front. A box cut off at the photo edge
   gives the centre of the visible part only.
3. **new `wall_centre`**: the midpoint of the footprint's road-facing wall. Label "Front-wall centre from the map (no
   camera line of sight)"; it uses the map footprint.
4. `footprint_centre`: the centroid, only when no road-facing wall can be determined.

**Re-applied from saved files** (`tools/building_positions.py`: cached OSM footprints, no image or model calls). Only
`predicted_position` changed, and only for former `footprint_centre` buildings: Ward 29 121 → `wall_centre`, Trichy
17, Tiruppur 0. Every former fallback had a road-facing wall, so `footprint_centre` is now 0 everywhere. The DB was
reloaded, keeping review decisions.

**Evaluation** (`tools/eval_gate1.py --no-places` → `model_card.gate1_position`):
- A new reference, "vs OSM front-wall centre": the distance to the road-facing wall's midpoint, for every method.
  Map-derived methods are marked "uses the map".
- `wall_centre` IS the reference point (0 m by construction), so it and the pooled "all buildings" row flatter the
  result. "Camera-derived (triangulated + wall_hit)" is the fair row. Ward 29: n=260, median 2.8 m, p90 7.52 m, 60.4%
  ≤ 3.5 m. Trichy: n=49, 3.64 / 10.02 / 49.0%. Tiruppur: n=1, 18.44 m.
- The Google-pin block was not re-run (it needs Places look-ups). It is kept, labelled "computed before D33 (old
  fallback)".
- Status stays "not verified": no surveyed reference exists.

## 2026-09-27 — P6 (analysis worker and live jobs)

### D34. Worker protocol, live areas, cost cap
**Worker** (`worker/colab_worker.py`, one cell; steps in `worker/README.md`).
- The same cell runs on Colab GPU, Kaggle GPU or a laptop CPU. The device is auto-detected; on a CPU sign reading is
  **fast** (`CPU_OCR_MODE`), and the cell says so.
- The pipeline + weights come from the setup cells, a local folder, or a shared Drive folder link (`gdown`). No Drive
  path is hard-coded.
- It asks for the tunnel URL, worker token, AWS keys and the Google server key with hidden input; it never prints or
  stores them.
- Heartbeat every 15 s; one job at a time. When the tunnel URL changes, the cell asks for the new one and keeps running.
- It refuses an older package copy: `run_area` must have `on_stage` / `plan_check`.

**Pipeline additions** (owner request; no logic, prompt or threshold changed):
- `run_area(on_stage=, plan_check=)`: a stage-finished callback and a check after the camera plan, before any Street
  View photo is bought.
- `vlm.py` records the floors call's tokens. `export.py` then stores the exact cost per building (use call + floors call,
  `cost.recorded: true`); older runs keep the old approximation.

**Statuses.** Migration 006 adds `needs_approval` plus `jobs.approved / estimate / device`.
- Cost cap (default 300 photos or $1 estimated, set in the cell): over it, the job pauses as **needs approval** with the
  plan-time estimate. A person approves it (back to queued, cap lifted for that job) or cancels it.
- `AWS_TOKEN_EXPIRED` → `expired_token`. The cell asks for new keys and claims **the same job** by id (`/worker/next
  {job}`), resuming from its saved files.
- A running job silent for **2 min** (was 10) is "interrupted" and claimable again. Another worker session resumes it.
- A worker counts as connected for 45 s after its last call. `GET /worker/status` gives the top bar the device and
  the current job.
- `/worker/next` without a job id never claims test jobs, so tests claim only their own jobs.

**Caps.** One real street at a time: `POST /jobs` returns 409 while a non-test job is queued, running, paused or
waiting for approval. Drawn areas stay ≤ 1.5 km² (D11).

**Results.** `/worker/result` saves the files, builds `run_report.json` and loads through the existing loader. The same
rules therefore apply as for the original areas: street names from the run's `street_names.json`, gap display,
coverage banner, D33 positions and the D32 sign-text use, all produced by the same pipeline code.
- The folder gets `live_run.json`. The area card and Hood mark the area `live`.
- Hood shows its real time, photo count × model-card price, cloud-AI calls and cost, and the stage timeline
  **without** the "resumed run" badge. That badge stays for the three original areas (D1).
- Exception: the cell's `worker_run.json` notes when a run resumed from photos fetched by an earlier attempt, or is a
  fake-worker replay. Hood then keeps a badge saying so.
- A pause for approval happens before any photo is bought, so it does not count as resumed.
- Review items join the queue with the area.

**Delete.** `DELETE /areas/{slug}?confirm=<slug>` removes an area made by a job (rows, review items, folder). The job
stays in the list as "area deleted". The three original areas return 403. Review history rows are append-only and stay.

**UI.**
- The top bar shows the worker (connected / not, GPU / CPU, progress).
- The job card and Jobs use plain stage names that match the worker's stages. They show time so far and an honest
  time left: the device's length-scaled estimate minus elapsed, saying "taking longer than the estimate" once past it.
- With no worker, a job reads "Queued, waiting for a worker".
- A needs-approval job shows Approve / Cancel.
- On the map, the clicked street sweeps with the current stage's progress; a queued or paused street is a still dashed
  line.
- When a job is done, the map flies to the new area.
- Jobs → a finished job → "Delete this analysed area…" (with confirmation).

**Tests.** `backend/tests/test_p6.py` covers: token required, claim, progress, interrupted → resume, expired keys,
fail codes, cost-cap pause / approve / cancel, one at a time, result → load (Tiruppur copy) → delete, and originals
protected. The tests use test jobs only and write no review decisions.

### D35. P6 browser round (F1–F13)
**Progress (F1, F2).**
- The API gives every job `stage_no`, `stage_count` (10) and `progress`: finished stages plus the share of the current
  one.
- Pipeline sub-steps map onto the ten stages. Within an attempt, progress only moves forward; a late report from an
  earlier stage keeps the stage.
- A new claim starts a fresh attempt at stage 0.
- Everywhere the text reads "Stage 3 of 10 · Planning camera stops". A count is added only for photos, signs, items and
  look-ups.
- The map sweep follows overall progress and eases toward each update. With 2D or reduced motion it jumps straight to
  the value.

**Names (F3–F6).**
- The Analyse estimate is one line plus "How is this estimated?".
- Unnamed streets read "Unnamed road near <nearest named street>", with no road class.
  - The click picker applies this, including to names cached or stored before.
  - For a new run's streets the pipeline could not name, `/worker/result` adds such names to `street_names.json` and to
    the export's `street` fields (display only; `jobs.fill_street_names`).
- The area dropdown shows only names, originals first, with a "new" tag on streets analysed from the app. It refreshes
  when opened and whenever a job leaves the active list.
- A fake-worker area is named "<street> (test)".

**Delete and clear (F7–F9).**
- Deleting an area also deletes its job.
- The UI removes it from every cached list at once (area dropdown, Explore, Jobs, Hood tabs), moves off it, then
  refetches. A failure shows a message and nothing is removed.
- `DELETE /jobs/{id}` ("Remove from list") works for cancelled, failed and no-Street-View jobs without an area.
- The fake worker claims with `test: true`, which makes the job a test job; a replay result also marks it.
- "Clear test jobs" removes test jobs with their test areas (not a test job still running) and jobs cancelled before
  they started. It never removes a real analysis, its area or the originals: `delete_area(require_test=True)` plus the
  original-area guard.

**Cancel (F10).** Migration 007 adds `jobs.cancel_requested` and `jobs.note`.
- Cancelling a job a live worker is running sets **cancelling**.
- Heartbeat and progress responses return it. The worker's heartbeat thread interrupts the running step
  (`_thread.interrupt_main`), and progress callbacks stop at the next report.
- The worker deletes the job's files and reports `CANCELLED`, and the job becomes cancelled. Measured with the fake
  worker: 4 s.
- A cancelling job with a silent worker finishes as cancelled after 2 min, and one with no live worker is cancelled at
  once.
- A cancelling job is never claimed or loaded. A late `/worker/fail` never overwrites a finished job.

**Resume (F11).**
- With Drive mounted, the cell syncs the job folder (run JSONs and crops) to `MyDrive/gc_worker_jobs/<job id>/` after
  every stage, and once a minute during long stages. It restores the folder on the next claim and deletes it when the
  job finishes, fails or is cancelled.
- `/worker/next` returns `resumed_claim`. When a resumed job has no saved files (another account), the worker leaves
  the note "Started again from the beginning…", which the job card shows.

**F12.** The fake worker's "480 photos / $3.41" was a fixed constant in `fake_worker.py`, not Tiruppur's plan. The fake
now computes the estimate like the real worker, from the replayed `plan.json` (Tiruppur: 78 photos, $0.55), and lowers
its own cap if needed. The real worker always uses the clicked street's plan (`plan_estimate`).

**F13.** The mini-map scale bar and north arrow sit on small plates drawn last (`GeoMini` `ScalePlate` / `NorthPlate`,
also used by `PositionMini`).

### D36. Names for unnamed roads, object mini-maps, no version tags (after P6)
**Unnamed roads** (`streetpick.unnamed_label`). Only real map names are used; a name is never invented.
- A road that connects two named roads (a named road within 15 m of each end) is "Unnamed road between A and B".
- A road that touches one named road (at an end, or crossing within 3 m) is "Unnamed road off A".
- Otherwise it is "Unnamed road near <nearest named road>", or "Unnamed road" when none is known.

How the picker applies it:
- One extra Overpass query fetches every road at the two ends.
- Where an end meets a road with no name on OpenStreetMap, Google's name for that road is looked up. This uses reverse
  geocoding, "route", 25 m along it; at most one look-up per end, kept 30 days, using the server key
  `GOOGLE_PLACES_SERVER_KEY`. On a tie, OpenStreetMap names win.
  - The current key is **not enabled for the Geocoding API** (REQUEST_DENIED), so today these look-ups are skipped.
    Enabling Geocoding on that key turns them on.
- Names written in lower case on the map are capitalised word by word ("Union mill road" → "Union Mill Road"). Other
  scripts are left as they are.
- Resolved clicks are cached under `picks2/`; the old "near" answers are not reused.
- New runs' streets use the same rule (`jobs.fill_street_names`). The clicked street keeps the picker's name.
- Tiruppur check (way 954853615): the north end meets Uthukuli Road and the south end meets Union mill road (plus an
  unnamed tertiary road). The name is therefore "Unnamed road between Uthukuli Road and Union Mill Road".
  "KPN Colony Main Road" is not on OpenStreetMap within 3 km; it is probably Google's name for that tertiary road.

**Mini-maps.**
- Evidence views carry `camera` (lat/lon from panos.json).
- Review's right column uses `ObjectMini`: the object, its street with the name written on it, building outlines within
  70 m, the evidence cameras and a dashed line of sight from each, and a small key.
- `GeoMini` fits everything into the middle band. The top and bottom 30 px are kept for the N and scale plates, so they
  never cover the object; `PositionMini` does the same.
- A highlighted street's name is placed where it is farthest from the object and the cameras.

**Version tags.** Area names drop internal tags such as "(v2)" (`store.display_area_name`), so the map label,
dropdown and Hood all read "Ward 29, Coimbatore". meta.area in export.json is unchanged.

### D37. transformers 5.x, Retry, honest resume note, pasted inputs (P6b, after the first real Colab run)
**Failure.** The real Colab run stopped at the use router with `'BaseModelOutputWithPooling' object has no attribute
'norm'`. S1a installs the latest transformers, and from 5.x `CLIPModel.get_image_features` / `get_text_features`
return an output object instead of a tensor. The object's `pooler_output` holds the same projected features
(`visual_projection` / `text_projection` applied; checked in the transformers source).

**Pipeline fix (bug fix; logic unchanged).** The only call site is `localuse.clip_embed`, and it now goes through
`localuse.feature_tensor`:
- A tensor from 4.x is returned unchanged, so the embeddings are identical to before.
- From an output object it takes `image_embeds` / `text_embeds` if present, otherwise `pooler_output`.
- If the size is not the model's `projection_dim`, or there are no features at all, it raises instead of classifying
  wrong features.

S1a pins `transformers==4.57.6`, the last 4.x, which returns tensors like the version the router was trained with.
The worker prints the installed version and warns when it is not in `TESTED_TRANSFORMERS`.

**Retry.** `POST /jobs/{id}/retry` puts a failed job back in the queue. It must be a real error: not cancelled, not
"no Street View", and no area. It keeps the same id and `started_at`, so the next claim is a `resumed_claim`.
- Jobs carry `retryable`. The job card and the Jobs page show **Retry**.
- It follows the one-street-at-a-time rule.
- The worker no longer deletes a failed job's files. Before, `forget()` ran on every failure, so a retry would have
  bought every photo again.
- `POST /worker/known` tells the worker, at start, which Drive folders are still needed (unfinished or retryable
  jobs). It deletes the rest. If the backend can't be reached, nothing is deleted.

**Resume note.** The printed line looked for `panos.json` on Drive. The card note looked for `_views_done.json` /
`detections.json`. A run that stopped before the first photo batch was saved had the first but not the second, so the
card said "Started again from the beginning" while the worker continued. Both now use one value, `continuing`: any
file `run_area` resumes from (`STAGE_FILES`: panos, plan, buildings, _views_done, detections).
`resumed_from_saved_files` in `worker_run.json` stays photo-based, because it is what Hood's timing caveat means.

**Pasted inputs.** URL, worker token, AWS keys and Google key have every whitespace character removed, and surrounding
quotes too. Keys from the setup cells (env / `cfg.maps_key`) are cleaned as well. A folder path keeps its inner spaces.

