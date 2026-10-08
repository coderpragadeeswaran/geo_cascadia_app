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

### D38. Sign reading in its own process; memory lines; OCR self-test (P6c)
**Failure.** Twice on a free Colab T4 the whole session restarted, with no Python traceback, while the OCR stage was
loading its Paddle models ("Creating model: PP-OCRv6_medium_det … Using cached files"). This was after detect and
geometry had resumed from Drive. The likely causes are running out of RAM, or Paddle and torch (CUDA) clashing in one
process. Neither is proven. The new memory lines are there to show which.

**Pipeline hook (plumbing only).** `run_area(..., ocr_runner=None)`. When it is given, it is called instead of
`run_ocr` with the same arguments and must return the same `(results, names, stats)`. With None, `run_ocr` runs
exactly as before. OCR logic, prompts and thresholds are unchanged. The worker's `check_pipeline` now requires this
hook, so an older zip is refused with the copy-the-package message.

**Worker.**
- Before OCR:
  - YOLO is no longer referenced once detection returns. The worker runs `gc.collect()`, then
    `torch.cuda.empty_cache()` and `ipc_collect()`.
- OCR runs in its own Python process (`OCR_CHILD`).
  - It imports the package's own `ocr.run_ocr` and runs it unchanged. It reports `@@ LOADED`, `@@ PROGRESS n total` and
    the result through stdout, and its log lines are printed with "│".
  - The spec file holds no key: `maps_key` is left out, and keys stay in the environment.
  - In the child, tuple settings are turned back into tuples, so it rebuilds exactly the same `Config`.
- A crash is reported with its cause: killed (usually out of RAM), a segmentation fault, an abort, or the exit code
  with the last line.
  - After the first crash the worker tries once more the same way. After a second crash on the GPU it continues on
    the CPU in quick mode, with `CUDA_VISIBLE_DEVICES=""`.
  - The job card says so each time. `ocr.json` is saved every 25 crops, so each try keeps the signs already read.
  - `meta.run.ocr_mode` comes from the stats of the try that finished, so an export made after the fallback says
    "fast".
  - The tries are recorded in `worker_run.json` (`ocr_tries`).
  - After a third crash (the second on a CPU worker) the job fails as retryable ("Press Retry").
  - A cancel or stop kills the child process.
- A memory line is printed at worker start, at each stage boundary ("detect done → geometry starts"), before and after
  OCR, when the OCR models are loaded, and after a crash. It shows RAM used/total with the worker's own share (psutil,
  or /proc/meminfo), and GPU used/total for all processes (nvidia-smi, so the OCR child is included; it never starts
  CUDA itself).
- OCR self-test at start (`OCR_SELF_TEST = "ask"`):
  - It runs in the same child process: it loads the models, reads a drawn "HOTEL" image, and the process exits, which
    frees its memory.
  - It tests the jobs' own setting first, then the CPU quick fallback.
  - If both fail, it asks before claiming any job.


**Tests must never claim a real job (found while running P6c).** Three tests called `/worker/next` without a job id:
`test_p4_api::test_cancel_job`, `test_writes::test_job_queue_and_worker_protocol` and
`test_p6::test_claim_one_job…`. With a real job queued or interrupted, they claimed it. Two of them then "gave it
back" as queued with `started_at` / `worker_id` / `heartbeat_at` cleared, and the third left it running under
worker "pytest".
- This hit the real Sanganur Road job (086d1442…). It stayed claimable and its Drive progress was not affected, but
  its original start time was lost.
- The job was restored to the state it had before the last run.
- `test_cancel_job` now claims the cancelled job by its id. The other two claim without an id only when
  `conftest.real_claimable()` is 0.
- `test_p5::test_clear_test_jobs…` skips while a real analysis is active, like `test_p6`. `test_trimmed_job…` uses a
  test job.

### D39. One mini-map for the whole app; fixes from the real Colab run
**A. Mini-maps.** Every small plan is one component, `GeoMini`, drawn in SVG from our own data. There is no second
Google map and no Street View image, so the D21 heap limits hold.
- **Sizing.** The drawing is re-laid out in real pixels for the width it gets (ResizeObserver). Before, a fixed
  480-unit viewBox was scaled, so labels became ~19 px in the 780 px example sheet and ~6 px in narrow columns.
- **Always drawn.**
  - Roads around, faint. They come from `GET /areas/{slug}/minimap`: one Overpass query per area, cached on disk.
    After a failure, "not available" is answered at once for 2 minutes, and the legend then says "other roads not
    loaded (OpenStreetMap busy)".
  - The analysed streets, with hover showing name and length.
  - Building outlines near what is shown (`outlines="auto"`).
  - N and scale plates in the corners.
  - A legend under the plan, built from what is drawn, with counts.
- **Labels (declutter).** Markers carry no text.
  - At most 3 labels are written, in priority order: the key measurement, callouts, the highlighted street's name
    and length, other streets, one neighbouring road.
  - Each label tries several spots spread along its line or around its point. It is dropped if it would overlap a
    marker, an uncertainty circle, another label or a corner plate (`labelLayout.placeMapLabels`, tested in
    `test:ui`).
  - Everything else is in the legend and in the hover/focus tooltip.
  - Markers shrink when the plan is zoomed out. Camera stops are ticks across the road (along their photo direction).
- **Content per place** (shared builders in `lib/mini.ts`):
  - **Hood 01 Streets planned:** the analysed streets lit, the three longest named with their length, camera stops
    as ticks, one neighbouring road named.
  - **Street by street:** the selected street among the others, its buildings coloured by register status, lights,
    poles, dark stretches and stops, with counts in the legend.
  - **Examples** (`/hood/examples` now carries `measure`, `rays`, `street` and `outline`):
    - Camera positions: wedges, the buildings photographed, other stops, and the spacing to the nearest stop.
    - Dropped cameras: the OpenStreetMap outline the camera stands in. It is looked up once per point and cached;
      if it is not found, a note says so.
    - Thinned / off-street panoramas: the distance to the nearest chosen stop or analysed street. It equals the
      number in the example's sentence (tested).
    - Photo examples: camera, direction, and the poles, lights and signs located inside it (≤ 60 m).
    - Positions: sight lines styled by method, and the distance from the middle of the outline.
    - Poles and lights: pinpointed vs approximate, lines of sight, and the camera-to-object distance for one camera.
    - Not in the register / differs / matches: neighbours coloured by status, with the synthetic-register note.
    - Dark stretches: drawn along the road with the **recorded** length (the same number as the sentence; the
      along-road length is on hover).
  - **Jobs:** the requested stretch with its length, plus roads around (`GET /jobs/{id}/minimap`). The camera stops
    appear once the job has an area.
  - **Review and the Explore drawer:** `ObjectMini`, showing the object, its cameras and lines of sight, its street
    and the buildings around. Assets and business signs now get it in the drawer too. `PositionMini` uses the same
    component.
- **Not changed:** the optional Explore overview `Minimap`, which shows the main map's viewport and is off by
  default. Trust has no mini-maps.
- `streetpick.overpass` gained an optional `per_call` timeout; the click picker keeps 6.5 s and mini-maps use 15 s.

**B. Real-run fixes.**
1. S1a needs transformers 4.57.6 and TensorFlow removed (`pip uninstall -y tensorflow tf-keras tensorflow-hub`,
   `USE_TF=0`, `TRANSFORMERS_NO_TF=1`). transformers 4.x loads TensorFlow, which segfaulted Paddle even on CPU.
   - The worker sets both variables at start; the OCR process inherits them.
   - It warns with the exact fix when a TensorFlow package is installed (`check_tensorflow`).
2. A Places 403 "Requests from referer <empty> are blocked" means a browser key was given to the worker.
   - At start, one free Street View metadata call tests the key (`google_key_problem`). The worker then asks again,
     and Enter keeps the setup cells' key.
   - Mid-job, the error becomes the plain sentence on the job card. The worker asks for the key, and Retry
     continues from the saved progress.
3. OpenStreetMap (Overpass) outages at the area stage are retried by the worker after 30, 60 and 120 s.
   - The card shows "Map server busy (OpenStreetMap), retrying in 30 s… (try 1 of 3)", then "continuing after N
     retries".
   - After the last try the job fails as retryable, with a plain message.

## 2026-09-28 — live analysis: streets with gaps, Street View request errors

### D40. MultiPolygon job areas; "no imagery" vs a refused request
**1. Streets with gaps.** A street made of OSM ways with gaps wider than 90 m (2 × the 45 m buffer) buffers into
separate pieces. `streetpick._result` and `trim` read `buf.exterior` and crashed (`'MultiPolygon' object has no attribute
'exterior'`, a 500 on `/jobs/preview`).
- `streetpick._area_ll` keeps every piece: a Polygon for one piece, a MultiPolygon for 2, 3 or more. Holes are filled,
  as `picker.click_to_street` does, so a one-piece street gets exactly the polygon it got before.
- It is used for whole and trimmed streets. The job input stores it as-is.
- The worker passes it to `run_area` unchanged. The pipeline already takes a MultiPolygon (`Area._poly_to_local`; the
  discovery grid uses only `bounds` / `contains`). No pipeline change.
- A drawn area (`POST /jobs {polygon}`) stays a single Polygon.
- Web types allow a MultiPolygon in `input.polygon` and the preview. The job pulse point uses `outerRings`.

**2. "API not reachable" for a 500.** Starlette answers an unhandled error in its outermost layer, outside CORS. The
browser therefore got no CORS header, `fetch` threw, and the app said "The API is not reachable".
- `main.ServerErrorsAsJson` (the innermost middleware) turns it into a JSON 500, `{"detail": "server error
  (<ErrorClass>)", "server_error": true}`, which passes through CORS. Only the class is sent: a message can hold a URL
  with a key. The traceback goes to the API console.
- Analyse: a 5xx on preview reads "Couldn't prepare this street — server error"; on start, "Couldn't queue this street
  — server error". "The API is not reachable" only for a real connection failure (status 0).

**3. Worker: "Google has no outdoor Street View imagery" for every street** (28 Sep, Sanganur Road, Sakthi Main Road,
Bharathiar Road ×2).
- The four job polygons were valid single Polygons in the right place (lon/lat). Not a polygon problem.
- `StreetView._meta` (pipeline) returns None for every status other than OK. A refused key, a quota or a network error
  therefore looks exactly like "no panorama here".
- Checked from the laptop at the midpoints of the failed Sanganur and Sakthi jobs:
  - the browser key answers OK (imagery exists);
  - the server key in `backend/.env` (`GOOGLE_PLACES_SERVER_KEY`) answers `REQUEST_DENIED`: "This API key is not
    authorized to use this service or API". Its API restrictions do not include the Street View Static API.
  - The Colab key can't be seen from here. If it is that same key, this is the cause.

Worker changes (no pipeline change):
- `StreetViewTrace` wraps the `requests` of the pipeline's streetview module for the run (undone after). It counts
  every metadata and photo answer: (HTTP status, Google status) plus Google's message.
- When `run_area` raises NO_STREET_VIEW, the trace decides:
  - Only ZERO_RESULTS / NOT_FOUND, or panoramas outside the selection → **no_street_view** "… (N points checked)".
  - Any refused or failed look-up → **failed, retryable**:
    - `GOOGLE_KEY` (REQUEST_DENIED; the cell then asks for the Google key);
    - `GOOGLE_REQUEST` (quota, HTTP error, network);
    - `GOOGLE_BROWSER_KEY` (referer message).
    - The message reads "Street View request failed: HTTP 200 REQUEST_DENIED — <Google's message> (412 of 412
      look-ups). This is not a lack of imagery: <hint>". The job card and Colab show it.
  - No look-up at all (empty or tiny area) → `BAD_AREA`, failed.
- Keys never appear: `scrub` removes the key, any `key=…` and any `AIza…` from every message and printed line.
- `run_area` saves `panos.json` before it checks it, so an empty one made every later attempt skip the search.
  `drop_empty_panos` removes it when the job fails this way and at the start of each attempt. Retry therefore
  searches again.
- In a run that goes on, failed look-ups or photos are printed as ⚠ lines and kept in `worker_run.json`
  (`street_view_errors`).
- The start-up key check now uses the pipeline's exact search call (`radius=15, source=outdoor`) and includes the HTTP
  status.
- Backend: `FAIL_CODES` lists the new codes as `failed`, which makes them retryable.

**Tests:** `backend/tests/test_d40.py`:
- 2 and 3 pieces, whole and trimmed, picker + preview + job input;
- the pipeline's `Area` with the MultiPolygon;
- the JSON 500 with CORS;
- the worker through the pipeline's real `StreetView.discover` with fake Google answers: no imagery, denied, quota,
  network, browser key, empty area, Retry after a denied key, three pieces, partial failures;
- the backend statuses and `retryable`.

## 2026-09-30 — owner answers while writing the project explainer

### D41. Real Ward 29 full run, FarmwiseAI guidance, Google keys (owner facts)
**1. Fresh full Ward 29 run.** The owner ran the full Ward 29 analysis in Colab on 28 Sep 2026, on a T4 GPU, with the local
use router ON (as set in the setup cell): **11.5 min, 1,420 Street View images, cloud AI $0.0887**. This is the real
full-run time and cost to quote.
- 11.5 min matches `model_card.cost_time.ward29_full_run_gpu_minutes`.
- 1,420 agrees with the saved run files: 1,154 planned photos + 266 building crops re-fetched for the use/floors step
  (reliable rows in `building_views.json`). 1,420 × $0.007 ≈ $9.94.
- model_card's earlier benchmark ($0.056 with the router, $0.089 without) is left unchanged. Why the fresh run with the
  router on measured $0.0887 is not confirmed: that run's files are not in the repository.
- The app still shows the original (resumed) Ward 29 files. Under the Hood's Ward 29 photo cost ($8.08, planned views only)
  under-counts; using the real count is a P7 item.

**2. FarmwiseAI doubt session (27 Sep 2026).**
- OpenStreetMap footprints are accepted as the reference.
- A building's position is the centre of the building's front as seen from the street (as applied in D33).
- FarmwiseAI may provide property register data later. Until then the registers stay synthetic.

