> **Read docs/DECISIONS.md before any work.**

> **Every future change is documented as a new dated entry in docs/explainer/06_updates.md (what, why, how, files, numbers, limits).**

> **Before saying a change is done, verify it live: real API calls against the running backend and Playwright screenshots of every changed screen, checked by eye. Unit tests alone are not enough.** (`web/scripts/screenshots.ts`, dev server on :5173 + API on :8000)

# GEO-CASCADIA — Product build spec (read fully before writing code)

You are building the **product layer** of GEO-CASCADIA: database, API, job worker and an **exceptional,
map-first web app**. The perception pipeline (Python package `pipeline/geo_cascadia/`) is finished and
validated. **Do not change its logic, prompts or thresholds.** You import it, store its output and visualise it.

Owner: Praga (student team, FarmwiseAI Campus Product Challenge, Task 5). Style he wants from you: direct,
concise, structured, honest; minimal clarifying questions; when you deviate from this spec, say what and why.

---

## 1. What the product is (one paragraph)

A city official picks a street on a map (click it, or draw an area). The system pulls Google Street View
imagery for that street, finds **buildings, utility poles, streetlights and shop signs** with small local
models (YOLO detector, PaddleOCR), sends only uncertain cases to a vision-language model (Amazon Nova Lite),
locates everything on the map, compares it with property/asset registers, and shows **what is missing,
changed or wrong** — each finding with its Street View evidence, the model route it took, its cost and a
human review workflow. Ward 29, Coimbatore is the pre-computed showcase; any other street can be analysed
on demand.

## 2. Hard constraints

- **Laptop:** Windows, Ryzen 3 7320U, **8 GB RAM**, no NVIDIA GPU. Only the web app + API run here.
  Never load YOLO/Paddle/CLIP on the laptop. Keep the dev stack light (no Docker required).
- **GPU:** only Google Colab (T4, 2–3 h/day). Heavy work runs in a **Colab worker** that pulls jobs.
- **Maps must be Google Maps JavaScript API** (Street View content may only be shown via Google's APIs/embeds,
  with Google attribution intact). Not Mapbox/Leaflet base maps.
- **Registers are SYNTHETIC** (no open municipal data). Every place showing register data carries a small
  "synthetic register (demo)" label.
- **Never invent numbers.** KPIs/charts come from exports; accuracy claims come only from `data/model_card.json`.
- **No secrets in code or git.** `.env` files, `.gitignore` them.

## 3. Repository layout to create

```
geo-cascadia-app/
  CLAUDE.md                 (this file)
  data/
    model_card.json         (measured accuracy numbers — the only source for the Trust page)
    areas/<area_slug>/      (one folder per analysed area: export.json, export.geojson, run_report.json, other run JSONs)
    study_area/Study_area.geojson
  pipeline/geo_cascadia/    (the finished Python package — import only)
  tools/build_run_report.py (given; builds run_report.json from a run folder)
  tools/import_osm_local.py (D53: OSM + Microsoft footprints of the covered cities -> PostGIS; --refresh monthly)
  backend/                  (FastAPI + SQLAlchemy/psycopg + PostGIS)
  worker/colab_worker.py    (cell code the owner pastes into Colab)
  web/                      (React + Vite + TypeScript app)
```

## 4. Data you are given

### 4.1 Areas (pre-computed)
| slug | what | notes |
|---|---|---|
| `ward29` | Ward 29, Coimbatore — production run (YOLOv8s + local building-use router) | 381 buildings, 268 assets, 30 unmapped businesses, full data |
| `trichy_bharathidasan_salai` | unseen city, 2.5 km | produced by an older package version: some newer fields missing |
| `tiruppur_uthukuli_road` | unseen town with almost no building maps (1 OSM footprint on 662 m) | shows the "unmapped businesses" fallback |

Loader must tolerate missing optional fields (`property_identifiers`, `use.route` values, `unmapped_businesses`).

### 4.2 `export.json` schema (per area)
Top level: `meta`, `dashboard`, `buildings[]`, `assets[]`, `missing_asset_records[]`, `streetlight_gaps[]`,
`review_queue[]`, `unmapped_businesses[]`.

