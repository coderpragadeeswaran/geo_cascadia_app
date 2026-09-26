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