**3. Google keys.**
- ONE Google **server** key: API restrictions Street View Static API + Places API (New), plus Geocoding API if enabled;
  application restriction **None**. It is used by `backend/.env` `GOOGLE_PLACES_SERVER_KEY`, by the Colab secret
  `GOOGLE_MAPS_KEY` (setup cells) and by the worker cell (Enter keeps the setup cells' key).
- The **browser** key is only for the map (referrer-restricted, served by `GET /config/public`); it is never given to
  the worker.
- The D40 "no Street View" incident was that server key being refused (REQUEST_DENIED). It worked after the Street View
  Static API was added to the key's allowed APIs.

**4. Conflicts between docs and code:** the code wins everywhere. The stale docs (CLAUDE.md colours / fonts / heartbeat /
job statuses / Sankey, DESIGN.md chapter count, `docs/PAGES_REVIEW_HOOD_JOBS.md`) are not edited now; they are listed for
P7 in `docs/explainer/05_EXPLAIN_AND_DEFEND.md` (Appendix B).

## 2026-10-01 — P7a: the four findings from the explainer, fixed in the pipeline

All four fixes are in the shared pipeline code (`pipeline/geo_cascadia/`, package 0.2.0), so live runs from the Colab
worker get them; the worker refuses an older package copy. They were re-applied to all six areas (the three originals +
the three app-analysed streets) from saved files only with `tools/p7a_reapply.py`: no YOLO / OCR / cloud-AI / Street View
/ Places calls (OpenStreetMap, and for Vadakku Masi Veethi the Microsoft footprint tile, were fetched to rebuild the
outlines; cached under data/cache/). Before writing, the tool checks the saved files reproduce the saved attributes and the
saved register matching exactly (all six areas pass; `indic-transliteration` was added to the backend venv so Tamil names
score the same as on Colab). The previous files are kept in data/cache/p7a_before/<slug>/. Seeded and deterministic per
area (the seed includes the area name).

### D42. A synthetic register that copies the observations, plus planted mistakes
- `register.observed_register`: each record copies what was observed — use, floors, position (the building's predicted
  position, D33), outline area — except ~22% planted mistakes: missing record, wrong use (commercial ↔ residential, only
  when the use is known), too few floors (only with ≥ 2 measured floors), pin moved 15–40 m (redrawn until > 15 m from
  the outline centre too), area too small (55–70%).
- A use or floor count that is not known is left empty in the record → "not compared", never a fake difference.
- Saved per area: `planted_register_mistakes.json` and `register_synthetic.json` (the records with the hidden building id).
- Recovery metric (`register.recovery_scores`, `backend/app/registertest.py`, Trust › Register tests, `GET /trust/register`):
  caught / missed / false alarms per kind per area, computed from the records. Note on Trust: "This tests the comparison
  logic end to end on made-up data; real accuracy needs a real register."
- All six areas (after the D44 margin rule below): 108 mistakes planted, 94 caught; false alarms 14 (missing record 7, pin
  3, area 2, use 1, floors 1), all from a moved pin paired with a neighbouring building (first P7a apply: 109 / 95 / 14). Ward 29 differs 117 → 50, not in register 19 → 27, review items
  276 → 218. The notebook-era model_card `matching_planted_errors` block is kept, labelled "notebook era".

### D43. Register records paired with buildings by location
- `register.match_by_location`: the building id is never used. Each record's pin vs every building within 50 m (its
  predicted position and its outline centre, whichever is nearer); cost = metres + 10 × |ln(record area / outline area)|
  + 5 m when the use category disagrees; one-to-one, cheapest first. Outcomes: matched · pin in the wrong place (> 15 m) ·
  building with no record · record with no building nearby (`export.register_unmatched`). Match confidence high (≤ 5 m,
  next building ≥ 5 m worse) / medium (≤ 15 m, ≥ 2 m worse) / low; shown in the drawer's "How do we know?".
- Validation with ids hidden: 530 of 538 records (98.5%) paired with their own building; every record whose pin was not
  moved (100%); 18 of the 26 moved pins (69.2%).
- `tools/import_register.py` + `docs/REGISTER_IMPORT.md`: CSV / TSV / GeoJSON / Excel with a column-mapping JSON (id,
  lat/lon or address with `--geocode`, use + value mapping, floors, area in m² or sq ft, street); report of rows loaded,
  skipped and why; `--area` pairs and reports; `--apply` writes the comparison into the area (then reload). A CSV made from
  Ward 29's synthetic register reproduces the app's outcome exactly (304 matched, 50 differ, 27 no record).

### D44. Signs linked by their own line of sight
- `signlink.link_signs`: each sign box casts its own ray from the camera (box centre, pitch-aware; 2–40 m, hits ≥ 1.5 m).
  Names, the sign → use rule (D32), the Google check and the evidence "Sign" photo follow the link (`sign_links.json`,
  with `rule` own_ray / kept_aimed). The cloud model's sign readings follow their crop (no new call).
- **First rule (replaced the same day):** credit every sign to the first outline its ray hits, None when it hits none.
  Ward 29: 966 of 2,065 crops (47%) changed building.
- **Validation without any API call** (owner request; `tools/validate_sign_links.py`, `--plain` for the first rule): for
  read signs whose name matches a Google listing in the run's cached Nearby searches (`textmatch.same_business`, listing
  ≤ 60 m from the camera, nearest if several), the Google pin is the reference: is the old (aimed) or the new outline
  nearer to it (pin-to-outline distance, 0 inside)? Pins are Google's, not surveyed.

  | Rule | Area | Moves measured | Closer | Further | Same ±1 m | Median change |
  |---|---|---|---|---|---|---|
  | first rule | Ward 29 | 35 | 15 | 19 | 1 | +3.7 m (further) |
  | first rule | all six | 86 | 44 | 39 | 3 | −1.6 m |
  | **margin rule, 4°** | Ward 29 | 21 | 14 | 6 | 1 | −3.5 m |
  | **margin rule, 4°** | all six | 62 | 40 | 20 | 2 | −6.8 m |

  First rule, Ward 29: of the 966 moves, 383 to an outline < 5 m from the aimed one, 188 to one ≥ 5 m away, 395 to or from
  no outline; moved signs sit a median 31.9° from the photo's aim (unmoved 18.8°), 671 of them ≥ 25°: photo-edge signs.
  The moves did not improve agreement with Google in Ward 29 (Trichy improved, Sanganur got worse).
- **Rule kept (margin rule):** a sign moves off the aimed outline only when its ray AND the rays ±`config.sign_link_margin_deg`
  (4°) all hit the same other outline first, and none of the three touches the aimed outline anywhere along its length;
  otherwise it keeps the aimed outline (None when the photo was aimed at no outline). 2° and 3° were tried: 2° gave Ward 29
  14 closer / 11 further; 3° 14 / 9; 4° 14 / 6 and kept Trichy's gain (18 / 9). A ray that hits nothing no longer drops a
  sign to "no outline".
- Ward 29 with the margin rule: 570 of 2,065 crops (28%) changed building: 368 between two outlines (248 adjacent < 5 m,
  120 farther) and 202 from a photo aimed at no outline. Read signs moved: 267 (171 between analysed buildings, 79 onto an
  unanalysed outline). Use not known 135 → 139 (first rule 142), names read clearly 105 → 96 (84), Google-confirmed 25,
  businesses with no analysed building 30 → 26 (29), sign → use 21 buildings. Not checked by eye yet.
- A read sign linked to no outline, or to an outline that is not an analysed building, is a candidate "business with no
  analysed building" (label renamed from "no mapped building"); on an unanalysed outline it is placed at the ray's hit.
  In the re-apply, candidates the run never sent to the cloud model reuse its cached answer to the same prompt from the
  naming step, or stay "not checked" (Ward 29: 17 with the margin rule; a live run checks them).
- Places cross-check split into search + `reference.crosscheck_with_places` (unchanged logic) so it can run on a run's
  cached places.

### D45. Single-camera pole uncertainty by distance
- `poleunc`: for the 25 poles and streetlights triangulated from 2+ cameras (all areas), each camera's own estimate vs the triangulated
  point, by that camera's rough distance: 63 estimates. 0–8 m n=20 median 1.28 m, 80th pct 2.39 m; 8–11 m n=11, 1.93 /
  3.51 m; 11–15 m n=32, 1.57 / 3.03 m. Bands chosen so every band has ≥ 10 estimates.
- **Per band the larger of** the consistency 80th percentile and the notebook's surveyed median for that distance
  (`poleunc.SURVEYED_MEDIAN_M`: 0–8 m 1.64 m, 8–15 m 4.55 m, n=1,469 detections), rounded up to 0.5 m, never smaller for
  a farther pole (owner: ±3.5 m understated the surveyed 8–15 m error). `config.single_cam_unc_bands = ((8, 2.4), (11, 5.0),
  (15, 5.0))`: 0–8 m keeps 2.4 (consistency), 8–15 m becomes 5.0 (surveyed).