- `meta`: `area`, `generated`, `pipeline{detector, ocr, vlm, name_gate, footprints, reference}`, `registers`,
  `counts{...}`, `run{coverage{panoramas, user_photospheres, cameras_planned, views_planned,
  views_facing_no_mapped_building, footprints{osm,microsoft}, osm_built_fraction, buildings_registered,
  buildings_by_source, verdict}, street_view_requests, street_view_cost_usd_notional, views_planned,
  sign_crops_total, crops_read_by_ocr, crops_discarded_no_text, crops_escalated, crops_skipped_fast_mode,
  ocr_mode, ocr_sec_per_crop, buildings_use_local, buildings_use_vlm, vlm_calls, vlm_cost_usd, places_calls,
  device, stage_seconds{panoramas, area, plan, detect, geometry, ocr, vlm, reference, match, export},
  total_minutes, validation{...}, planted_error_scores{...}, asset_register_scores{...}}`
- `dashboard`: `kpi{streets_covered, buildings_analysed, unmatched_properties, buildings_with_discrepancy,
  streetlights, poles, named_businesses, sign_text_unverified, names_confirmed_by_google,
  low_confidence_observations, unmapped_businesses}`,
  `charts{building_use, floor_distribution, floors_status, asset_type, match_status, discrepancy_type,
  by_street{<street>:{buildings, no_record, discrepancy, streetlights, poles, gap_m_60}}}`, `cost_panel`, `streets[]`
- `buildings[]`: `id` (OSM `w…`/`r…` or `ms_…`), `lat`, `lon`, `street`,
  `footprint{source, osm_id, area_m2, frontage_m (= the road-facing wall since D51), longest_side_m, frontage_source, depth_m, polygon_latlon[[lat,lon],…]}`,
  `attributes{use{value, route('tier1_local_clip'|'tier3_vlm'), validated}, property_identifiers[] (unverified),
  floors{value, status('measured'|'low_confidence'|'not_measured'), route, validated},
  name{value, quality('good'|'fragment'|'tamil_unverified'), route('tier2_ocr'|'tier3_vlm+ocr_gate'|'tier3_vlm_unverified'),
  google_confirmed, google_name, google_place_id}, shop_units, condition{value, withheld:true, why}}`,
  `register{source:'SYNTHETIC', property_id, record_use, record_floors, record_area_m2, record_dist_m}`,
  `match_status('matched'|'discrepancy'|'no_record')`, `discrepancies[]`, `reasons[]`, `evidence_basis{}`,
  `severity('none'|'medium'|'high')`, `google_flags[]`, `review{queued, priority, reasons[], status, appeal_photo_path, appeal_note}`,
  `evidence{views[{pano_id, heading, pitch, dist_m, side}], attribute_view{pano_id, heading, pitch, fov, x1,y1,x2,y2},
  sign_view{pano_id, heading, pitch, fov, ocr_text, ocr_conf, tier}}`, `cost{vlm_calls, vlm_usd}`
- `assets[]`: `id`, `type('pole'|'streetlight')`, `lat`, `lon`, `street`, `confidence('high'|'medium'|'low')`,
  `n_detections`, `cameras_used`, `method`, `uncertainty_m`, `uncertainty_basis`, `route`,
  `register{source, status('matched'|'discrepancy'|'unrecorded_asset'|'unconfirmed_detection'), asset_no, flags[], record_type}`,
  `review{…}`, `evidence{views[{pano_id, heading, pitch, fov, source}]}`
- `streetlight_gaps[]` (60 m interval): `id`, `street`, `length_m`, `start[lat,lon]`, `end[lat,lon]`, `poles_inside`, `gap_type`
- `unmapped_businesses[]`: `id`, `name`, `ocr_text`, `lat`, `lon` (approximate), `street`, `sightings`, `position`, `evidence{pano_id, heading, pitch, fov, x1..y2}`
- `review_queue[]`: `item_type('building'|'asset')`, `building_id`|`asset_cls`, `street`, `lat`, `lon`, `reasons[]`, `priority(1..6)`, `status`
- Box coordinates `x1..y2` are pixels in a **640×640** Street View image at the stored `heading/pitch/fov`.