- Export: `uncertainty_m`, `camera_distance_m`, a plain basis (≤ 8 m: "8 in 10 … within 2.4 m"; beyond: "an earlier surveyed
  check found a typical (median) error of 4.55 m for poles 8–15 m from the camera, so the circle is ±5 m; about half of
  such estimates fall inside it"); map circle and "How do we know?" use it. `tools/pole_uncertainty.py --write` stores the
  table in model_card.json `single_camera_by_distance` (now with `surveyed_median_m` per band and `basis` per circle).
- Trust shows the table with a "surveyed check (median)" column and which value each circle uses, and says the
  consistency check leans small and that the ±5 m circle holds about half of such poles (a median), not 8 in 10.
- Ward 29 single-camera circles: 248 × ±3.5 m → 132 × ±2.4 m and 116 × ±5 m.

### Reload and review items
- `loader.load_area` now reports every review item added, removed (pending) and every DECIDED item whose finding left the
  queue (kept, with its decision, never deleted); `backend/load_area.py --report`. P7a reload: 145 waiting items removed,
  58 added, 309 kept; no decided item was affected (all 454 were waiting). Reload twice → no changes. The re-apply with
  the D44 margin rule and the D45 bands: Trichy 3 waiting items removed, Ward 29 1 removed and 1 added; 364 items, all
  waiting; a second reload → no changes.

### Colab package zip
- The owner's S0 cell extracts the newest zip in /MyDrive/alldataset (after deleting geo_cascadia_pkg/) and expects
  entries `geo_cascadia_pkg/geo_cascadia/<file>.py`. `tools/build_pkg_zip.py` writes `geo_cascadia_pkg_p7a.zip` with that
  prefix (every .py of pipeline/geo_cascadia, no __pycache__) and checks every entry name; git-ignored; worker/README.md
  and explainer 04 §12.1 give the command.

### Explainer wording
- Files 00, 01, 02, 03 and 05 use plain descriptions only (no request paths, file, function, table or column names, no
  code terms); OSM building IDs and asset IDs stay because the app shows them. Technical names live only in 04.

## 2026-10-01 — P7 Round 1 (P7.1 Analyse / map UX, P7.2 estimates and cost)

### D46. Analyse camera, end handles, minutes wording, unnamed-road names, OSM lookup budget, planner estimate, $2 cap
**Camera (P7.1-1).** Why the map kept zooming: in Analyse every map click re-picks the street (a double-click zoom is two
clicks), and each new preview re-ran the fit; and the band change to street level animated the tilt with a FIXED zoom
for 900 ms, pulling a person's own scroll zoom back. Now: the street is fitted once per street (`analyse.streetKey`:
same OSM ways = same street, which also keeps its trim); band changes animate the tilt only (`camera.tiltTo`); a wheel,
drag or pinch cancels any running centre/zoom flight (`camera.yieldToUser`).
**End handles (P7.1-2).** The map layer draws no end/vertex dots; the only dots are the 2 handles (TrimHandles), pushed
apart on screen when closer than a handle (`trim.separate`: along the street; a loop uses each end's outward
direction); a drag keeps its grab offset. A street too short to trim shows its 2 ends as fixed markers.
**Minutes (P7.1-3).** `labels.minutesText`: anything that rounds to 0 is "< 1 minute" (Analyse sheet, job card time left,
Jobs).
**Unnamed roads (P7.1-4).** `streetpick.unnamed_label`: the named cross streets at the ends (≤ 15 m, or crossing ≤ 3 m;
OSM names, then Google's name for an unnamed end road): two → "Unnamed road between A and B", one → "Unnamed road near
A", none → "Unnamed road" (the D36 "off A" and far "near <nearest>" forms are gone). The clicked street keeps the
picker's name on every record too (`jobs.fill_street_names` now replaces the pipeline's Google route name for it, which
named the cross street: "Kattabomman Street", "3rd Street, Sridevi Nagar"). The two live unnamed roads were relabelled
with `tools/relabel_live_streets.py --write` (files + DB reload + job input; slugs unchanged): "Unnamed road near
Kattabomman Street", "Unnamed road near 4th Street". A Google look-up skipped for time makes the answer incomplete (not
cached).
**OSM lookup (P7.1-5).** Every Overpass query races both mirrors in a background pool (failed mirror retried, 45 s in
total); a click waits ≤ 5 s (`BUDGET_S`), the browser ≤ 8 s. Roads are fetched per ~330 m tile (+80 m margin, so the
nearest-road rule is unchanged); resolved streets are cached by OSM way id (any click on the same road) and by rounded
click (complete answers only). Road found but details slow → shown with "OSM lookup slow — showing without OSM details"
and Retry; road itself slow → 503 with that message (or the nearest analysed street). A timed-out click finishes in the
background, so Retry is answered from the cache.
**Planner estimate (P7.2-6).** `backend/app/planest.py` runs run_area stages 1–3 with the pipeline's own code and
Config defaults (StreetView.discover, Area footprints + streets, capture_plan, building_register) in a background
thread; `POST /jobs/preview` starts it, `POST /jobs/plan-estimate` (trimmed stretch) and `GET /jobs/plan-estimate/{key}`
follow it; results cached (memory + data/cache/planest). Images = planned views + one building photo per building faced
(the worker's cap rule, an upper bound). $ = images × model-card Street View price + images × cloud-AI $ per image;
minutes = images × seconds per image. Rates from completed live jobs that ran from the start (live_run.json not resumed,
not a replay; pooled; job time = claim → upload): today Kattabomman (33 images, 3.1 min) + Vadakku Masi Veethi (162,
6.1 min) = 2.84 s and $0.000075 per image; Ward 29 full run as the fallback. CPU: model card 18 min per Ward 29 street /
142 images. Places look-ups counted, not priced (no price recorded). The length-scaled estimate (`views.job_estimate`,
`POST /jobs/estimate`) is removed. Ward 29 check (study area, its 10 streets, fresh discovery): 749 panoramas, 201
cameras, 1,132 views + 373 buildings = 1,505 images, $10.65, 71.1 GPU min vs the real full run 1,420 images, ≈ $10.03,
11.5 min. Time is ~6× high because the two small jobs' per-image time includes the fixed start-up (model loading); the
Ward 29 rate would give 12.2 min. Reported as is, not tuned. Pillow added to the backend venv (streetview imports it).
**Cost cap (P7.2-7).** `JOB_COST_CAP_USD` (default $2) is stored on each new job with the estimate's rates; the worker
uses the job's cap and rates (else its own `MAX_USD_PER_JOB`, now 2.00); the confirm sheet has an editable cap. Earlier
jobs keep theirs.
**Hood photo cost (P7.2-8).** Original areas: photos = views fetched (_views_done.json) + reliable building views
(building_views.json; one building photo each) — Ward 29 1,154 + 266 = 1,420, $9.94 — with the source as caption and
tooltip.

## 2026-10-01 — P7 Round 2 (R1 fixes, layers and linking, name picker, sign rule on Trust)

### D47. Time model, F2 street names, estimate timeout, camera-only layer, linked boxes, pole wording, name picker, sign spot-check
**F1 time model.** GPU minutes = start-up + images × per-image rate. Per-image: Ward 29 full run, 11.5 min / 1,420 images
= 0.49 s. Start-up: median over completed GPU jobs that ran from the start of (job time − images × 0.49 s): Kattabomman
172 s, Vadakku Masi Veethi 286 s → 229 s (3.8 min). Estimates vs real: Ward 29 1,505 images → 16.0 min (real 11.5, a
pipeline run without job start-up); Kattabomman 35 → 4.1 min (real job 3.1); Vadakku Masi Veethi 167 → 5.2 min (real
job 6.1). Not fitted: two measured inputs, one formula.
**F2 street names.** OSM name → else Google's name for the road ITSELF → else "Unnamed road between A and B / near A /
Unnamed road". Google's name counts as the road's own only when (1) the same route name comes back at most of up to 3
sample points along the road's middle, each > 25 m from the junctions (where reverse geocoding answers with the cross
street), (2) Google's point for that route lies ≤ 25 m from the clicked road, and (3) it is not the name of a cross
street at its ends (OSM, or Google's name for an unnamed end road). `streetpick.google_own_name`, cached 30 days.
Live areas re-labelled (tools/relabel_live_streets.py): 4th Street area → "3rd Street, Sridevi Nagar" (2 of 3 samples, on
the road); Kattabomman area → "Kattabomman Street Extention" (Google's spelling; its middle sample answered "Kattabomman
Street" with a point ~50 m away = the cross street, rejected). Sanganur Road, Vadakku Masi Veethi: OSM names.
**F3.** The confirm sheet stops waiting for the planner after 90 s: "Estimate slow (map server busy) — you can still
start; the cost cap protects you." (Check again); planning continues on the server; Start never waits.
**F4.** `# pyright: reportMissingImports=false, reportMissingModuleSource=false` heads worker/colab_worker.py.
**Camera-only buildings.** `GET /areas/{slug}/camera-buildings` from building_positions.json `no_footprint` (rays
crossing where OSM has no outline); toggleable layer (sodium diamonds, street zoom), count in the Key. Ward 29: 9.
**Linked boxes.** A building's evidence photos mark every sign box linked to it by sign_links.json (D44) as "part of this
building"; the drawer says "1 building · N shop signs linked to it, in M photos" (N counts sign boxes: one shop can be in
several photos), or "no shop sign in the photos is linked to it".
**Poles.** Hover and drawer: "1 pole on the map · seen in N photos" (n_detections); Hood chapter 04 now says the
958 pole and 120 lamp-head boxes are photo boxes, merged into 268 poles and streetlights.
**Street-name picker.** tools/street_name_candidates.py writes street_name_candidates.json per area (OSM, Google
pipeline vote — kept in street_names_pipeline.json once the app changes street_names.json —, the F2 rule, the
synthetic register's raw label, Places: no street names stored). Hood › Street names lists mismatches, default = F2.
A pick goes to data/street_name_picks.json and is applied by the loader and the JSON store (namepick.apply); the area
is reloaded; no source file changes.
**Sign rule on Trust.** model_card.sign_links from tools/validate_sign_links.py (Ward 29: 570 of 2,065 sign boxes moved;
30 moved read signs with a Google pin: 14 closer, 6 further, 1 same, 9 to/from no outline; median 3.5 m closer).
tools/sign_spotcheck.py draws 20 random moves (seed 2026, from all 570). AI first pass (Claude Code viewed each photo
once — 20 Street View requests, $0.14 at list price, deleted after): 11 move looks right, 0 wrong, 9 can't tell; 6 of
the 20 boxes are not shop signs. Shown on Trust as "AI visual check (Claude Code), not a human check", with a
one-photo-at-a-time spot-check a person can redo (verdicts kept in that browser).

## 2026-10-01 — P7 hotfix (street lookup, plain wording, city labels)

### D48. "Pending" instead of 503, raced mirrors with health, one tile query, plain words, no city badges
**Why /jobs/preview kept answering 503.** Since P7.1 a lookup still running after 5 s raised OverpassSlow → 503, and every
Retry waited 5 s and got 503 again while Overpass took 20–40 s per query (measured: overpass-api.de 27–39 s or 504,
maps.mail.ru 20 s or 504, kumi.systems and private.coffee timing out). Fixes:
- **202 pending.** /jobs/preview waits ≤ 4 s per ask; still running → 202 `{status: pending}`; the lookup continues in the
  background (`_finish_later`), so the next ask is answered from the cache. 503 only when every map server failed for
  60 s ("Map server is busy — try again in a minute."). The browser shows "Finding street…" and asks again every
  0.8 s up to 30 s, then the busy line + Retry; the street appears by itself when it lands.
- **The road first, details after.** One Overpass query per tile now returns every road (any highway class); the
  clicked road is still chosen among the pipeline's classes, and the roads at an unnamed road's ends come from the same
  answer when its ends lie inside the tile (no second query). When only a named street's full length is missing, the
  street is shown at once (`status: partial`, "Finding the full street…", Start disabled) and swapped for the full one.
- **Mirrors.** overpass-api.de, overpass.kumi.systems, overpass.private.coffee, maps.mail.ru raced in parallel; a mirror
  that is unreachable or times out rests 5 min (`alive_mirrors`), a 429 / 5xx one does not; a 200 with a runtime-error
  remark is a failure. Regional instances are excluded. `/health` reports `map_servers`.
- Cache writes survive the Windows replace race; the planner estimate's cache key is the street line (≈ 1 m), so the
  same street clicked elsewhere reuses it; an incomplete street starts no estimate.
**Plain wording (H2).** Analyse, the job card, Jobs, the top bar and the main drawer lines say "Finding street…",
"Estimating cost and time…", "Estimate not available right now. You can still start — the $2 cap protects you.",
"analysis computer", "Time" (no GPU / CPU / OSM / pipeline / planner / worker / way id). "How do we know?", Under the Hood
and Trust stay technical (D16).
**City labels (H3).** The city-zoom name badges are gone (outlines only; name and counts on hover). No other app layer
draws map text.
**Verification rule** added to CLAUDE.md; `web/scripts/screenshots.ts` (Playwright, dev-only `window.__gcMap`).

## 2026-10-01 — P7 Round 3 (tour, audit, performance, docs, demo cache)

### D49. Guided tour, demo-day cache, honest fallbacks, audit fixes
**Leftovers.**
- **Map caches (A1).** The street / road caches were already on disk (`data/cache/streetpick/`, keyed by query, way id and
  rounded click) and survive API restarts. New `tools/warm_osm_cache.py` + `tools/demo_streets.json` (an editable list):
  roads around every analysed area and every job, the building outline under each dropped camera (Hood examples), and
  for each demo street a click every 100 m along it plus its cost estimate; slow servers are retried until done. Run on
  1 Oct: **28.4 min** while OpenStreetMap answered with 504s (a first attempt was stopped after ~10 min by the shell's
  time limit; three estimates were recomputed afterwards, see below). `--check` blocks every request in-process: all six
  demo streets answered from the cache, slowest click 30 ms. Through an API whose outgoing requests all fail (a dead
  proxy): demo clicks in 0.6–1.1 s with their estimates; an uncached street → 503 "Map server is busy — try again in a
  minute." after 12 s. `minimap.roads_query` / `outline_query` / `job_bounds` are shared with the tool, so it fills the
  same files the API reads.
- **Planner bug found while testing (A1).** The pipeline's Street View search returns nothing on any error (D40), so a
  network failure during planning was cached as "no Street View, 0 photos". It happened to three demo streets while the
  blocked-network API ran. `planest.plan_street` now makes one free metadata call when the search is empty; unless
  Google answers OK / ZERO_RESULTS / NOT_FOUND, the estimate fails ("Google Street View could not be reached…") and is
  not cached. The three bad files were deleted and re-planned: Dr Alagesan Road 314 photos ($2.22), "Unnamed road near 5th Street" 21 photos ($0.15) — not the cached 0; Pioneer Mills Cross Street failed three times on a busy OpenStreetMap; the warm-up now retries estimates too, and a later run (29.4 min, "Everything cached") cached it: 63 photos, $0.45, 4.3 min. All six demo streets now have their street lookup and estimate cached. pytest covers it.
- **Hood cost caption (A2):** "Photo cost is at Google's list price — Google's free monthly allowance may cover it."
  The cloud-AI (AWS) cost stays as measured. Also fixed: the original areas' line read "about 9.94" (the `$` was eaten
  by the template literal).
- **Worker upload (A3).** `/worker/result` went through `call_or_ask`, which retried, but the files were opened once, so
  a retry after a network blip would have sent them empty. `upload_result`: files reopened for every try, back-off
  5 / 15 / 30 / 60 / 120 s, then the usual "Paste the new tunnel URL" prompt; a 409 "job is done" after a lost answer
  counts as delivered; a 4xx is not retried. pytest with a fake API. **Re-paste the worker cell.** The pipeline is
  unchanged: no new package zip.
- **Sign boxes (A4).** Trust › Detector: "In a 20-photo check, 6 of the 20 boxes counted as signs weren't shop signs
  (billboards, a gate, a house number, a STOP sign, a pole poster)", labelled as the AI visual check (Claude Code), not a
  human check; the detector was not retrained. The numbers are read from `sign_spotcheck_ai.json`.
- **Test hooks (A5).** `window.__gcMap` / `__gcOverlay` are behind `import.meta.env.DEV`; the production `dist/` contains
  neither (grep). The `?perf=1` heap readout stays (an owner tool, not a test hook).

**Guided tour (P7.5).** `components/Tour.tsx`: seven steps (key numbers → a building's evidence → Review → Analyse a
street → Jobs → Trust, Gate 1 "Not verified" → done), started from **Tour (?)** on the rail; it opens once on the first
visit (`gc.tourSeen`). Esc closes it (capture phase, so it never also closes the panel underneath); ← → and Enter step;
focus sits on Next; a sodium ring marks the step's target; the Analyse step's card sits top-right, clear of the bottom
sheet. Each step reads only what exists (no area / building / worker / model card → it says so). Checked live in both
themes (`web/scripts/tour-shots.ts`, every step screenshotted).

**Polish audit (P7.6).**
- **States.** Evidence photos and the drawer say what is loading; an API error on the evidence says so, with Try again
  (it used to say "No Street View evidence stored"); a record missing from the loaded area says so instead of loading
  forever; the panel shows the area's load error; the drive tells a 404 from an API failure; the planner's "no key"
  message is in plain words.
- **API lost mid-session.** `apiReachable` was tracked but never shown. Now a banner ("The API isn't answering … What is
  on screen stays") that clears on the next good call.
- **No Maps browser key / Map ID.** The app used to stop at a splash. Now it opens without the map ("The map can't be
  shown", what to set, and links to Review / Under the Hood / Trust / Jobs, which work); photos say the key is missing;
  Live 360° is hidden.
- **Keyboard and themes** (`web/scripts/audit.ts`, both themes): Tab order with a visible ring on every stop (the map
  canvas and the ask field mark focus their own way); Ctrl K opens and Esc closes the palette; Esc closes the panel, the
  drawer and Analyse. Daylight `.btn-solid:hover` was light text on light orange (~2.4:1) → sodium mixed with ink.
- **Numbers (C3).** Ward 29, database vs UI, all equal: 381 buildings · 50 differ · 27 not in the register · 139 use not
  known · 96 names read clearly · 218 review items (218 waiting) · 11 dark stretches · 268 poles and lights (38 + 230) ·
  Gate 1 camera-derived median 2.8 m, 60.4% ≤ 3.5 m, n = 260, status "Not verified" (`tools/audit_numbers.py`).
- **No pooled Gate 1 row.** Trust showed the pooled "all buildings" rows (front-wall centre 73.0%, OSM wall 95.3%). Both
  count points that score 0 m by construction, and D27 said the second is never shown. Both map-referenced tables now
  leave them out, with a note; the Google-pin table keeps its pooled row (an independent reference). "73%" appears
  nowhere in the app or the docs.
- **Performance (C4).** Production build, Chrome DevTools Protocol, JS heap after GC, two runs: Ward 29 idle 21.6 / 25.4
  MB; the tour's building step 44.5 / 45.3 MB; after the whole tour 45.6 / 46.3 MB (target ≤ 60). At street / object
  zoom about two-thirds of the sampled live heap is Google Maps JS and 8–9% deck.gl. No layer or data was hidden.
  API: `/areas` made one pooler round trip per area for the version check (1.4–4.5 s); `DbStore.slugs` now returns every
  version in its one query → ~0.5 s (the first load after a restart still reads every area, ~18 s).
- **Fallbacks (C5)**, `web/scripts/offline.ts` (production preview; extra APIs on :8001 with every outgoing request
  blocked and on :8002 with both Google keys empty): map servers blocked, analysis computer offline (a test job stays
  "Queued"), Google keys missing, API down mid-session — all pass. A tunnel that is down is the worker-offline case for
  the app, plus the worker's own retries (unit-tested).

**Docs (P7.7).** README (demo-day steps in order; the tunnel on `127.0.0.1`, because Windows may resolve `localhost` to
IPv6; the fallback table; tests), `worker/colab_setup_cells.md` (each cell described; the exact S0 / S1a / S1ba / S1bb
text marked "PASTE CELL HERE"), CLAUDE.md, DESIGN.md (Hood chapters, tour, states), the pages document, and the
explainer (§13.3 estimate, §13.4 memory, §18, appendices) brought up to date.

## 2026-10-02 — P8 (review fixes)

### D50. Cloud-AI cost recount, Routing and cost, photo dates, possible dark stretches, front wall, Tamil, imagery storage
**1. Why "$0.0887" ≈ "$0.089 without the router" (answer).** A miscount in the model card's *with-router* figure, plus one
real effect. Recounted from Ward 29's saved calls (`backend/app/routing.py`; tokens × the pipeline's Nova Lite prices):
- The model card's **$0.056 / 339 calls** is `meta.run.vlm_cost_usd / vlm_calls` of a **resumed** run: 339 = 73 use calls +
  266 floors calls. The 166 name checks and 84 business-sign checks were re-used from saved files and not counted.
- Its **$0.089 / 782 calls** counts all four kinds with every building's use in the cloud: 266 + 266 + 166 + 84 = 782. The
  recount gives **$0.0889** — the model card's number, reproduced.
- **Like for like with the router: 589 calls, $0.0702** (use $0.0071 measured, floors $0.0493 derived = run counter −
  use calls, names $0.0091 measured, business signs $0.0046 estimated at the name check's per-call cost; same prompt).
- Real effect: the router skips 193 use calls (25% of calls) but saves only ≈ $0.019 (21%): a use call costs ≈ $0.000097,
  while the floors call (two solved examples + the photo, ≈ $0.000185) is 70% of the bill and runs for every building.
- Cross-check: Vadakku Masi Veethi (a full live run) — its counter (123 calls, $0.0134) equals the recount; floors call
  measured $0.000187, use $0.000098, names $0.000055.
- **The fresh 28 Sep run ($0.0887, "router on")** matches the no-router figure (+ ≈ 190 use calls). Likeliest cause: the router
  file was not found, and `run_area` silently sent every building to the cloud. **Fix (pipeline, logging only):** a warning
  and `meta.run.use_router` ("local" / "off: file not found (…)" / "off: not configured"). Not confirmed: that run's files are
  not in the repository. model_card.json is not edited; Trust › Stored vs computed lists both model-card rows with the
  recount, and the "every building to the VLM → router" experiment notes that 339 is not like for like. Hood's Ward 29
  cloud-AI line is the recount; a resumed live run's line uses the recount too (its counter covers only the last part).
- Worker estimate constant `VLM_USD_PER_BUILDING` 0.056/381 → 0.0702/381 (used only when a job carries no rates).

**2. Under the Hood › Routing and cost** (new section, all areas): per task (detect · signs · use · floors · business
signs) the local and cloud routes with count, time per call (median `lat_s`; detector 17 ms/photo on a T4 from the model
card; local OCR / CLIP time not measured) and $ with its status (measured / derived / estimate / not recorded). Three
totals: as run, no local router, and **cloud model on every photo = an estimate** (1,154 planned photos × the measured
one-photo use call, $0.000097 → $0.112, ~7.5 min of calls 4 at a time), next to the model card's measured whole-photo
names test (n=16: $0.105 vs $0.0079, 56% = 56%). Accuracy, both n=31 from the model card: use 90% cloud only / 94% local
only / 90% routed; names 65% / 71% OCR only / 74% routed. Trichy and Tiruppur stored no floors tokens and have no
covering counter: their total is "not recorded" (the known parts are shown).

**3. Photo dates.** `panos.json` already stores each panorama's capture month (all 7 areas, every panorama). Nothing
fetched. `GET /areas/{slug}/imagery` (`imagery.py`) and `date` on every evidence view. Drawer/Review badge "Photo from
Nov 2022" (orange "· over 3 years old" past 36 months). A *not in register* building, an *unrecorded* pole/light, a
*register entry not seen* or a *dark stretch* whose **newest** photo (own evidence; for stretches and entries, camera
stops within 30 m) is older than 36 months gets "Imagery may be outdated". Ward 29 (as of Oct 2026, cutoff 2023-10):
photos Jun 2018 – Feb 2026, 40 of 203 camera positions older; flagged 4 buildings, 4 poles/lights, 1 stretch, 1 entry.
Hood coverage card and Compare show each area's range.

**4. "Possible dark stretch"** everywhere a user reads it (key number, list, card, hover card, layer, key, drive, query
chip, tour, Hood, Jobs, Trust card title). The list, the drawer card and the hover card quote the lamp-head recall from
the model card (43%, n=49); Trust's card says "the app calls it a possible dark stretch".

**5. Front wall** in the building drawer: length of the outline's road-facing edge (`buildloc.road_facing_edge`, the
same wall as the Gate 1 position) plus straight continuations (≤ 12°, ≤ 0.6 m off its line; jogs < 1 m only need to stay
on the line), source in "How do we know?" (`GET /buildings/{area}/{id}` → `front_wall`). The export's
`footprint.frontage_m` is the longer side of the outline's rotated rectangle, whichever way it faces — not the front:
in Ward 29 the street-facing wall is < 60% of it for 119 of 381 buildings. Shown as a note when they differ ≥ 1 m.

**6. Tamil questions** (`queryparse.tamil`, run before the English rules; table in docs/QUERY.md). Stems for shop,
commercial, building, house, residential, pole, light, street, road, floor, register, unmatched, discrepancy, review,
Google, chart, count, show…; phrases for Tamil word order (N மாடி… மேல் = more than N floors; பதிவேட்டில் இல்லாத = no
record; விளக்கு இல்லாத = no streetlight; 60 மீட்டருக்குள் = within 60 m; தெரு வாரியாக = by street; குறைந்த நம்பக… =
low confidence). இல் only as a whole word (never swallows இல்லாத). Tested live and in pytest: the four spec questions +
"poles on Sathy Main Road" in Tamil = the English filters and row counts, status ok, nothing ignored. Unknown Tamil words
(e.g. மரங்கள்) are still "ignored".

**7. Street View imagery stored (inventory, 2 Oct).** `data/` 0 images (derived JSON only); git 0 (screenshots and caches
git-ignored); `docs/screenshots/` 92 PNG / 41 MB before P8 (+26 P8 shots), local only — evidence drawer, Review, Drive and
tour-building shots contain Street View photos; Colab `gc_jobs/<slug>/crops_*` and Drive `gc_worker_jobs/<job>` hold crops
only while a job is unfinished or retryable; Drive `alldataset` (notebook era, floor examples) not visible from the
laptop — owner to check. The worker already deleted the job folder after delivery (P6); now `forget()` counts and reports
the crops it deletes, deletes any locked images one by one and warns if one is left. Nothing existing was deleted.
**Re-paste the worker cell; upload `geo_cascadia_pkg_p7b.zip`** (run_area change).

**8. Review route** (`tools/review_route.py`): the 218 waiting Ward 29 items as one walking order (nearest neighbour +
2-opt, straight lines: 6,628 m) → `data/exports/review_route_ward29.csv / .geojson` (git-ignored, regenerable).

Tests: `backend/tests/test_p8.py`; the D23 Tamil test now uses an unlisted word. Dev-only hook `window.__gcUi` (store) for
`web/scripts/p8-shots.ts`, absent from the production build like `__gcMap`.

### D51. Frontage = the road-facing wall; the old value is "longest side"; cost split on Routing and cost (P8 follow-up)
**Frontage.** The pipeline's old `frontage_m` is the longer side of the outline's minimum rotated rectangle, whichever way
it faces — not the front. Every place it was shown or used:
- `export.json` `footprint.frontage_m` (all 7 areas) now holds the frontage = the road-facing wall + straight
  continuations (`buildloc.front_wall_length`, moved from the backend into the pipeline so both share it); the old value
  is `footprint.longest_side_m`; `frontage_source` says where it comes from. Applied from saved files only by
  `tools/frontage_fix.py --write` (originals in `data/cache/p8fix_before/<slug>/`; nothing else in the files changed,
  checked field by field; a second run changes nothing); the database was reloaded (row counts = meta.counts). Ratio
  frontage / longest side, median: Ward 29 0.75 (< 0.6 for 119 of 381), Trichy 0.59 (35 of 66), Vadakku Masi Veethi 0.51
  (28 of 49), Sanganur 0.70 (21 of 52), 3rd Street 0.68 (8 of 25), Kattabomman 0.76 (2 of 8), Tiruppur 0.32 (1 of 1).
- Pipeline export (new live runs): `predict_positions` stores `front_wall_m`; `export.py` writes it as `frontage_m` and the
  longest side as `longest_side_m`. Inside the pipeline (`plan` → `match` / `register` → `buildings.json`) the internal key
  `frontage_m` keeps the longest side (renaming it would break resumed runs); no rule uses it. **Upload the rebuilt
  `geo_cascadia_pkg_p7b.zip`** (worker cell unchanged in this follow-up).
- Drawer: "Front wall" → **Frontage** (row and "How do we know?"); the longest side appears only as a labelled note.
- Web schema (`types/export.ts`): `frontage_m` nullable, `longest_side_m` and `frontage_source` added.
- Not shown or used anywhere else: the findings table, the question engine, `export.geojson`, the review-route export,
  Hood, Trust and the run report never read it. "frontage" in sentences such as "photos face frontage with no building
  outline" means the street front in general, not this value, and is unchanged.

**Cost split.** Routing and cost opens with one line computed from the run: Ward 29 "This run cost about $10.01: Street
View photos $9.94 (1,420 at Google's list price, 99%) and cloud AI (Nova Lite) $0.070 (0.7%). Floor counting is the
largest AI cost; it isn't routed yet." The floors sentence appears only when floors is the run's largest cloud route.

## 2026-10-02 — Gate 1 per building in the drawer

### D52. Each building's own position error, from Trust's own rows; camera-only buildings clickable; corner fronts
**What the drawer shows** (`backend/app/gate1pos.py` → `GET /buildings/{area}/{id}` `position_check`; Explore drawer row
"Position", details in "How do we know?"):
1. **Camera-derived position** (triangulated or wall_hit): "Position: X.X m from the middle of the front wall on the map
   (target ≤ 3.5 m)" with ✓ within / ✗ outside. The number is the building's row in `gate1_eval.json`
   (`official_front_m`), the same set and reference point as Trust's "All camera-derived positions" row. A value that
   rounds to 3.5 but is above it shows two decimals (no "3.5 m ✗"). Areas Trust does not cover (analysed from the app)
   get the distance computed with the same wall (`frontwall.road_edge`, shared with Frontage); it reproduces every stored
   Ward 29 row to < 0.005 m (pytest), and "How do we know?" says the area is not in Trust's table.
2. **Position from the outline** (wall_centre; footprint_centre has 0 buildings): "Position taken from the map outline —
   error not measured." No distance is returned for this case, so "0 m" can't appear.
3. **Camera-only building** (`building_positions.json` `no_footprint`, the orange diamonds): the diamonds are now
   clickable (hover card + drawer): "No map outline for this building — error can't be measured.", plus the stored
   uncertainty (largest ray residual, ≥ 0.5 m) as "About ±N m", labelled as camera agreement.

**Ward 29 counts:** case 1 = **260** (all 260 from Trust's rows; median 2.8 m, 60.4% ≤ 3.5 m = Trust), case 2 = 121,
case 3 = 9. Trichy 49 / 17 / 79 (49 = Trust's n, 3.64 m, 49.0%), Tiruppur 1 / 0 / 12.

**Corner buildings** (display only; no rule changed). An outline wall ≥ 3 m faces a street when the line straight out of
its middle meets a road within 10 m without crossing another analysed building; a hit within 4 m of the building's own
street is that street. Roads: the analysed streets + OpenStreetMap's roads from the mini-map cache (service ways left
out; most Ward 29 residential roads are unnamed in OSM, so unnamed roads count). A wall turned 60–120° from the front is
a corner, > 120° a street behind. Either adds "Front wall chosen: the one facing <street>"; "How do we know?" lists the
other walls. Ward 29: **157** buildings with another street-facing wall — **131 corners**, 26 with a street behind only.
Ganapathy's narrow blocks have lanes on several sides, hence the high share. Limits: outlines that are not analysed
buildings don't block a wall's line; without the cached roads only the analysed streets are checked (the answer says so).

**Tests / checks:** `backend/tests/test_gate1_drawer.py` (Trust set and numbers for all three Trust areas, the computed
distance vs the stored rows, no distance for case 2, corners, a synthetic corner block, the endpoint);
`web/scripts/gate1-shots.ts` (both themes); `docs/P7_MANUAL_CHECKS.md` item 36.

## 2026-10-03 — local map data (branch local-osm)

### D53. OpenStreetMap + Microsoft footprints for four cities in PostGIS; Overpass only elsewhere; the 50 m question
**Why (measured, Phase A).** The Bharathiar Road run's area stage took 487.9 s of a 10.9 min job. Re-run alone on the
laptop with empty caches: **466.3 s = Microsoft dataset index 111.2 s (7.2 MB) + Microsoft tile 330.5 s (35.6 MB) +
Overpass 19.3 s (buildings 12.8, roads 3.5, shops 3.0) + processing 5.3 s**. The run's log line "footprints osm 12 +
microsoft 16" is a count of outlines, not seconds. So the slow part was Microsoft's download, not Overpass; street clicks
still waited on Overpass (10–65 s, or "busy").

**Owner decisions (3 Oct):** all four cities; Microsoft footprints too; the 50 m question as a backend `ST_DWithin` rule;
a pipeline hook (new zip p7c, re-paste the worker cell); Tiruppur 16 × 16 km box; the refresh cost is fine. Loading rule:
one city at a time, size checked after each, stop above 65 % of 500 MB.

**Cities and sizes.** Boxes = the OSM city boundary + 550 m: Coimbatore (the 5 Corporation zone relations), Trichy
(relation 10318360), Madurai (11268397); Tiruppur has no city boundary in OSM → 16 × 16 km on its city node. Every
analysed area and demo street lies inside one. Sources: Geofabrik `southern-zone` extract (snapshot 2026-10-02T20:21:34Z),
Microsoft Global ML Building Footprints India release 2026-02-23 (5 level-9 tiles). **Microsoft has no outlines around
Tiruppur** (its India coverage stops near longitude 77.15). Phase A measured the sizes in a throwaway local PostGIS
(PG 17 / PostGIS 3.6, same on-disk format); the real load into Supabase (PG 17.6 / PostGIS 3.3.7):

| city | km² | roads | OSM outlines | shop points | Microsoft | database after |
|---|---|---|---|---|---|---|
| (before) | | | | | | 29.7 MB |
| Coimbatore | 502 | 37,778 | 160,390 | 2,666 | 280,995 | 155.4 MB (31.1 %) |
| Trichy | 167 | 10,865 | 92,545 | 1,005 | 97,038 | 207.8 MB (41.6 %) |
| Tiruppur | 256 | 11,273 | 551 | 303 | 0 | 211.2 MB (42.2 %) |
| Madurai | 431 | 19,630 | 36,077 | 1,469 | 183,610 | 270.5 MB (54.1 %) |

Supabase Storage: 0 files (unchanged). Loading took 17.8 min (Coimbatore 369 s); the extract took 164 s to read.

**Tables** (migration 008): `map_cities` (box, box source, OSM snapshot, Microsoft release, counts), `osm_roads` (way id,
highway, name, bridge, tunnel, line), `osm_buildings` (the pipeline's own ids `w<way>` / `r<relation>_<member index>`),
`osm_pois` (shop / amenity / office nodes; shop / amenity ways as the centre of their bounding box, Overpass's
`out center`), `ms_buildings`; GiST on every geometry, a b-tree on road names; RLS on, no policies. A feature that touches
a box is kept whole.

**Import / refresh** (`tools/import_osm_local.py`; `--refresh` monthly): reads the extract with pyosmium, one
transaction per city, and **writes only what changed**: each row's WKB md5 is compared with PostGIS's
`md5(ST_AsBinary(geom, 'NDR'))` (roads also hash name / class / bridge / tunnel; Microsoft rows are keyed by geometry).
A delete-and-reload refresh would have peaked at ~382 MB (both copies of a city exist until commit), above the 65 % rule.
Checked: a refresh with the same snapshot changed only the shop-way centres (moved from node mean to bounding-box centre,
the Overpass rule: Coimbatore 678, Trichy 143, Tiruppur 73, Madurai 466 rows) and left all ~900,000 other rows unchanged;
270.5 → 270.8 MB. Prints the database size before / after each city and stops above `--max-db-mb` (325). The extract is read in a child process: pyosmium keeps its 2.5 GB node-location file memory-mapped until the process ends, so on Windows it could not be deleted (found after the first load; deleted by hand, now automatic, tested).

**Where it is used** (`backend/app/mapdata.py`): the same Overpass query texts are answered from PostGIS when their box
(or every point + radius) lies inside a covered city, in Overpass's own element format, so callers did not change:
- street click (`streetpick`): the ~330 m road tile, the named street within 1.5 km, the roads at an unnamed road's ends;
  the clicked road's candidates come from a **PostGIS nearest-neighbour** query (`<->` on the index, k = 8) and the old
  rule picks among them (local-metre distance, ties to the lowest way id as in Overpass's id-ordered answer). First
  version took PostGIS's nearest directly: the Dr Alagesan Road demo point lies on a junction (two roads at 0 m) and
  resolved to the unnamed side road (64 m) instead of Dr Alagesan Road (1,201 m); fixed and tested;
- mini-maps (roads around an area, the outline under a dropped camera);
- the cost planner and the worker's area stage, through a **pipeline hook** `geo_cascadia.area.MAP_SOURCE` (plumbing
  only; unset = unchanged). In the API it answers from PostGIS; in Colab the worker cell's `MapSource` asks
  `POST /worker/mapdata` (worker token, over the tunnel; no database access and no new secret in Colab) and records what
  answered in `worker_run.json` `map_data`. Microsoft rings come from `ms_buildings` the same way; the pipeline's own
  "< 8 % OSM cover" rule still decides whether they are used. `check_pipeline` refuses a package without the hook.
- Outside the cities: Overpass as before (raced mirrors), answers and resolved streets kept **30 days** on disk; the
  worker's request falls back to its own Overpass / Microsoft call when the API answers `none`. `LOCAL_MAP_DATA=0`
  switches the copy off. A database failure sends map questions to Overpass for 30 s (logged).

**Display.** Under the Hood's coverage card: "Map data: OpenStreetMap snapshot 2 Oct 2026 · Microsoft footprints 23 Feb
2026, held in the app's database for Coimbatore", what this area's run used (all existing areas: OpenStreetMap's servers
on their run day, before the copy existed), and both attributions (ODbL). The map footer adds "Map data © OpenStreetMap
contributors · building footprints © Microsoft" on a second line (one line covered Google's logo at 1366 px).
`GET /mapdata` lists the cities.

**The 50 m question** (`backend/app/spatial.py`): "… within N m of a possible dark stretch" (also "near a dark stretch" =
50 m) is taken out of the question before QueryEngine reads the rest; QueryEngine's building rows are then kept when the
outline (point if none) is within N m of a stored 60 m stretch **as the map draws it** (along-road path, else the
recorded segment), PostGIS `ST_DWithin` on geography; offline mode the same rule with shapely (pytest: identical ids).
New chip "Dark stretch · within 25 / 50 / 100 m", why-empty step, example question. "not-in-register" (hyphenated) is now
a register synonym. **Ward 29: "Show not-in-register buildings within 50 m of a possible dark stretch" → 15 of the 27
not-in-register buildings.**

**Verification (3 Oct).**
- V1 (`tools/verify_local_map.py`): the pipeline's own area-stage code, local copy vs live Overpass (fresh caches), for
  the 8 analysed areas and 6 demo streets: roads, names, total length, outline counts (OSM / Microsoft) and outline id
  sets **identical in all 14** (e.g. Ward 29 145 roads, 21,210 m, 2,183 outlines; Vadakku Masi Veethi 1 + 110;
  Bharathiar 11 + 15). Re-run after the junction fix, also comparing shop points and street kind (commercial /
  residential): identical again in all 14 (Dr Alagesan Road now resolved as before: 16 roads, 2,301 m, 120 outlines).
  No difference to explain. Output: `data/exports/local_map_check.json` (git-ignored).
- V2 (real API, empty caches, one API at a time): street click 42.9 / 64.5 / 16.3 / 5.0 / 2.9 s → 2.8 / 1.0 / 0.9 / 3.4 /
  3.0 s; estimate 83 / 120 / 126 / 243 / 27 s → 37 / 38 / 31 / 15 / 7 s (Sakthi Main Road, Ganapathy - Avarampalayam
  Road, Dr Alagesan Road, Pioneer Mills Cross Street, Unnamed road near 5th Street; the last two "before" reused tiles
  fetched for the first three). Same street and length in all five. What remains of the estimate time is Google's
  Street View search. Area stage, Bharathiar Road: 466 s → 1.0–1.2 s through the API (as the worker asks, without the
  tunnel), 2.5–2.7 s in-process with a fresh database connection; same 12 + 16 outlines. Laptop → Supabase round trip
  0.44 s, a new connection 7.9 s.
- V3 (an API whose outgoing requests go through a dead proxy, Google exempted): the 5 demo clicks and estimates work
  (source local); Salem and Erode clicks → 503 "Map server is busy — try again in a minute." after 12–13 s; the worker
  request is `local` inside (0.3 s), `none` outside; the Madurai mini-map shows 71 roads.

**Colab:** upload `geo_cascadia_pkg_p7c.zip` (package 0.2.1) and re-paste the worker cell.

## 2026-10-03 — lighting priority and the area report (branch report-lighting)

### D54. Lighting priority for possible dark stretches: a fixed points rule
**Why.** All possible dark stretches were shown as equal. An official needs to know which to look at first.

**Rule** (`backend/app/lighting.py`; written down before the first result was computed; not tuned afterwards):
- **Length** (the recorded length the app shows, D13): under 120 m = 1 point, 120–239 m = 2, 240 m or more = 3 (one
  missing 60 m interval, two or more, four or more).
- **Road type** (the app's OpenStreetMap copy, D53): the class with the most road length within 15 m of the stretch.
  Main road (trunk / primary / secondary and their links) = 3; connecting road (tertiary / unclassified) = 2;
  residential / living street / service / other = 1; no road found = 0 ("unknown").
- **Activity** within 30 m: analysed buildings whose use is commercial or mixed + OpenStreetMap shop / amenity / office
  points not inside one of those buildings + businesses read from signs with no analysed building (not inside one of
  those buildings, and not within 10 m of a counted OpenStreetMap point = the same place). 0 = 0 points, 1–4 = 1,
  5–9 = 2, 10 or more = 3.
- Total 0–9: **High 7–9, Medium 5–6, Low 0–4**. Order: points, then longer, then id. The three factors weigh the same.
- Distances: PostGIS `ST_DWithin` on geography to the stretch **as the map draws it** (along-road path, else the
  recorded segment), the same line as D53's "within N m". One query per area (Ward 29: 0.6 s), cached per area version.
- Reason in plain words, e.g. "376 m on a main road, 37 shops and businesses along it".

**Ward 29** (3 High, 3 Medium, 5 Low):

| # | stretch | street | length | road (OSM) | activity (bldg + OSM + signs) | points L+R+A | priority |
|---|---|---|---|---|---|---|---|
| 1 | gap60-001 | Sathy Main Road | 376 m | trunk | 37 (17 + 5 + 15) | 3+3+3 = 9 | High |
| 2 | gap60-010 | Sakthi Main Road | 142 m | trunk | 14 (5 + 8 + 1) | 2+3+3 = 8 | High |
| 3 | gap60-004 | Ganapathy - Avarampalayam Road | 193 m | secondary | 9 (8 + 1 + 0) | 2+3+2 = 7 | High |
| 4 | gap60-003 | 8th Street, Ganapathy | 313 m | residential | 7 (7 + 0 + 0) | 3+1+2 = 6 | Medium |
| 5 | gap60-002 | Sathy Main Road | 67 m | trunk | 5 (1 + 1 + 3) | 1+3+2 = 6 | Medium |
| 6 | gap60-006 | Sri Ganapathy Gardens 3rd Street (approx.) | 254 m | residential | 2 (2 + 0 + 0) | 3+1+1 = 5 | Medium |
| 7 | gap60-000 | 4th Street, Tatabad / Vinobaji Street | 211 m | residential | 2 (2 + 0 + 0) | 2+1+1 = 4 | Low |
| 8 | gap60-005 | 2nd Street, Ganapathy Gardens (approx.) | 203 m | residential | 2 (1 + 0 + 1) | 2+1+1 = 4 | Low |
| 9 | gap60-009 | 2nd Street, Gandhi Nagar | 99 m | residential | 4 (4 + 0 + 0) | 1+1+1 = 3 | Low |
| 10 | gap60-007 | Korathottam Road | 83 m | residential | 1 (1 + 0 + 0) | 1+1+1 = 3 | Low |
| 11 | gap60-008 | Korathottam Road | 78 m | residential | 1 (1 + 0 + 0) | 1+1+1 = 3 | Low |

Other areas: Trichy 5 High / 3 Medium (all on a primary road), Tiruppur 2 High / 1 Medium, Vadakku Masi Veethi 2 High,
Bharathiar Road 1 Medium, the 4th Street and Kattabomman areas 1 Low each. Levels are absolute points, not a ranking
within an area, so an area on one main road can be all High / Medium.

**Where it shows.** Every gap feature and gap question row carries `priority`, `priority_score`, `priority_reason`,
`priority_points`, `priority_road`; `GET /areas/{slug}/lighting` lists the table with the rule. The dark-stretch list
opens in priority order ("Fix first"; "Longest first" keeps the §10 test-2 order, and QueryEngine's rows are still longest
first); each row and the stretch card show High / Medium / Low with the reason; the hover card too; "How do we know?"
shows the points. **Map:** the stretch's edge carries the priority in one indigo hue (Night `#3a4680 / #7a86d6 / #c5cbff`,
Daylight `#c3c8e8 / #8691d2 / #3f4bb0`, low → high; lightness monotonic, adjacent ΔE ≥ 17 with the dataviz validator),
wider for higher; Low is close to the old edge, so colour is never the only cue (width, list, card, key).
**Questions:** "high / medium / low priority" is taken out before QueryEngine (like D53's distance) and keeps that level;
a Priority chip; example question "High priority dark stretches"; on a building question it is reported as ignored.
"possible" is now a filler word ("Show possible dark stretches" was read as "partial" before).

**Honesty.** The lamp detector finds 43% of lamp heads (model card, n = 49): the list, card and report keep saying
"possible"; the priority ranks candidates, it does not confirm them. Activity counts only buildings whose use is known
(Ward 29: 139 of 381 are not), and OpenStreetMap amenity points include some non-business places (no tags are stored).
**Offline data mode:** priority is not available (it needs PostGIS); the list falls back to longest first and says so.

### D55. Downloadable area report (PDF + Excel), for an area or one street
`GET /areas/{slug}/report.pdf|.xlsx?street=` (`backend/app/report.py`). Buttons "Download report: PDF · Excel" on the
area's "What stands out" panel and "Report for this street" on a street's panel (fetched as a file; a failure is said in
words). CORS now exposes `Content-Disposition` so the browser keeps the file name.
- **One content builder** for both files: the key numbers with the app's KPI formulas and labels (`derive.ts`), the app's
  plain labels (`labels.ts`, ported), D54's priority, Under the Hood's routing / cost and photo dates, Trust's Gate 1
  wording and model-card row, D53's snapshot dates. The PDF and the workbook render the same rows.
- **PDF (A4):** title, scope, date, the SYNTHETIC banner; key numbers (five + the rest); priority counts with the 43%
  sentence; data sources with dates (photo range and how many camera positions are over 3 years old, which OpenStreetMap
  the run used and the app's snapshot date, Microsoft release, register SYNTHETIC, model card). **Map** drawn from our own
  data: OpenStreetMap roads from the app's copy, the area outline, building outlines coloured by finding, possible dark
  stretches by priority with their list number, scale, north, "© OpenStreetMap contributors"; no Google tiles or photos.
  Landscape tables: possible dark stretches in priority order (with the rule), buildings with findings (id, street,
  location, use, floors, sign text, confidence, finding, register record SYNTHETIC, review status), poles and streetlights
  with a register finding, the review queue; each row links to a normal Google Maps URL. Then routing and cost (Hood's
  sentence and table), Gate 1 as on Trust, limits. Ward 29: 27 pages, about 9 s; Sathy Main Road: 8 pages.
- **Excel:** About (numbers, sources, limits) + Buildings with findings, Assets, Possible dark stretches, Review items,
  the same columns and values, links as hyperlinks.
- **Assets** = the ones with a register finding (not in the register / differs; Ward 29: 45 of 268), in both files.
- **Street report:** everything filtered to the street (the KPI formulas with the street); cost and Gate 1 are the area's
  run and say so.
- **Fonts:** the app's Anek Tamil, instanced to static TTFs by `tools/build_report_fonts.py` (OFL licence copied); Tamil
  sign text is shaped with uharfbuzz; ≤ ↑ → come from Windows' Arial when present, else are written as <=, ^, ->.
- **Libraries:** fpdf2, openpyxl, uharfbuzz (pip wheels, no system install); pypdfium2 for tests and page renders.
- **Test** (`backend/tests/test_report.py`), Ward 29 and Vadakku Masi Veethi: every key number = the API's dashboard / the
  map's stretch count; table sizes = the API's counts; stretch order, level and reason = `/lighting`; the cost sentence =
  Hood's routing numbers; photo dates = Hood's imagery; Gate 1 = the model card; Sathy Main Road's street numbers =
  `/query` with that street; the Excel sheets read back equal the tables, links included; the PDF's text contains every
  number, stretch and building id. Live: the UI's KPI ribbon for Sathy Main Road (44 / 2 / 10 / 2 / 10) = the street PDF;
  the audit's Ward 29 UI numbers = the area PDF.
- Offline data mode: the report still builds from the JSON copy, with priority "not available" and roads from the
  analysed streets only (said on the map).

## 2026-10-03 — final polish and regression pass (branch final-polish)

### D56. Fairer activity count, all assets in Excel, camera-only buildings next to the count, heap, regression script
**1. Lighting priority: activity counts readable shop signs too** (definition fix, not tuning; points thresholds and the
High / Medium / Low cut-offs of D54 unchanged). Use is not known for many buildings (Ward 29: 139 of 381), so counting
buildings by use alone undercounted. A building within 30 m now counts when its use is commercial or mixed **or** it
has a shop name read clearly from a sign linked to it (`name_quality = 'good'`, the app's "Shop names read clearly").
OpenStreetMap points inside such a building are not counted again. Ward 29, before → after:

| stretch | street | length | activity before → after | points before → after | priority before → after |
|---|---|---|---|---|---|
| gap60-001 | Sathy Main Road | 376 m | 37 → 39 | 9 → 9 | High → High |
| gap60-004 | Ganapathy - Avarampalayam Road | 193 m | 9 → 13 | 7 → 8 | High → High |
| gap60-010 | Sakthi Main Road | 142 m | 14 → 14 | 8 → 8 | High → High |
| gap60-003 | 8th Street, Ganapathy | 313 m | 7 → 7 | 6 → 6 | Medium → Medium |
| gap60-002 | Sathy Main Road | 67 m | 5 → 6 | 6 → 6 | Medium → Medium |
| gap60-006 | Sri Ganapathy Gardens 3rd Street (approx.) | 254 m | 2 → 3 | 5 → 5 | Medium → Medium |
| gap60-000 | 4th Street, Tatabad / Vinobaji Street | 211 m | 2 → 3 | 4 → 4 | Low → Low |
| gap60-005 | 2nd Street, Ganapathy Gardens (approx.) | 203 m | 2 → 4 | 4 → 4 | Low → Low |
| gap60-009 | 2nd Street, Gandhi Nagar | 99 m | 4 → 9 | 3 → 4 | Low → Low |
| gap60-007 | Korathottam Road | 83 m | 1 → 2 | 3 → 3 | Low → Low |
| gap60-008 | Korathottam Road | 78 m | 1 → 1 | 3 → 3 | Low → Low |

No level changed in any area. Ward 29's order changes once: gap60-004 (8 points, 193 m) now comes before gap60-010
(8 points, 142 m). Other areas: Trichy three counts +1 to +2, Vadakku Masi Veethi 27 → 30, Bharathiar Road 2 → 3,
Kattabomman 0 → 1 (3 → 4 points, still Low). Limit: a clearly read name board on a home also counts.

**2. Excel assets sheet = every pole and streetlight** (Ward 29: 268), finding rows first (identical to the PDF's 45),
the Finding cell empty when there is none; a single-photo detection says "seen in one photo only" in Position. The PDF
keeps listing only the ones with a finding. Test updated.

**3. Buildings seen only by the camera, next to the count.** `backend/app/camonly.py` counts `building_positions.json`
`no_footprint` (with a position): Ward 29 9, Trichy 79, Tiruppur 12, Vadakku Masi Veethi 4, Sanganur Road 2, the
other three 0. The main number stays the analysed buildings (381); "+ 9 seen only by camera" is shown next to it, never
added: Explore's key number (hidden while a street is selected: the camera-only points carry no street), the area hover
card, Jobs, the command palette, Under the Hood (Matched chapter, coverage card, Compare), Trust (Limits), the guided
tour, the report (PDF page 1 under the number, Excel About sheet "Note"). Tooltip: "Buildings the camera saw where the
map has no building outline. They are not checked against the register, so they are not in the main count." API:
`counts.camera_only_buildings` and `coverage.camera_only_buildings` on area cards, `n.camera_only_buildings` on Hood.

**4. Memory** (production build, `web/scripts/heap.ts`, JS heap after GC, 2 runs): Ward 29 idle 25.4 / 25.6 MB · building
evidence (tour step 2) 45.0 / 45.3 MB · after the whole tour 46.2 / 46.4 MB. Target ≤ 60 MB: met; nothing changed. (A
first attempt measured 47 / 67 / 68 MB because an older **dev** server was still on :5173; it was stopped and the
numbers above re-measured on the production preview.)

**5. Regression pass** — `tools/regression.py` (+ `web/scripts/regression.ts`, reusing `web/scripts/offline.ts`), run
before the demo with the API and the production preview up. Sections A questions, B review round trip, C Analyse up to
the estimate (no job), D reports, E browser, F offline cases; log in `docs/screenshots/regression/run-<date-time>.log`.
Result (3 Oct, one complete run, `run-2026-10-03_1502.log`): A–F all PASS, 242 checks; details in explainer 06. Section F now removes any test job left behind when a check stops half way (a first attempt lost its API to a time limit and left one test job queued; removed). Small fixes made while building it: `web/scripts/audit.ts` printed an
empty Gate 1 status (the badge is shown in capitals by CSS; the regex is now case-insensitive).

## 2026-10-04 — three UI fixes (branch ui-fixes)

### D57. Dark stretches readable in every state; a picked stretch stays in its list; a street pick keeps the clicked piece
**1. Possible dark stretches on the map.** Since D54 the priority sat in the stretch's edge colour; Medium and Low were
pale (Daylight `#8691d2` / `#c3c8e8`), the Daylight core was the same ink as the selected-street casing, and at area zoom
a selected street's building dots covered the stretch (8th Street, Ganapathy: the stretch could not be seen).
- Every stretch is drawn **dark core + priority edge + a thin casing** (`darkCasing`: Night `#070a14`, Daylight white),
  so it never melts into the chalk / ink street highlight. Core 7 px (area) / 13 px (street); edge 12 / 14 / 16 px
  (Low / Medium / High) at area zoom, 19.5 / 22.5 / 25.5 px at street zoom; casing +4 px.
- At area zoom the stretch layers are drawn **above** the building dots and question dots; at street zoom they stay
  under poles and lamps (which stand at the road edge). The edge and the core are both click targets.
- Ramp re-stepped, one indigo hue, never pale, dataviz validator: Night `#3446b8 / #6b78ee / #a9b1ff` (adjacent ΔE ≥ 16.8
  normal, 15.2 CVD; Low 2.45:1 on the panel), Daylight `#8f99e3 / #5560cc / #2a2a8f` (ΔE ≥ 17.6 / 16.0; Low 2.36:1 on
  paper). The Low contrast WARN is relieved by the black/ink core, the casing, the width and the word on every swatch.
- **One swatch everywhere** (`GapList.StretchSwatch`): the stretch exactly as the map draws it, on a piece of road
  (the base map's arterial colour). Used by the Key, the list's priority pill and the drawer's priority box. The Night
  pill used to be a dark core on a dark panel (it looked empty). The PDF report's map uses the new Daylight ramp and a
  white casing too (`report.PRIORITY_RGB`).
- The selected stretch: sodium outline outside the casing (it used to sit under the wider High edge, so it was hidden).

**2. A stretch picked in a dark-stretch list stays in that list.** Clicking a card used to swap the list for the drawer,
and nothing on the map showed which stretch it was.
- While a dark-stretch list is open (a key number's list, or a dark-stretch question: `store/ui.gapListOpen`), a selected
  stretch keeps the list (`panelOf`): its card is highlighted (sodium bar, `aria-current`), scrolled into view, and says
  "Shown on the map · click again or press Esc to clear"; the old-imagery note appears in the card.
- On the map that stretch gets the sodium outline and **every other stretch dims**; the card click frames it
  (`flyToBounds`, max zoom 18). Clicking it on the map selects the same card. The same card again, Esc or × clears it.
- Anywhere else (no list open) a stretch opens the drawer as before.
- Sathy Main Road: card 1 → gap60-001 (zoom 17.3), card 2 → gap60-002 (zoom 18), map click on gap60-001 → card 1.

**3. A street pick keeps only the connected piece that was clicked.** Rathinapuri (Sanganoor) Main Road's job (3 Oct)
took two pieces of that name that don't meet (Sanganoor Road between them), 549 m in total, without asking.
- `streetpick.split_pieces` runs on the finished pick (after names, caches and "already analysed", which are unchanged):
  pieces are connected when an end of one lies within **5 m** of the other (or they cross). The piece nearest the click
  is kept (length, lines, job polygon with the pipeline's 45 m buffer); the rest is `elsewhere {length_m, pieces, lines}`.
  A street in one piece is returned unchanged (same object, no new key). `way_ids` stay the street's full list (used for
  "already analysed" and job naming); the pipeline only analyses roads inside the job polygon.
- Analyse sheet: "This street continues elsewhere (N m) — include it?" with a switch, **off by default**. On: the length
  is the sum ("628 m in 2 separate pieces"), the estimate is planned again for both (`POST /jobs/plan-estimate
  {include_elsewhere}`), both pieces are bright and framed, and the trim handles are hidden ("Trimming is off while both
  pieces are included."). Off: the clicked piece with its handles; the rest is a dashed chalk guide on the map.
  `POST /jobs {include_elsewhere: true}` stores both pieces (`streetpick.with_elsewhere`, a MultiPolygon).
- Two pieces of one name are two streets for the sheet (`streetKey` adds the piece length only when `elsewhere` exists),
  so each keeps its own camera and trim.
- **D40 default changed:** a street whose ways leave gaps used to keep every piece; now the clicked piece only, every piece
  when included. `tests/test_d40.py` updated accordingly (intended change).
- Measured: Rathinapuri, click on the western piece (job click) → from the analysed area 327 m + 65 m elsewhere (the
  area's lines stop at its polygon); from OpenStreetMap 327 m + 222 m (the job's 549 m); a click on the southern piece →
  794 m connected + 230 m elsewhere. All six demo streets (Sakthi Main Road 1,221 m in 4 parts, Ganapathy - Avarampalayam
  Road 1,039 m in 3 parts, Dr Alagesan Road 1,201 m, Pioneer Mills Cross Street 291 m, Sanganur Road 1,106 m, Unnamed road
  near 5th Street 50 m) return exactly their cached answers (lines, length, polygon), with no `elsewhere`.
- Finished jobs and areas are not changed (the Rathinapuri area stays the 549 m two-piece run).
- Limit: analysed streets stored in pieces now offer the rest too: Ward 29's Sathy Main Road (clipped at the ward edge:
  803 / 111 / 37 m) and Sakthi Main Road (142 / 13 m) show "continues elsewhere" when picked from Ward 29's own lines.

Tests: `backend/tests/test_ui_fixes.py` (7), `test_d40.py` (updated), two `test:ui` cases; `web/scripts/ui-fixes-shots.ts`
(both themes, screenshots in `docs/screenshots/ui-fixes/`).
Checks (4 Oct): backend 443 passed / 1 skipped; typecheck, build, test:ui 18, check:data, audit (both themes) pass;
regression all six sections PASS, 266 checks (`run-2026-10-04_1246.log`; a first run's failures were the log's Windows
code page and two slow loads, see explainer 06). No regression expected answer changed.


## 2026-10-04 — extras (branch extras)

### D58. Test clean-ups by exact id, UTF-8 regression log, readiness waits, continuation on OSM; GIS export, city projection, OpenStreetMap as a reference, floor confidence, report v2
**F1. Clean-ups remove only their own jobs.** In the ui-fixes round the app's "clear test jobs" call (rule: test jobs +
jobs cancelled before any worker started them) also removed a real, old job, "Unnamed road between Marutha Konar Street
and Maniakarar Nagar" (failed / cancelled before start, no area). It can't be restored.
- `POST /jobs/clear-test {dry_run: false}` now needs `ids` (422 otherwise): nothing is removed by rule alone. The Jobs
  page already sent the ids the person confirmed; it still lists cancelled-before-start jobs for a person to confirm.
- `test_p6::test_one_street_at_a_time…` deleted by name pattern + time window → now by the ids it recorded.
- `tools/regression.py` section F removed "new since the start and is_test" jobs → now `web/scripts/offline.ts` writes each
  job id it creates to `created_jobs.txt`, and `remove_own_jobs(ids)` removes exactly those.
- Tests (`backend/tests/test_extras.py`): a bystander job shaped like the lost one survives clear-test (with the test's own
  ids), the regression clean-up and the fixtures' delete; clear-test without ids → 422; a static check that every
  `delete from jobs` in tests, tools and scripts is by id.

**F2. UTF-8 output.** `tools/regression.py` reconfigures stdout/stderr to UTF-8 (`errors="replace"`) before printing, so a
redirect to a file in the Windows code page no longer crashes on "→" or Tamil. Test: a subprocess with `PYTHONUTF8=0`
writing to a file passes with the fix and crashes without it (the control).

**F3. Readiness, not timers.** `web/scripts/regression.ts` waits until the key numbers show figures (not only labels), the
network settles, and each step's element appears; then one retry per area, logged ("retry [slug] once — first
attempt: …") and counted at the end, so a retry is never hidden.

**F4. "Continues …" measured on OpenStreetMap.** `streetpick.osm_continuation` (after D57's `split_pieces`): the street's
OSM line (the named-street query; local copy in the four cities, else the 30-day cache; 3 s budget) within the same
1.2 km window a job takes. Continuation = the OSM pieces that don't connect + (for a pick from an analysed area) the
rest of the connected OSM road beyond the area's own lines (12 m cover, slivers < 5 m dropped; < 15 m = none). When > 50 %
of it lies outside the analysed area the click is in: `outside_area` → "This street continues outside this area (N m)
— include it?". OSM unreachable: the area-line answer stays, `measured_on` says so.
- Rathinapuri (job click): 65 m (area lines) or 222 m (OSM) before → **222 m both ways** (most of it outside the area's
  outline, so the outside wording). Included: 549 m in 2 pieces = the original job.
- Ward 29: Sakthi Main Road 142 m + **544 m outside**; Sathy Main Road near the ward edge 624 m + **761 m outside**; Sathy
  Main Road mid-ward: none — within the job window OSM's dual carriageway covers the same road as the ward (D57's
  "803 / 111 / 37 m" pieces were the opposite carriageway's fragments in the area's lines).
- Demo streets unchanged (OSM picks: only unconnected pieces count, as in D57). The number depends on where the click is
  (the 1.2 km window is centred on it).
- `test_pick_drive` updated (intended): an analysed street still answers from its area, with at most one map question
  (the named street's OSM line).

**1. GIS export** (`backend/app/gisexport.py`; `GET /areas/{slug}/report.geojson|.shp.zip?street=`; buttons GeoJSON ·
Shapefile beside PDF · Excel). Layers = the Excel sheets' rows and columns: buildings with findings (outlines; point
layer only for buildings without one), every pole and streetlight, possible dark stretches (lines as drawn), review items,
businesses vs OpenStreetMap. WGS84 `.prj` + `.cpg` per layer, `fields.csv` (10-character names → Excel columns),
README (text cut at 254 bytes is counted; the GeoJSON keeps it). pyshp (pure Python). Ward 29 read back with geopandas:
**buildings 77 (polygons) · poles/streetlights 268 · dark stretches 11 (lines) · review items 218 · businesses vs OSM 152**,
EPSG:4326. The numbers-match test reads both files back and compares every value with the Excel rows.

**2. City-scale projection** (`backend/app/projection.py`, `GET /projection`; Hood › Whole-city projection; PDF method page).
Streets: `osm_roads` of the area stage's `ROAD_TYPES`, no bridges / tunnels, clipped to each city's box. Photos per km per
completed run (photos fetched / streets.json km): 110–452 (9 runs; pooled 256). Cost per photo: $0.007 list + cloud AI
$0.00002–$0.00008 (live runs that recorded it). Time: 0.49 s/photo + 3.8 min start-up per job of 4.8 km (Ward 29's size).
Road km cached on disk for offline mode.

| city | streets | photos | cost (list price) | GPU hours | Colab days (2.5 h) |
|---|---|---|---|---|---|
| Coimbatore | 5,711 km | 0.63 – 2.6 million | $4,400 – $18,000 | 160 – 423 | 64 – 169 |
| Madurai | 3,333 km | 0.37 – 1.5 million | $2,600 – $11,000 | 94 – 247 | 37 – 99 |
| Tiruppur | 2,534 km | 0.28 – 1.1 million | $2,000 – $8,100 | 71 – 188 | 28 – 75 |
| Tiruchirappalli | 1,713 km | 0.19 – 0.77 million | $1,300 – $5,500 | 48 – 127 | 19 – 51 |

An estimate; Street View coverage is not checked for whole cities; Coimbatore's box is its corporation zones + 550 m.

**3. OpenStreetMap shops as a real reference** (`backend/app/osmref.py`, `GET /areas/{slug}/osm`). Ours: buildings with a
shop name read clearly or commercial / shop + home use, + businesses read from signs. OSM: the local copy's shop /
office / business-amenity points within 30 m of an analysed street (worship, schools, toilets, parking, ATMs … left out).
The copy keeps geometry only, so names / tags come from **one Overpass id look-up per area** (`tools/fetch_osm_tags.py` →
`data/areas/<slug>/osm_tags.json`; new worker areas fetch it in the background). Same place = ≤ 25 m to the outline,
one-to-one, a `textmatch.same_business` name first, then the nearest.
- **Ward 29: camera 147, OSM 14 → matched 9 (0 with the same name), camera only 138, OSM only 5** (4 non-business points
  left out). Five matches are inside / ≤ 2 m of an outline (a building with several shops), four are 13–22 m away and are
  probably neighbours — the rule was kept as specified, the lists show distance and "same name".
- Shown: Hood + Trust sections, the question "Businesses not in OpenStreetMap" (also "OpenStreetMap shops not seen by the
  camera", "businesses in OpenStreetMap"; Show chip "Businesses vs OpenStreetMap") with our businesses highlighted and
  OpenStreetMap's points as square tags, a column in the report / Excel and an "OSM shops" sheet. Crowd-sourced, not an
  official register — said wherever it appears. The synthetic register is unchanged.

**4. Floors: confidence + OSM levels.** A fixed rule (`osmref.floor_confidence`, chosen before any OSM result): High = counted
from the photo, 1–2 floors; Medium = counted, 3+ (model card: mild under-count on 3+ storeys); Low = estimate, roof not
visible; else not counted. Shown in the drawer's Floors row (an exception to D16's "no confidences" on user screens,
asked for by the owner) and in the report / Excel. Ward 29: High 194 · Medium 23 · Low 4 · not counted 160. OSM
`building:levels` (same id look-up, not in the local copy): **2 of 381 Ward 29 buildings** carry it (both "10", on
Ganapathy - Avarampalayam Road); 1 is compared (ours 1 floor) → **0 exact, 0 within ±1**; the other areas: 0 tagged. Too few
to judge; never changes our count.

**5. Report v2** (`backend/app/report.py`; `tools/render_report.py` renders pages to PNG). All pages landscape A4, 14 mm
margins, body 11 pt, tables 9 pt, numbers 30 pt. Main part: at a glance (6 cards, 3 computed sentences, small map) ·
charts (use, floors counted, register match, findings by street, businesses vs OSM, every key number in one line) · map +
key · what to do next (≤ 10 actions with streets and one line of why) · method & limits (sources with dates, cost, Gate 1
worded as on Trust, limits) · scale and confidence (projection, floor rule, OSM). Appendix: key columns; priority-6 review
items and camera-only businesses are counted and left to the Excel file. **Ward 29: 27 → 19 pages (6 main + 13 appendix);
Sathy Main Road 8 pages** (a short street report puts the actions beside the map). Excel keeps every column and row, plus
the new columns and sheet.

**Checks (4 Oct).** Backend 457 passed / 1 skipped (incl. `test_extras.py`); typecheck, build, test:ui 18, check:data, audit
(both themes) pass; live screenshots `web/scripts/extras-shots.ts` → `docs/screenshots/extras/` (both themes); report pages
→ `docs/screenshots/report_v2/`. Regression, output redirected to a file every time (F2): six full runs. Run 1: F failed
twice on fixed timers in `offline.ts` (Hood on a just-started helper API, the API-down banner) → readiness waits there too.
A section-F check then saw "no jobs" while the API was in offline data mode after a network blip (nothing was deleted: all
6 jobs in the database) → `job_ids()` waits for an online answer. Run 2 ALL PASSED. Run 3: "0 waiting" matched the Review
check while the queue was still loading → wait for a non-zero count. Run 4: a network outage (18:15–18:21, DNS / timeouts;
review state verified clean afterwards: 404 waiting, every decision undone). **Runs 5 and 6 (final code, consecutive):
ALL PASSED, 288 checks each, 0 areas needed the retry** (`run-2026-10-04_1834.log`, `run-2026-10-04_1855.log`). Expected
answers: none changed; added (intended) the question "Businesses not in OpenStreetMap" → 138 and, per area / street, GIS
layer counts = the Excel sheets.


## 2026-10-07 — UI polish 2 (branch ui-polish-2)

### D59. Projection removed; usable street list; short photo tags + key; smaller photo; Review asks a question with a corrected value; OSM "near each other"; OSM floors only where tagged; installable requirements
**1. City-scale projection removed** (D58 §2): Hood section, PDF page-6 block and Excel rows, `GET /projection`,
`app/projection.py`, `test_city_projection_is_a_range_from_our_runs`, `data/cache/projection_city_km.json`, README /
manual-check mentions. PDF page 6 is "How sure the counts are" (floor confidence + OSM cross-checks); Ward 29 still 19 pages.

**2. Street panel list.** Sentences ≤ 22% of the panel (was 42%); "Drive this street" + a single "Street report" menu button
(PDF · Excel · GeoJSON · Shapefile; the area panel keeps its four buttons) in one row; the list has `min-height: 220px`.
1366×768: 5 rows visible on 2nd Street, Gandhi Nagar and Sathy Main Road (was 1–2). A tab click selects it **and** opens the
full list (`StreetListSheet`) beside the panel: same tabs, wider table (use, floors, review, ID columns appear), × / Esc
(capture listener: closes only the sheet). "Open the full list" in the list footer too. Tab names unchanged (Buildings ·
Lights & poles · Businesses).

**3. Photo tags** (`lib/photoTags.ts`). B / P / S / L per kind, numbered left to right when a kind repeats; the target
(orange) box has no tag; linked boxes ("part of this building") get a light-orange tag. Tags are 11 px on screen whatever the
photo size (`EvidencePhoto` measures its width → `PhotoScale`), placed with the existing `placeLabels` (label height now a
parameter, 15 px here). Confidence only on hover / tap (a tooltip over the tag), never printed on the photo. `PhotoKey` under
the photo: "Orange = this building · S = part of this building · B building · P pole · S sign · L streetlight", then one entry
per tag ("S2 = shop sign 'EXALT CUTS', part of this building · 35%"; text = the sign box's OCR reading, raw), max 3 lines then
scroll. Box ↔ key highlight both ways (white outline, others faded; key entry underlined); keyboard focus highlights only
when focus-visible. The evidence API adds `text` to sign boxes (`ocr.json` by crop file) — display only; **the target box
choice is unchanged** (test: one target, same `target: "box"`). Under the Hood's example sheet uses the same tags + key.

**4. Photo size.** `EvidenceViews maxPhoto`: 300 px (drawer, was the full 378 px column), 400 px (Review, was ~568 px).
Photo + key + date / Front / Sign / Live 360° row fit at 1366×768 in both.

**5. Review = a question** (`lib/reviewQuestions.ts`, `components/ReviewAsk.tsx`). Yes = approve, No = reject (statuses,
counts, filters and the map keep their meaning; buttons and history say "Answered Yes / No", "Sent back"). Keys: A yes,
R no (a value question opens the No box first; Enter saves, Esc cancels), E send back, U undo. Questions:

| reason (pipeline / as listed) | question | value after No |
|---|---|---|
| high-severity / attribute discrepancy, no record (`missing_record`) — "Not in the register" | Is there a building here that's missing from the register? | — |
| attribute discrepancy `extra_floor` — "Extra floor vs register" | The register says N floors, the photo suggests M floors. Is the photo right? | floors |
| attribute discrepancy `use_change` — "Use differs from register" | The register says X, the photo suggests Y. Is the photo right? | use |
| high-severity `location_shift` — "Register pin in the wrong place" | The register's pin for this building is N m away from it. Is the pin in the wrong place? | — |
| high-severity `area_understated` — "Bigger than recorded" (not in today's queue) | The register says A m², the map outline is B m². Is the building bigger than recorded? | — |
| several register differences (Vadakku Masi Veethi: pin + use) | The photo and the register differ. Is the photo right? + one line per difference | floors / use when among them |
| asset `type_mismatch` (not in today's queue) | The register lists this as a X; the photo shows a Y. Is the photo right? | — |
| floor count low confidence — "Floor count is an estimate" | Does this building have N floors? | floors |
| use low confidence / not known (not in today's queue) | Is this building X? | use |
| name read by VLM only — "Shop name read by the AI model only" | Does the sign say "…"? | sign name |
| building seen from one view only (alone) — "Seen from one camera position only" | Does the orange box show this building? (else a "look closely" hint) | — |
| single-detection asset — "Seen in one photo only" | Is there a pole / streetlight in the orange box? | — |
| anything else | "<reason>. Is that right?" | — |

With a register question and a floor estimate on one item (Trichy, 2 items), Yes / No answers the register question and the
floor check shows as "Also, if you can tell: …" (its value can be given after No). Counts in the data (9 areas, 404 items;
Ward 29 218): single-detection 290 (157), one view 46 (29), high-severity 39 (27), attribute 28 (14), floor estimate 27 (4),
VLM-only name 1 (1).

**Storage** (migration 009, additive, nullable): `review_items.corrected jsonb`, `review_events.corrected` +
`previous_corrected`. Written by the same DECIDE / UNDO statements (the history still cannot miss a change); Undo restores
`previous_corrected`. `PATCH /review/{id}` field `corrected` = JSON `{floors: 0–60 | use: one of 7 | name: 1–120 chars}`
(422 otherwise; not with an appeal). **Note rule changed:** a No may carry its own note (`noNote` in the browser, never the
appeal box's text); a Yes may not; a photo is still appeal-only. The corrected value is never written over the AI's value or
the register: "Reviewer says: 3 floors" in the drawer (under our value), Review's status line and history, and the report /
Excel / GIS Review column ("Rejected — reviewer says: 3 floors"). After each answer one line says what was saved
(`outcomeLine`, e.g. "Saved: reviewer says it has 3 floors, not 2."). When the last item of a filtered queue is answered,
it stays on screen (marked "outside the current filter") so the line stays readable. Review's right column now has the
answer right under the question and "what we saw"; the mini-map and "Show on the map" follow.

**6. OpenStreetMap shops:** "Matched (same place)" → "Near each other (location only)" (Hood, Trust, question note and its
"understood" line, PDF chart / paragraph, Excel rows and summary, GIS `Result`, the buildings' "In OpenStreetMap" column:
"near an OpenStreetMap point (…, 13 m; location only, names don't match)"), with "names didn't match" when none do (Ward 29
0 of 9). API keys unchanged (`matched`, `matched_same_name`). Counts unchanged: 147 / 14 / 9 / 138 / 5.

**7. OSM floor levels:** drawer row only when the building carries `building:levels` (Ward 29 2 of 381; the "OpenStreetMap
has no floor count" / "not loaded" lines are gone); Excel / GIS column blank instead of "not tagged" / "not loaded"; Hood:
one line "OpenStreetMap has floor counts for 2 of 381 buildings — too few to compare." (fewer than 20 compared = too few;
Trust keeps the full comparison).

**8. Requirements.** `../pipeline` replaced by a comment: pip resolves it from the current folder (repo root → invalid) and
`pipeline/` has no pyproject (backend\ → not installable); `geo_cascadia` comes from `sys.path` in `app/main.py`. Fresh
3.12 venv: exit 0 from the repo root and from `backend\`, `app.main` + `geo_cascadia` import (before: exit 1 from both).

**Found, not fixed (needs new Street View photos):** about a third of Ward 29's stored panoramas are no longer served by
Google (free metadata check, 5 of 12 sampled ZERO_RESULTS, incl. "transport india pvt ltd" `w1236978849`, 2nd Street,
Gandhi Nagar): those photos show "No Street View image for this view". The before / after uses hitech gears
(`w1252503923`, Sathy Main Road, 17 boxes, 11 linked signs) whose panorama still loads.

**Checks (7 Oct).** Backend 469 passed / 1 skipped (457 − the removed projection test + 13 new in `test_ui_polish2.py`; `test_p5` note rule updated, intended); typecheck, build, test:ui 22 (4 new), check:data, audit (both themes) pass; fresh 3.12 venv: install from the repo root and `backend\` exit 0, 8 pure tests pass in it. Live: API round trip (No + `{"floors": 3}` + note → undo → row identical except `updated_at`; bad values 422), Excel Review cell, Ward 29 PDF 19 pages with no projection / "same place"; screenshots `web/scripts/ui-polish2-shots.ts` → `docs/screenshots/ui-polish-2/` (before / after, both themes; report pages in `report/`). Regression (production preview, output to a file): run 1 ALL PASSED, 291 checks, 0 retries (`run-2026-10-07_1754.log`); run 2 one FAIL — "no console errors" on Vadakku Masi Veethi: `ERR_CONNECTION_CLOSED`, then `ERR_HTTP2_PROTOCOL_ERROR` on the retry (an external host's connection dropping; every functional check passed, 289 ok, `run-2026-10-07_1812.log`); run 3 ALL PASSED, 291 checks, 0 retries (`run-2026-10-07_1833.log`). Expected answers: none changed; added (intended) section B's No + corrected value + undo (history +4 instead of +2; the snapshot now includes `corrected`) and the question "Businesses near an OpenStreetMap point" → 9.

## 2026-10-07 — photo fallback (branch photo-fallback)

### D60. Photos Google no longer serves → its current photo there, without boxes; ask before requesting; the India bill; change log moves to 07
**0. Docs rule.** Every change is now logged in `docs/explainer/07_updates_2.md` (same format as 06). The D59 entry moved
there; `06_updates.md` is byte-for-byte its pre-D59 state (`git show f1735bb:docs/explainer/06_updates.md`); 00–06 are not
edited. CLAUDE.md's standing rule names 07. Lines in 00–06 that go out of date are listed in the 07 entry instead.

**1. Retired panoramas.** Google re-issues panorama ids. Free metadata check by `pano` (7 Oct 2026, `tools/check_photos.py`
over every evidence view the API returns, 9 areas, 463 calls): Ward 29 303 of 852 photo references gone (69 of 201
panoramas), Trichy 2 of 223 (1 of 91), the other 7 areas 0. Every gone panorama has a current one by `location` (the old
camera, `radius=25`, `source=outdoor`) 0.0–5.0 m away with the **same capture month** (67 Feb 2026, 2 Nov 2022, 1 May 2025):
the same imagery under new ids.
- `app/photos.py`: `PhotoMeta` = the 30-day disk cache `data/cache/streetview_meta.json` (git-ignored, like every cache).
  Only OK / ZERO_RESULTS / NOT_FOUND are kept; REQUEST_DENIED, quota, network errors = "not known" (never cached; the stored
  photo is shown as before). No server key → cache only (tests). IPv4-only HTTPS (IPv6 to Google times out on the laptop).
- Evidence views get `served` + `current` {pano_id, heading, pitch, fov, date, lat, lon, moved_m}. Heading = bearing from the
  current panorama to: a building's front-wall centre (`frontwall.road_edge` midpoint; else its point), an asset's or
  business's position; a building **Sign** view aims at the sign = the point on the stored sight line at the front-centre
  distance (aiming at the wall centre swung transport india's sign view 19° off the sign; now 1.8°). Stored pitch / fov kept.
  `GET /photos/{pano_id}?heading&pitch&fov[&lat&lon]` for any stored panorama (camera from any area's `panos.json`); no
  target → same heading (Drive, Hood step examples, Trust spot-check).
- Wording (deviation from the brief, said to the owner): the brief's label was "Newer photo (<month>)". Because every
  replacement has the same capture month, the app says **"Current photo (Feb 2026) — Google no longer serves the photo used
  in the analysis, so its boxes can't be shown."** plus "Same capture month, taken from the same spot / N m away: Google now
  serves it under a new ID." "Newer photo" only when the month really is later; "It is older than the analysis photo." when
  earlier (`lib/photoSwap.ts`). No old boxes, no photo key, chip "Current photo · no boxes", date badge = the current month,
  Live 360° = the current panorama. No current one → "No Street View photo available here any more", no request; Live 360°
  then asks `StreetViewService.getPanorama` (50 m, outdoor) on click, else "No live 360° view here either". (No stored
  photo is in that case today.)
- Everywhere: `EvidencePhoto` asks first (evidence API answer when given, else `GET /photos/{pano}`), so the drawer
  (building / asset / business), Review, Hood examples (`ExampleSheet`, key hidden when swapped) and Trust's spot-check all
  follow; Drive (`DrivePanel.Frame`) uses the current panorama with the drive heading and prefetches only served / current
  ones. Not changed: `/design-preview` (reference route, not linked).
- Hood: `photo_check` from `data/areas/<slug>/photo_check.json` (committed), one line in the coverage card, orange when
  something is gone.

**2. Failing requests.** Sources: the browser's Static requests for retired panoramas (404 with `return_error_code=true`,
Chrome `ERR_BLOCKED_BY_ORB`) and every script that walks the browser through them (regression E, audit, shot scripts). The
worker / pipeline fetch only freshly found panoramas; metadata calls answer HTTP 200 even for ZERO_RESULTS. Same Ward 29 click
path (`web/scripts/photo-browse.ts`): before 17 / 33 failed (52%; all 13 failing panoramas are metadata-gone) → after 0 / 34.

**3. Cost lines.** `data/billing.json` (owner, Google Cloud billing report 7 Oct 2026, account-wide): India pricing, ₹0, 17,747
photos, 7 Sep – 6 Oct 2026. Hood Routing and cost: "Street View photos (Google): $9.94 — 1,420 photos at Google's global list
price." / the billing line / "Cloud AI (Amazon Nova Lite, AWS): $0.070." — **no combined total or percentages** any more
(also the PDF; `test_report` updated, intended). Time and cost: list price + billing line replace the old "free monthly
allowance may cover it" caption; a live run's sentence split into Street View / Cloud AI / business look-up lines. Analyse
estimate: "Cloud AI (Amazon Nova, AWS) ≈ $…" instead of "Total ≈ … (photos + cloud AI …)" (the cost cap still compares the
sum); Jobs card: Street View / Cloud AI / Cost cap lines instead of "Total".

**Checks (7 Oct).** Backend 484 passed / 1 skipped (13 new in `test_photo_fallback.py`; `test_report` cost assertion updated, intended; a one-off `test_p6` delete failure in the first full run did not recur alone, in its file or in a second full run); typecheck, build, test:ui 23 (1 new), check:data, audit (both themes) pass. Regression: run 1 lost the internet (E `ERR_INTERNET_DISCONNECTED`, F stopped: API in offline data mode; A–D pass, `run-2026-10-07_2018.log`); run 2 ALL PASSED, 291 checks, 0 retries (`run-2026-10-07_2132.log`). Expected answers: none changed. Screenshots `web/scripts/photo-fallback-shots.ts` → `docs/screenshots/photo-fallback/` (before from main's frontend in a worktree on :5173, after; both themes).

## 2026-10-07 — box restore (branch box-restore)

### D61. Re-issued panoramas are NOT the same photo: no boxes restored; the check is automatic; wording corrected; "sign boxes"; /design-preview removed
**Question.** D60 found 303 Ward 29 photo references (69 panoramas) + 2 Trichy (1) whose panorama ids Google retired, each with a
replacement 0–5 m away and the same capture month, and assumed "the same imagery under a new id". Owner: verify before drawing
the saved boxes on the replacements.

**Rule, fixed before any replacement photo was fetched** (`backend/app/sameimage.py`; written to a file first):
- The production detector (YOLOv8s `v8s_640_s2`, owner's `best.pt`, laptop CPU) is re-run on the replacement photo at the
  STORED heading / pitch / fov with the pipeline's own call (`predict(conf 0.20, imgsz 640, iou 0.45, agnostic NMS)` + the
  per-class thresholds). Per class one-to-one Hungarian assignment on IoU; a pair needs IoU ≥ 0.10.
- A photo is "same image" when: ≥ 2 saved boxes of confidence ≥ 0.5 (else "can't tell"), median IoU of matched pairs ≥ 0.80,
  ≥ 80 % of those strong boxes found again at IoU ≥ 0.5, and |median dx|, |median dy| ≤ 6 px.
- A panorama is "same image" when the replacement has the same month, is ≤ 5 m away and its spot-check photo passes (the
  planned view with the most strong saved boxes; next one if "can't tell"; ≤ 3).
- Go / no-go: restore only if ≥ 90 % of the judged retired photos pass AND the retired median IoU is ≤ 0.05 below the
  still-served control's; otherwise nothing anywhere.

**Step 1a study** (`tools/verify_same_image.py` + `tools/detect_photos.py`; photos kept in memory only, never written):
40 retired references (Ward 29 38 stratified by street × kind with seed 2026, + both Trichy ones; 7 streets, 26 panoramas;
poles / lights 10, building sign 9, front 8, best photo 6, nearest camera 4, business sign 3; 0.4–4.9 m from the old camera)
and 10 still-served controls.

| | photos | same / different / can't tell | saved boxes matched | median IoU (p10–p90) | per-photo shift \|dx\| median | strong boxes found again (median) | the object's own box, median IoU |
|---|---|---|---|---|---|---|---|
| retired → replacement | 40 | 0 / 34 / 6 | 120 of 233 (113 extra) | 0.491 (0.210–0.787) | 20.4 px (−88.8 … +64.3, n = 29) | 0.29 | 0.171 (n = 35; ≥ 0.5: 10) |
| control, still served | 10 | 8 / 1 / 1 | 63 of 63 (3 extra) | 1.000 (0.999–1.000) | 0.0 px | 1.00 | 1.000 (n = 10) |

Pass rate 0 of 34 judged (needs ≥ 90 %), IoU gap 0.509 (needs ≤ 0.05) → **NO-GO: nothing is restored.** The control shows the
CPU re-run reproduces the stored GPU boxes exactly (its one "different" is a pole's aimed view, whose boxes are projected from
other views: 0.73). **The replacements are neighbouring frames of the same drive, not the old photo under a new id** — even
0.4 m away the boxes sit 20 px off. D60's wording "taken from the same spot: Google now serves it under a new ID" was wrong.

**Step 1c — the monthly check does this by itself** (`tools/check_photos.py`): after the metadata pass, every retired
panorama whose replacement meets the month / distance half gets the detector spot-check (one photo, sometimes up to 3), and the
area gate (≥ 90 % of its judged retired panoramas pass, else none) decides. Verdicts are kept in `photo_check.json`
(`same_image`, `same_image_restore`, one `references` row per gone photo reference with old → new id and `same_image`) and are
re-used while the replacement id stays the same, so a re-run costs no photo. The detector runs in its own venv
(`DETECTOR_PYTHON`, `DETECTOR_WEIGHTS` in backend/.env, or `--detector-python / --weights`); without it new re-issues stay
"not checked" (no boxes). Run on 7 Oct: **Ward 29 69 retired panoramas: 65 different, 3 same, 1 can't tell → gate 3 of 68 = 4 %,
no restore; Trichy 1: different.** The 3 that pass alone are 0.1 / 0.4 / 1.2 m away with median IoU 0.83 / 0.88 / 0.83 and
shifts ≤ 5.3 px — close neighbouring frames, not the 1.00 of an identical photo; the gate keeps them without boxes.
- The API (`photos.same_images`) reads only verdicts "same" in areas whose gate passed; such a view's `current` gets
  `same_image: true` and the stored heading / pitch / fov; the browser (`photoSwap` state `same`) then requests it under the
  new id and draws the saved boxes and tags with the note "Same photo under a new Google ID". **Today no view is in that state.**
- Not tuned after seeing results. Owner option (not applied): a stricter photo rule (e.g. median IoU ≥ 0.95) would separate an
  identical re-issue (control 1.00) from a close neighbouring frame (0.83–0.88) more clearly.

**Wording corrected (D60).** Under a replaced photo: "… Taken on the same drive, less than 1 m / N m from the analysis camera:
a neighbouring photo, not the one the analysis used." Hood note: "… Google's current photos taken near the same spots are shown
instead, without boxes (taken on the same drive, up to 5 m from the analysis cameras: neighbouring photos, not the ones the
analysis used; re-running the detector, the saved boxes came back on 3 of 68 checked panoramas)." Drive's tooltip likewise.

**1d.** Building drawer: "1 building · N sign boxes in M photos linked to it (light-orange S tags on the photos; the same sign
is often boxed in several photos, and some boxes aren't shop signs)". Grouping boxes of one sign was measured and is not
reliable: by the spot each box's sight line meets the outline, 26 % (Ward 29) / 13 % (Trichy) of box pairs from ONE photo —
different signs by definition — lie within 1 m (44 % / 22 % within 2 m); identical read text joins only 103 cross-photo pairs in
Ward 29. So no "about N different signs" count. The outdated "marked 'part of this building'" text is gone.
**/design-preview removed** (nothing linked or tested it; it requested retired panoramas directly): `DesignPreview.tsx` and its
only users `NsDrive / NsShell / NsStory / NsParts / nsLayers` + `data/ward29-sathy-drive.json`. D15's "stays as the reference
route" no longer holds; DESIGN.md / tokens are unchanged.

**Cost.** Street View Static photos fetched by the checks: 50 (study) + 72 (spot-check) = 122, $0.85 at Google's list price
(billed under India pricing, see D60's billing line); Amazon Nova (AWS): 0. Metadata calls: 0 (cache). No photo was written to
disk by the checks.

**Checks (7 Oct).** Backend 496 passed, 1 skipped (12 new in `test_box_restore.py`); typecheck, build, test:ui 24 (1 new; the D60 wording test updated, intended), check:data and the audit (both themes) pass. Regression (production preview, output to a file): ALL PASSED, 291 checks, 0 retries (`run-2026-10-07_2302.log`); no expected answer changed. Live: the evidence API, `GET /photos/{id}` and the Hood note called against the running API (no `same_image` anywhere, the new note). Screenshots `web/scripts/box-restore-shots.ts` → `docs/screenshots/box-restore/` (before = main's frontend and API from a worktree on :5173 / :8000; after; both themes).

## 2026-10-08 — M3 at level 1 (branch m3-level1)

### D62. The orange "this building" box is chosen by M3 (visible span) — display only
**Owner decision (8 Oct):** port the Part 2 experiment's M3 at level 1 (which box is drawn and labelled only), with exactly
the parameters frozen there; no re-tuning; positions, Gate 1, register matches, review queue contents / counts, reports and
every other number unchanged; linked sign boxes unchanged. The owner spot-checked the experiment's labels.

**Rule** (`backend/app/boxchoice.py`, a port of the experiment's code): from the photo's camera, one line of sight per 4 px
image column (161 per 640 px photo), from 1.5 m to 60 m, into every building outline; outlines the camera stands in are
skipped. The first outline each line meets is what that column sees. The building's visible columns V; each building box's
columns S (the nearest column for a sliver); score = |S ∩ V| / |S ∪ V| (rounded to 3 decimals, as in the experiment); the
highest score wins (ties: detector confidence); below 0.4 → **can't tell**: no orange box.
- Photos it applies to: each building's Front photo (attribute view with a stored box) or, without one, its Best photo
  (the pipeline's building_views match) — the photos whose orange box is a building box. Not changed: the Sign photo (its
  orange box is the sign), the "Nearest camera" photo of a building the pipeline matched no box to (no orange box, as
  before), assets, business signs, and Under the Hood's quality-gate examples (they explain the box the analysis judged).
- Outlines: the pipeline's own `Area` around the run's cameras, as the run loaded them (OSM, + Microsoft where the run used
  them): the run-era Overpass cache first, else the app's local copy (D53), else Overpass. Outline counts equal the
  experiment's in all 9 areas (Ward 29 3,715).
- Stored per area in `data/areas/<slug>/box_choice.json` (status same / changed / cant_tell, score, chosen box, the
  analysis' box): `tools/box_choice.py` for existing areas; a new worker area gets it in the background after delivery
  (until it lands, the analysis' own box is drawn). No pipeline or worker change, no photo, no model call.
- Evidence API: Front / Best views carry `box_choice` and `analysis_box`; the orange box follows the choice; with
  cant_tell no box is orange and every other box and tag stays. Missing file → as before.
- UI: "Can't tell which box is this building in this photo." under the photo (drawer and Review); "How do we know?" →
  "Which box" explains the rule and, when it differs, that the analysis used another box (its results unchanged). The
  Review question for "Seen from one camera position only" on a can't-tell photo: "We can't tell which box is this building
  in this photo. Look at the photo (or Live 360°): can you see this building?" (Yes / No keep their meaning).

**Experiment numbers** (Part 2, development / test halves, labels by Claude Code, spot-checked by the owner; small sample:
one test item = 3 points): test n = 33 — M3 84.8 % correct, 12.1 % wrong box, 93.9 % get a box; today's rule 75.8 % /
24.2 % / 100 %. By stratum (test): single camera 38 → 15 % wrong, row / attached 36 → 21 %, small in front of big 29 → 29 %.
Known misses: the owner's two examples stay wrong under M3 alone (#27 the warehouse box for the small building in front,
#28 the compound wall); M3 + linked signs did better on the test half (6.1 % wrong) but that was not the development
half's choice, so it is not ported.

**Consistency:** the app's choice equals the experiment's M3 output for all 80 labelled photos (80 / 80).

**Effect (all building Front / Best photos):**

| area | photos | box changed | can't tell | (still served by Google: changed / can't tell) |
|---|---|---|---|---|
| Ward 29 | 338 | 42 | 30 | 219: 30 / 25 |
| Bharathidasan Salai, Trichy | 53 | 3 | 7 | same |
| Sanganur Road | 49 | 5 | 3 | same |
| Vadakku Masi Veethi | 47 | 9 | 2 | same |
| Rathinapuri (Sanganoor) Main Road | 42 | 4 | 3 | same |
| 3rd Street, Sridevi Nagar | 24 | 9 | 0 | same |
| Unnamed road between Bharathiar Road and Sankara Linganar Street | 8 | 1 | 1 | same |
| Kattabomman Street Extention | 7 | 0 | 1 | same |
| Uthukuli Road, Tiruppur | 1 | 0 | 0 | same |

Ward 29's other 119 photos are on panoramas Google no longer serves (D60/D61): they show a current photo without boxes.

**Level 2 not done:** positions / Gate 1 still use the analysis' box choice (the experiment's what-if: Ward 29 260 →
247 camera-derived, median 2.80 → 2.74 m, 60.4 → 64.0 % ≤ 3.5 m, mostly from buildings leaving that set; not a measured
gain).

**Checks (8 Oct).** Backend: full suite 503 passed, 2 failed, 1 skipped — the 2 were `test_evidence` asserting the stored box is always orange (intended change, updated; a first full run also failed `test_p5::test_no_guessed_building_box` the same way, updated, and the known-flaky `test_p6` delete test, which passed alone and in the rerun); after the updates the changed files pass (test_evidence, test_m3_level1, test_p5, test_p6). typecheck, build, test:ui 25 (1 new), check:data pass; the audit: first run 1 fail ("Esc closes the palette", Night — unrelated code), second run all passed. Regression (production preview): ALL PASSED, 291 checks, 0 retries (`run-2026-10-08_0710.log`); no expected answer changed. Live: the evidence API for the three cases and the Ward 29 key numbers (unchanged) against the running API. Screenshots `web/scripts/m3-level1-shots.ts` → `docs/screenshots/m3-level1/` (both themes). Clean-up (Google terms): the experiment's review and example images and `docs/screenshots/box-restore/` deleted; `labels.csv`, `RESULTS.md`, `M12_PROTOCOL.md` kept.

## 2026-10-08 — one AWS server (branch deploy): preparation and read-only checks

### D63. One g4dn.xlarge for the website, the API and the GPU worker; database stays on Supabase
**Owner's brief (8 Oct):** one g4dn.xlarge in ap-south-1; site open to anyone with the link, SSH only from the owner's IP;
ask before anything that costs money; never more than one instance; shutdown = stop and a 90-minute auto-stop on the
server; every resource tagged `Project=fai-tce-team-22-geo-cascadia`; keys only in `C:\projects\aws_ec2.env` (EC2) and
`C:\projects\aws_builder.env` (Bedrock, worker only), never printed or committed. This round: Phase 0 (local prep) and
Phase 1 (read-only checks) only; the launch waits for the owner's "go launch".

**Decisions taken while preparing (deviations or choices the brief left open):**
- **Two worker venvs** (`venv-worker`: torch / YOLO / CLIP / boto3; `venv-ocr`: Paddle) instead of one: the OCR step
  already runs in its own process (D38), and separate venvs keep torch's and Paddle's CUDA libraries from clashing. One new
  Colab-neutral setting in `colab_worker.py`: `OCR_PYTHON` (None = this Python, as before).
- **The server worker reuses the Colab cell's code** (loaded without `main()`), replacing only questions, Drive, tunnel and
  key input. One protocol, one set of tests.
- **Three secret files, not one:** `app.env` (API), `worker.env` (token + Google server key, derived), `aws_builder.env`
  (worker user only), so the API process can't read the AWS keys. All 600 in `/etc/geo-cascadia`.
- **Data outside the code:** releases are replaced, `/opt/geo-cascadia/data` is not; deploys never delete data files.
- **Tags:** the EC2 role refuses tags at creation on everything but the instance (dry-run probes), so the volume, network
  interface, security group, Elastic IP and key pair are tagged right after creation with CreateTags.
- **nginx** blocks the worker's endpoints from outside (`/api/worker/*` except the read-only status).
- **PDF reports on Linux** use DejaVu Sans for the four symbols Anek Tamil lacks (Arial on Windows, unchanged).

**Phase 1 results (8 Oct):** identity OK; g4dn.xlarge offered in all 3 zones; G vCPU quota 4 (one instance); AMI
`ami-04a61a72eafe2d8ab` "Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04) 20261002"; the exact launch request
dry-runs OK (only the instance tagged); RDS not visible to the role (AccessDenied), price API refused; Nova Lite answered
with the Builder keys ($0.0000011). Prices (public price files): $0.579/h; gp3 $0.0912/GB-month (100 GB $9.12/month);
public IPv4 $0.005/h ($3.65/month).

**Not available locally:** `use_router.joblib` and the two floor-count example photos (Drive `alldataset` only); the
bundle script stops and says where to put them.

**Checks (8 Oct, main before these changes):** backend 505 passed, 1 skipped; typecheck, build, test:ui 25, check:data, audit (both themes) pass; regression ALL PASSED, 291 checks, 0 retries (`run-2026-10-08_0802.log`). After: `test_d63_server_worker.py` 8 new; worker + report tests 106 passed, 1 skipped.

**Launched and deployed (8 Oct, owner's "go launch"):** instance `i-09e10c6bc76bb84dc`, Elastic IP `65.1.253.18`, site
http://65.1.253.18/. Owner decisions on the day: scikit-learn pinned to 1.6.1 (the router's pickle version); browser map
key gets the website restriction `http://65.1.253.18/*`; server key unchanged (works from the server, no IP restriction);
one live analysis approved ("Unnamed road near 5th Street", 50 m: 20 photos $0.14 at list price, Nova $0.0008, 2 min 19 s,
5 buildings / 3 poles). Only the instance could be tagged: the role refuses CreateTags on the volume, network interface,
security group, Elastic IP and key pair, also after creation. The instance is kept **stopped** between uses
(`start.ps1` / `stop.ps1`; 90-minute auto-stop). The laptop + Colab + tunnel set-up stays as the fallback.

Details, numbers and limits: explainer 07, D63 entry.