### 4.3 `run_report.json` (per area; built by `tools/build_run_report.py <area folder>`)
Sections: `imagery`, `maps`, `detection`, `assets`, `buildings` (incl. why buildings got no attributes),
`signs`, `unmapped_businesses`, `matching`, `review`, `cost_time`, and `story[]` (plain-English sentences).
Run the tool for every area folder during setup and whenever the worker delivers a new area.

### 4.4 `model_card.json`
All measured accuracy/benchmark/negative results. Render it; never restate numbers not in it.

## 5. Architecture

```
web (React, laptop :5173) ──HTTP──> backend (FastAPI, laptop :8000) ──SQL──> Supabase Postgres + PostGIS
                                       ▲  job queue table
                                       │  exposed by `cloudflared tunnel --url http://127.0.0.1:8000` (127.0.0.1: Windows may resolve localhost to IPv6)
                                  Colab worker (GPU or CPU) polls /worker/next → run_area() → posts progress + export
```
- **Map data (D53):** OpenStreetMap roads / buildings / shop points and Microsoft building footprints for Coimbatore,
  Trichy, Tiruppur and Madurai live in PostGIS (`tools/import_osm_local.py`, refreshed monthly). Inside those boxes the
  street click (PostGIS nearest-neighbour), the mini-maps, the cost planner and the worker's area stage read them
  (`backend/app/mapdata.py`; the pipeline's `area.MAP_SOURCE` hook; the worker asks `POST /worker/mapdata` over the
  tunnel, never the database directly). Outside them: Overpass as before, answers cached 30 days. `LOCAL_MAP_DATA=0`
  switches the copy off.
- Pre-loaded areas work with no worker online. A new street becomes a **job**; if no worker is online the UI
  says "queued — analysis worker offline" (honest, not an error).
- The pipeline is resumable per stage; the worker can die and resume.

## 6. Database (Supabase, PostGIS, EPSG:4326, GiST indexes)
`areas(id, slug, name, polygon, bbox, created_at, source_job_id, export jsonb meta, dashboard jsonb, run_report jsonb)`
`buildings(area_id, id, street, geom point, footprint polygon, use, use_route, floors, floors_status, name, name_quality,
name_route, google_confirmed, match_status, severity, discrepancies text[], reasons text[], attrs jsonb, register jsonb,
evidence jsonb, review_status, PRIMARY KEY(area_id,id))`
`assets(area_id, id, type, geom point, confidence, cameras_used, uncertainty_m, register_status, flags text[], evidence jsonb, review_status)`
`unmapped_businesses(area_id, id, name, geom point, sightings, evidence jsonb)`
`streetlight_gaps(area_id, id, street, geom linestring, length_m, poles_inside, gap_type)`
`review_items(id serial, area_id, item_type, ref_id, priority, reasons text[], status('pending'|'approved'|'rejected'|'appealed'),
reviewer, note, appeal_photo_url, updated_at)` — the appeal photo is stored as a private Storage path; a 10-minute signed link is made on request (D11)
`jobs(id uuid, kind('street_click'|'polygon'), input jsonb, status('queued'|'running'|'done'|'failed'|'expired_token'|'no_street_view'|'needs_approval'),
stage, done, total, message, area_id, created_at, started_at, finished_at, worker_id)`
Loader: `backend/load_area.py <area folder>` — idempotent upsert of export.json + run_report.json.
Map data (D53, migration 008): `map_cities(city, name, box, box_source, osm_snapshot, ms_release, counts)`,
`osm_roads(way_id, city, highway, name, bridge, tunnel, geom line)`, `osm_buildings(id 'w…'|'r…_k', city, geom polygon)`,
`osm_pois(osm_type, osm_id, city, geom point)`, `ms_buildings(id, city, geom polygon)`; GiST on every geometry. Database
270.8 MB of the free 500 MB after loading the four cities (3 Oct 2026); the import stops above 325 MB.

## 7. API (FastAPI)
- `GET /areas` · `GET /areas/{slug}` (meta + dashboard + run_report) · `GET /areas/{slug}/geojson?layers=buildings,assets,gaps,unmapped&bbox=`
- `GET /areas/{slug}/buildings?street=&status=&use=&q=&page=` · `GET /buildings/{area}/{id}` · same for assets
- `POST /query {area, text}` → `{parsed_filters, rows|groups, why_empty[]}` — **reuse `pipeline/geo_cascadia/workspace.QueryEngine`**
  by rebuilding its inputs from export.json (results = one dict per building with keys `building_id, street, lat, lon,
  obs_use, obs_floors, floors_status, match_status, discrepancies, ref_flags(=google_flags), name, …`; assets with
  `cls=type`; gaps as `{"60": streetlight_gaps}`; queue = review_queue). Must answer the 5 spec queries in §10.
- `GET /review?area=&status=` · `PATCH /review/{id}` (approve / reject / appeal + note + optional photo upload to Supabase Storage)
- `POST /jobs {lat, lon}` (click; backend calls `geo_cascadia.picker.click_to_street` — pure Overpass/geometry, light) or `{polygon}`;
  `GET /jobs/{id}`; `GET /jobs?active=1`
- Worker (header `X-Worker-Token`): `POST /worker/next` (claims oldest queued job), `POST /worker/progress {job, stage, done, total}`,
  `POST /worker/result` (multipart: export.json + run JSONs → saved to `data/areas/<slug>/`, run_report built, loaded), `POST /worker/fail {job, code, message}`
- `GET /model-card` → data/model_card.json
- `GET /mapdata` → the covered cities, snapshot dates, attribution (D53); `GET /areas/{slug}/hood` carries `map_data`
- `POST /query` also takes the spatial rule "… within N m of a possible dark stretch" (`near_dark_m`, PostGIS
  `ST_DWithin`; `backend/app/spatial.py`), applied after QueryEngine
- Worker: `POST /worker/mapdata {kind: overpass, query} | {kind: microsoft, bbox}` → local / overpass / cache / pending / none
- `GET /config/public` → `{maps_js_key, map_id}` (browser key only)

## 8. Worker (`worker/colab_worker.py`)
A single Colab cell to paste **after** the owner's existing setup cells (S0 install package, S1a deps, S1b keys → gives `cfg`, `run_area`, `D`).
Loop: claim job → `click_to_street`/polygon → `run_area(poly, out_dir, cfg, name, way_ids=…, progress=post)` → upload export + JSONs.
The cell sets `geo_cascadia.area.MAP_SOURCE` so the area stage's map data comes from the app (D53) and records what
answered in `worker_run.json` `map_data`. Map pipeline errors to job statuses: `NO_STREET_VIEW`, `NO_STREETS`, `NO_CAMERAS` → `no_street_view` with the message;
`AWS token expired` → `expired_token` then stop (owner refreshes keys, re-runs; `run_area` resumes). Heartbeat every 15 s; a running job silent for 2 min is "interrupted" and claimable again (D34). Display statuses
add cancelled / cancelling / interrupted (D29, D35). A failed result upload is retried with back-off (P7 R3).

## 9. THE APP — design brief (this is where "exceptional" matters)

### 9.1 Feel
Think **Life360 / Google Earth / Apple Maps look-around**, not an admin dashboard. The map *is* the app: full-bleed,
everything else floats over it (the app uses flat "Night Survey" panels, not glass: docs/DESIGN.md, D15). Motion is purposeful: camera fly-to, smooth tilt into 3D,
cross-fade into Street View. Calm dark theme by default (light theme toggle), one accent colour, clear status colours
(as built, D15/D22: matched = dusk slate, differs = glacier, not in register = peony, review = chalk dashed outline,
approximate = hollow/dashed; one accent, sodium orange). Typography as built: Anek Tamil (Latin + Tamil) and Martian Mono for
numbers (tabular). Everything keyboard-accessible; works at 1366×768 (the owner's laptop) and scales up.

### 9.2 Stack
React 18 + Vite + TypeScript, Tailwind + shadcn/ui, Framer Motion, `@vis.gl/react-google-maps` (vector map with a **Map ID**
so tilt/rotation/3D buildings work), `deck.gl` + `@deck.gl/google-maps` `GoogleMapsOverlay` for data layers
(3D extruded footprints, icon layers, heat/hexbin, animated paths), TanStack Query + TanStack Table, Zustand (one global
selection/filter store), `cmdk` command palette, Recharts (bars/donuts) + our own SVG funnel/Sankey (Nivo was not installed: lean bundle). Keep bundle lean.

### 9.3 Zoom-driven map experience (the signature interaction)
- **City level (z ≤ 13):** dark vector map; analysed areas glow as outlined polygons with a count badge; pulsing dot for running jobs.
- **Area level (z 14–16):** (as built, D15: Night stays on the dark roadmap — Cloud dark styles don't apply to satellite;
  satellite is a Daylight option in Layers); streets coloured by health (discrepancies per km); streetlight gaps as
  glowing dashed red segments; hexbin density of findings; hover a street → tooltip with its mini-KPIs.
- **Street level (z 17–18):** tilt to ~45°; building footprints **extruded in 3D by observed floor count** (unknown floors = flat,
  hatched), coloured by match status; poles/streetlights as crisp icons with **uncertainty circles** (dashed for approximate);
  unmapped businesses as hollow pins; Street View coverage (blue) layer toggle.
- **Object level (z ≥ 19) / click:** camera flies to the object, then the **Street View dive**: the evidence panel slides up and the
  map cross-fades into an embedded `StreetViewPanorama` at the stored `pano_id/heading/pitch`, with the detection box drawn on a
  Street View Static image of the exact evidence view (640×640, same heading/pitch/fov) and a toggle to the live 360° panorama.
  "Back to map" reverses the animation. Moving inside the panorama moves a camera marker on the minimap.
- Always-on: layer switcher, legend, minimap, compass/tilt reset, search box (Places Autocomplete to jump anywhere).

### 9.4 Pages
1. **Explore** (home) — map + floating UI:
   - top bar: area switcher, search, command palette (⌘K / Ctrl+K), theme, jobs indicator.
   - **KPI ribbon** (from `dashboard.kpi`): each card clickable → filters map + table (e.g. "19 no record").
   - **Right panel (tabs):** *Findings* (table: id, street, location, use, floors, OCR text/name, confidence/route badges,
     matched record, review status — spec columns), *Charts* (building use, floor distribution [measured only, note n],
     asset type, match status, **unmatched by street — clicking a bar zooms the map to that street**, discrepancy types),
     *Streetlights* (gap list with length, "poles present, no lamp detected" vs "no pole or lamp").
   - **Evidence drawer** for the selected object: Street View evidence with box, OCR text, attributes each with a **route badge**
     (Tier 1 YOLO / local CLIP · Tier 2 OCR · Tier 3 VLM), validation note (from model_card), register record (labelled synthetic),
     Google cross-check, reasons, cost, review actions.
   - **Analyse a street:** "Analyse" mode → hover highlights the street under the cursor (snap to Street View coverage) →
     click → confirm sheet shows street name + length + estimated time/cost → job starts → **live progress**: the street animates
     camera-by-camera along its length as stages complete (panoramas → plan → detect → OCR → VLM → match), with the stage list and
     timings; on completion the new area fades in and the map flies there. Friendly states: queued/worker offline, no Street View,
     token expired.
   - **Query bar** (also inside ⌘K): free text → parsed filter chips (editable) → results highlight on map + table;
     empty result shows the `why_empty` funnel ("381 buildings → 19 no record → 1 commercial → 0 with >2 floors").
   - Selecting a street or segment filters map, table and charts together (single store).
2. **Under the Hood** (Pipeline Inspector — owner's special request): for the selected area/run, explain *what happened
   behind the scenes*, driven by `run_report.json`:
   - hero "story" (the `story[]` sentences) as an animated timeline;
   - **Sankey**: panoramas → camera stops → views (mapped / unmapped frontage) → detections by class → located assets
     (triangulated vs approximate) and buildings (usable view / no box / rejected by quality gate with reasons);
   - sign funnel: crops → watermark / no text / OCR-read / escalated → named → Google-confirmed; unmapped-business candidates → kept;
   - **stage timeline** (Gantt from `stage_seconds`), **cost waterfall** (Street View images, VLM calls, Places calls),
     model-route donut (local vs VLM for use; OCR vs VLM for names);
   - **coverage verdict banner** (e.g. "90% of views face no mapped building — assets & signs analysed, buildings limited");
   - per-street breakdown table; "what got dropped and why" list (cameras inside footprints, boxes rejected, names dropped by the gate);
   - **Compare runs**: Ward 29 vs Trichy vs Tiruppur side-by-side cards (shows how data availability changes results).
3. **Review** — full-screen queue (priority, reasons, filters); split view: item list | evidence Street View | decision panel.
   Keyboard: A approve, R reject, E appeal (note + photo upload), J/K next/prev. Status persists via API and updates the map.
4. **Trust** (model card) — every measured number with its n from `model_card.json`: detector per-class P/R + benchmark chart
   (v8n / v8s / YOLO26n / YOLO26s, and why v8s stays), routed-vs-all-VLM cost & accuracy comparison (spec requirement),
   local-router savings, floors, names, positions check, **rejected experiments** (VLM lamp check 0/20, zoom re-shoot,
   3-example floors, condition withheld, door numbers) presented honestly as "what we tried and dropped".
5. **Jobs** — history of analyses with status, duration, cost, link to area and to Under the Hood.

### 9.5 Demo mode
As built (P7.5): a seven-step tour from the **?** button on the rail (opens once on the first visit): key numbers → a
building's evidence → Review → Analyse a street → Jobs → Trust (Gate 1 "Not verified") → done. Esc closes, ← → step.
Original brief: a "Guided tour" button that plays the spec's example queries one by one with map fly-throughs and captions
(each step real data, skippable). Must run fully on pre-computed data with no worker.

### 9.6 Compliance in the UI
Google attribution always visible on map and Street View; user photospheres show contributor credit (Maps JS does this);
Street View Static images fetched live by the browser (browser key, referrer-restricted), not stored or re-hosted;
Places data displayed by place_id lookup where shown; footer note: "Registers are synthetic demo data. Prototype —
imagery © Google."

## 10. Acceptance tests (must all pass on Ward 29, no worker needed)
1. "Show commercial buildings with more than two visible floors that do not have a matching property record" → parsed chips +
   result (or `why_empty` funnel) highlighted on map.
2. "Show streets where no streetlight is detected within 60 m" → gap segments highlighted, list sorted by length.
3. "Display only low-confidence floor-count predictions and create a review queue" → filtered set + one click sends them to Review.
4. "Chart of unmatched buildings by street" → bar chart; clicking a bar zooms the map to that street.
5. Click any building/asset → Street View evidence at the stored heading with its box, attributes with route badges, register record.
6. Cost panel shows routed vs all-VLM cost and accuracy from model_card.json.
7. Under the Hood renders all sections for all three areas.
8. Click a new street → job queued → (with worker online) progress → new area appears. With worker offline: honest queued state.

## 11. Build phases (stop at each checkpoint and show the owner)
- **P0** Repo skeleton, read data, generate TypeScript types from §4 schemas, run `tools/build_run_report.py` for each area. ✔ list of areas + counts.
- **P1** Supabase schema migration + `backend/load_area.py`. ✔ row counts equal `meta.counts` for all areas.
- **P2** FastAPI endpoints (§7) incl. QueryEngine wrapper. ✔ Swagger; the 5 spec queries return correct rows.
- **P3** Web foundation: design tokens, layout shell, Google vector map with Map ID, deck.gl overlay, zoom-level layer logic. ✔ Ward 29 visible in 3D.
- **P4** Explore page complete (KPIs, panels, charts, table, evidence dive, query bar, sync store). ✔ acceptance tests 1–6.
- **P5** Under the Hood + Trust + Review + Jobs pages. ✔ test 7 + review round-trip.
- **P6** Worker cell + job flow + tunnel. ✔ test 8 end-to-end with Colab.
- **P7** Polish: guided tour, animations, loading/empty/error states, performance (≤ 60 MB RAM tab idle on 8 GB laptop), README with run steps.

## 12. Things you must not do
- Don't edit `pipeline/geo_cascadia/*` logic (bug fixes only if the owner asks).
- Don't fabricate metrics, register data, or evidence; don't show `condition` as a finding (it's withheld).
- Don't cache Street View imagery server-side or display it outside Google's APIs/attribution.
- Don't put API keys in the frontend except the referrer-restricted Maps JS browser key.
