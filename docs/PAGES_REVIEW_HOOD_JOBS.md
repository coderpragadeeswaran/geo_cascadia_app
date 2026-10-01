# Review, Under the Hood and Jobs — how these pages work

This document describes the three secondary pages of the GEO-CASCADIA web app. It was written on 26 Sep 2026 (commit
`505c9bc`) and **brought up to date on 1 Oct 2026 (P7 R3)**: the Under the Hood section, the worker and jobs parts, Spec
vs code, the limitations and the open questions now describe the code as it is (P5–P7: D29–D49). Smaller details in
the Review section still date from 26 Sep where no later decision changed them. The source of truth is the code. Every claim cites
the file and the function or component. Where the code differs from the written specs (`CLAUDE.md`, `docs/DESIGN.md`,
`docs/DECISIONS.md`), the code is described and the difference is listed in [Spec vs code](#spec-vs-code).

Numbers quoted as examples are from the **Ward 29, Coimbatore** area (`data/areas/ward29/`) unless stated otherwise.

---

## Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Glossary](#glossary)
4. [Shared plumbing](#shared-plumbing)
5. [Review page](#review-page)
6. [Under the Hood page](#under-the-hood-page)
7. [Jobs page](#jobs-page)
8. [Where data lives](#where-data-lives)
9. [Spec vs code](#spec-vs-code)
10. [Known limitations / not implemented](#known-limitations--not-implemented)
11. [Open questions](#open-questions)

---

## Overview

GEO-CASCADIA is a prototype for city officials. A finished Python pipeline (`pipeline/geo_cascadia/`, not changed by
the app) analyses Google Street View images of a street. Its steps:
- It finds buildings, utility poles, streetlights and shop signs, with a local YOLO detector and OCR.
- It sends uncertain cases to a vision-language model.
- It places everything on a map.
- It compares the results with property and asset registers.

The **product layer** stores the pipeline's output in a database and shows it in a map-first web app. It consists of a
FastAPI backend (`backend/app/`) and a React app (`web/src/`).

The map page ("Explore") is the home screen. Three other pages sit on the left rail:
- **Review:** a person confirms or rejects the findings the models were unsure about.
- **Under the Hood:** explains, step by step, what the pipeline did for an area.
- **Jobs:** lists the pre-computed areas and any new analyses requested from the app.

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser — React app (web/, Vite dev server :5173)"]
    R[Review page]
    H[Under the Hood page]
    J[Jobs page]
    E[Explore map]
  end
  subgraph API["FastAPI backend (:8000) — backend/app/main.py"]
    D{{"Data.read / Data.write<br/>(backend/app/store.py)"}}
    DB[(DbStore)]
    JS[(JsonStore<br/>read-only)]
  end
  subgraph Supabase["Supabase (cloud)"]
    PG[("Postgres + PostGIS<br/>areas, buildings, assets,<br/>review_items, review_events, jobs, …")]
    BK[["Storage bucket<br/>appeal-photos (private)"]]
  end
  FILES[("data/areas/&lt;slug&gt;/*.json<br/>export.json, run_report.json,<br/>detections.json, plan.json …")]
  GSV[["Google Street View Static API<br/>(images fetched by the browser)"]]
  W["Colab worker<br/>(worker/colab_worker.py, P6)"]

  R & H & J & E -- "HTTP JSON" --> API
  D -->|DB reachable| DB --> PG
  D -->|DB unreachable: offline mode| JS --> FILES
  API -- "appeal photo upload,<br/>signed URLs (service key)" --> BK
  API -- "evidence boxes<br/>(detections.json)" --> FILES
  Browser -- "photo pixels" --> GSV
  W -. "/worker/* (X-Worker-Token)" .-> API
```

- **One store per request.** `Data.read(fn)` in `backend/app/store.py` runs `fn` on the database store (`DbStore`). If
  the database is unreachable, it runs `fn` on the JSON store (`JsonStore`) instead and marks the response
  `"offline": true`. After a failure it keeps serving JSON for 30 s (`Settings.offline_retry_s`), then tries the
  database again.
- **Writes never fall back.** `Data.write(fn)` raises `OfflineError`, which the API turns into HTTP 503
  (`main.py` `_offline` handler).
- **Stale connections.** A failure on a reused idle connection (the Supabase pooler closes idle connections) is retried
  once on a fresh connection before anything is marked offline (`Data._db`).
- **Street View pixels never pass through the backend.** The browser loads the Static API image directly with the
  referrer-restricted browser key returned by `GET /config/public` (`web/src/components/EvidencePhoto.tsx`
  `staticUrl`). The backend only sends the box coordinates.
- **Connection string.** The backend reads `DATABASE_URL` from `backend/.env`, e.g.
  `postgresql://<user>:<password>@<pooler-host>:5432/postgres`. It is never logged (`backend/app/db.py`).

## Glossary

| Term | Meaning in this project |
|---|---|
| **Area** | One analysed region, identified by a *slug* (e.g. `ward29`, `trichy_bharathidasan_salai`, `tiruppur_uthukuli_road`). Rows in table `areas`; files in `data/areas/<slug>/`. |
| **Pipeline** | The finished Python package `pipeline/geo_cascadia/`. The app imports parts of it but never changes it. |
| **export.json** | The pipeline's main output per area: buildings, assets, streetlight gaps, review queue, run metadata. |
| **run_report.json** | Pipeline-internal counts per area (imagery, detection, signs, cost/time), built by `tools/build_run_report.py` from the run files. |
| **Panorama** | One 360° Street View photo sphere, identified by a `pano_id`. |
| **User photosphere** | A panorama uploaded by a member of the public rather than Google's car. The pipeline does not use its camera geometry for positions. |
| **Camera stop / view** | The pipeline does not grab all 12 headings at every panorama. It plans *camera stops* that face the frontage, and 1–N *views* per stop. A view is one 640×640 image at a stored heading/pitch/fov (`plan.json`). |
| **Detection / box** | A YOLO bounding box in one view: class `building`, `pole`, `lamp_head` or `signboard`, a confidence 0–1, and pixel coordinates `x1,y1,x2,y2` in the 640×640 image (`detections.json`). |
| **geom_ok** | A flag on a detection: `true` if it was usable for positioning. Boxes from tilted views and user photospheres are excluded. |
| **Asset** | A located pole or streetlight (`assets[]` in export.json, table `assets`). |
| **Triangulated** | An asset whose position was solved from two or more camera positions (`method = "triangulated"`). The UI calls it "Pinpointed". |
| **Approximate** | An asset positioned from a single camera direction (`method = "rough_mean"`), with larger uncertainty. The UI calls it "Approximate position". |
| **Asset confidence** | Set by the pipeline (`geometry.py`): `high` if ≥ 2 cameras were used, `medium` if ≥ 2 detections but < 2 cameras, `low` if a single detection. |
| **Dark stretch** | A stretch of road with no streetlight detected within 60 m ("streetlight gap"). Records in `streetlight_gaps[]`. |
| **Synthetic register** | There is no open municipal data. The pipeline *generates* a fake property register and asset register (`match.py`, seeded, about 22% planted errors). Every place that shows register data says "synthetic register". |
| **Match status** | Building vs synthetic register: `matched`, `discrepancy` (the record differs), or `no_record` (the building is not in the register). |
| **Discrepancy types** | `location_shift` (the record pin is more than 15 m from the building), `area_understated` (recorded area below 75% of the footprint), `use_change` (recorded use ≠ observed use), `extra_floor` (more floors observed than recorded), `missing_record`. Thresholds: `pipeline/geo_cascadia/config.py` `match_m=15`, `area_tol=0.25`. |
| **Severity** | Per building (`match.py` `match_properties`): `high` if there is no record, or at least 2 geometry discrepancies, or 1 geometry discrepancy plus another; `medium` for any other discrepancy; `none` otherwise. |
| **Router: local / VLM** | Building use is decided either by a **local** classifier (CLIP embedding + logistic regression, route `tier1_local_clip`) or by the **VLM**, a vision-language model (Amazon Nova Lite, route `tier3_vlm`). Shop names: OCR (`tier2_ocr`) or VLM. |
| **Review item** | One entry in the review queue: a building or an asset a person should check. Table `review_items`. |
| **Priority, "P1"…"P6"** | Review urgency, 1 = most urgent (see [How the queue is built](#how-the-queue-is-built-and-ordered)). The list shows it as a badge `P1`. Not to be confused with the **build phases P0–P7** in `CLAUDE.md` §11 (P5 = these pages, P6 = worker and jobs). |
| **review_events** | Append-only history table (decision D24): one row per decision or undo (see [Undo](#undo)). |
| **Decision (D-number)** | An entry in `docs/DECISIONS.md` (D1…D24) recording a design or data rule. |
| **Resumed run** | The stored pipeline runs were restarted from checkpoints. Their stage timings and minute totals are therefore not real full-run values (D1). |
| **model_card** | `data/model_card.json`: the only source of measured accuracy and cost figures (shown on the Trust page, not on these three pages). |
| **Offline mode** | The backend cannot reach Supabase and serves read-only data from the JSON files (D4). The UI shows "Offline — read-only". |
| **Job** | A request to analyse a new street or area. Table `jobs`. |
| **Worker** | `worker/colab_worker.py`: one notebook cell (Colab / Kaggle GPU or laptop CPU) that claims jobs and runs the pipeline (P6, D34; steps in `worker/README.md`). |
| **USER / VERIFIER pages** | D16: Explore, Review and Analyse use plain language. Under the Hood and Trust are for checking the method. |

## Shared plumbing

| Concern | Where |
|---|---|
| Page switch | `web/src/App.tsx` `Pages`. The map (`MapView`) stays mounted under every page; Review, Hood and Jobs are drawn over it as an opaque layer (`surface absolute inset-0 z-40`). Hash routes `#/review`, `#/hood/<section>`, `#/jobs`. |
| Left rail and Review badge | `web/src/components/Rail.tsx`. The badge = number of review items with `status === 'pending'` in the current area. |
| Current area | Zustand store `web/src/store/ui.ts` `area` (persisted in `localStorage` key `gc.area`). All three pages follow it. |
| Data fetching | TanStack Query hooks in `web/src/api/queries.ts`. Area records are loaded once per area by `web/src/lib/useAreaData.ts` `useAreaData` and shared by every page. |
| Offline flag | `web/src/api/client.ts` `api()` reads `offline` from every JSON response into the store (`setOffline`). |

---

## Review page

Component: `web/src/pages/Review.tsx` (default export `Review`). Route `#/review`.

### What it is for

A person works through the items the pipeline flagged as uncertain or suspicious. For each one they look at the Street
View evidence and record a decision: approve (the finding is right), reject (the finding is wrong) or appeal (it needs
more, with a note and an optional photo). Decisions are stored in the database, logged in `review_events`, reflected on
the map, and can be undone one at a time.

### Layout

Three columns (`grid-cols-[330px_minmax(0,1fr)_320px]`): **queue** (left) | **evidence** (middle) | **decision**
(right).

### How the queue is built and ordered

**1. The pipeline builds the queue.** `pipeline/geo_cascadia/match.py` `review_queue(results, assets)`:

| Reason string (pipeline) | Triggered when | Priority |
|---|---|---|
| `high-severity discrepancy` | building `severity == "high"`: no register record, or ≥ 2 geometry discrepancies, or 1 geometry + 1 other | **1** |
| `attribute discrepancy — verify on imagery` | building discrepancies include `use_change` or `extra_floor` | **2** |
| `name read by VLM only (not supported by OCR)` | the shop name came from the VLM and OCR did not confirm it (`name_review`) | **3** |
| `floor count low confidence (roofline not visible)` | `floors_status == "low_confidence"`: the VLM said the roofline was not visible or it was not confident (`vlm.py`) | **4** |
| `building seen from one view only` | the building had ≤ 1 view **and** at least one discrepancy | **5** |
| `single-detection asset` | a pole or streetlight with `confidence == "low"` (seen in a single detection) | **6** |

- A building gets all reasons that apply. Its **priority is the smallest (most urgent) of them**:
  `min(PRI[x] for x in reasons)`.
- Assets always get priority 6.
- The queue is sorted by priority. Ward 29 had 260 items on 26 Sep (218 since P7a, D42); the split below is from 26 Sep: P1 24, P2 61, P3 3, P4 2, P5 13, P6 157 (from
  `run_report.json` `review.by_priority`).

**2. The loader copies it into the database.** `backend/app/loader.py` `load_area` (run by `backend/load_area.py`):
- One row in `review_items` per queue entry, with `ord` = the position in export.json.
- Asset entries have no id in export.json. They are joined to assets by rounded lat/lon + type (D7).
- **Reloading an area never overwrites a decision.** `on conflict … do update` refreshes street, geometry, priority,
  reasons, discrepancies and `ord`, but not `status`.
- Only *pending* items that vanished from the export are deleted.

**3. The API lists it.** `GET /review?area=<slug>&page_size=500` (`backend/app/review.py` `review_list`):
- Builds one row per item with `views.review_row`: the item plus an `object` summary. For buildings: use, floors,
  floors_status, match_status, name, severity. For assets: type, confidence, method, register_status.
- Sorts by priority, 1 first; a missing priority sorts last.
- `page_size` is capped at 500 (`views.page`).
- Optional filters: `status`, `item_type`, `street`, `priority` (the UI uses none).

**4. The page sorts again and may filter.** `Review.tsx` sorts by priority (stable, so export order is kept within a
priority). If the page was opened from Explore with **"Send N to Review"**, only those ids are shown (store
`reviewFocus`, set by `useUi.sendToReview`).

### Left column: the queue

| Element | Shows | Source |
|---|---|---|
| Eyebrow "Review · most urgent first" | fixed text | — |
| Title "**N waiting**" | number of listed items with `status === 'pending'` | `/review` rows, patched in the cache after each decision, so it updates immediately |
| Title when opened from Explore | "**N sent from Explore · M waiting**" + the question text + link "show the whole queue" (clears `reviewFocus`) | store `reviewFocus` |
| Offline line | "Offline — read-only. Decisions can't be saved until the database is back." | store `offline` |
| List row, line 1 left | the display name (`title()`): building → name if read, else use ("Residential", "Shop + home"…), else "Building", then "· street". Asset → "Pole · street" or "Streetlight · street" | row `object.name`, `object.use`, `street`, `asset_cls` |
| List row, line 1 right | **`P<n>`** in the accent colour while waiting; otherwise the status word in grey (`approved`, `rejected`, `appealed`) | `priority`, `status` |
| List row, line 2 | the reasons in plain words, joined with "·" | `reviewReasons()` (below) |
| Selected row | highlighted background | local state `i` |
| Footer | "J / K next · A approve · R reject · E appeal · U undo" | fixed |

Empty states: "Loading…" while fetching; "Nothing to review." in the middle column when the list is empty.

### "Why a person should check": the reasons in plain words

`web/src/lib/labels.ts` `reviewReasons(reasons, {match_status, discrepancies})` rewrites the pipeline strings so the
wording fits the finding. Duplicates are removed.

| Pipeline reason | Shown as | Condition |
|---|---|---|
| high-severity discrepancy | "Not in the register" | building `match_status == no_record` |
| high-severity discrepancy | one line per difference: "Extra floor vs register", "Use differs from register", "Register pin in the wrong place", "Bigger than recorded", "Recorded as a different type" | building has discrepancies |
| high-severity discrepancy | "Differs from the register" | otherwise |
| attribute discrepancy — verify on imagery | "Extra floor vs register" / "Use differs from register" | for each `extra_floor` / `use_change` |
| name read by VLM only … | "Shop name read by the AI model only" | — |
| floor count low confidence … | "Floor count is an estimate (roof not visible)" | — |
| building seen from one view only | "Seen from one camera position only" | — |
| single-detection asset | "Seen in one photo only" | — |
| anything else | the text, capitalised, with "— verify on imagery" removed | — |

The plain meaning: the register disagrees with what the photos show, or the models were not sure (name, floors), or
there was too little imagery (one view, one detection) to trust the finding.

### Middle column: the evidence photo

Component `web/src/components/EvidenceViews.tsx` `EvidenceViews`. Explore's evidence drawer uses the same component,
so both views behave identically.

**Header.** A micro-label ("Building" / "Pole or streetlight") and the display name in large type.

**Which image.** The page calls `GET /areas/<slug>/evidence/<kind>/<id>` (`main.py` `evidence_boxes` →
`backend/app/evidence.py` `evidence()`), which returns a list of *views*. Buildings:
- **"Front"**: `evidence.attribute_view`, the planned view the pipeline used to judge use and floors.
- **"Sign"**: `evidence.sign_view`, the view in which the shop sign was read.
- **"Nearest camera"**: `evidence.views[0]`, used only if neither of the above exists.

Assets:
- One view per entry in `evidence.views`, labelled "Camera 1", "Camera 2" (plus "(user photo)" for a user
  photosphere).
- These views are **re-aimed** at the asset with fov 60°. They are not planned views.

The browser then loads the image from the **Street View Static API**: 640×640 at that `pano_id`, `heading`, `pitch`
and `fov` (`EvidencePhoto.tsx` `staticUrl`). The caption shows "<view label> · <heading>°" and "Imagery © Google".
If Google returns an error, the photo shows "No Street View image for this view".

**The boxes** are drawn in an SVG over the image, in the same 640×640 coordinate space (`EvidenceViews.tsx` `Boxes`):

- **Default ("user") view:** only the object's own box (the *target*): orange, 4 px, faint orange fill, labelled
  **"This building"** / "This pole" / "This streetlight".
- **"How do we know? (all detections)"** (a toggle below the photo, `HowWeKnow.tsx`):
  - Every YOLO detection on that view is drawn. Colours by class: building pale blue-grey, pole white, lamp orange,
    sign teal. Each is labelled `<class> <confidence>`, e.g. `building 0.43`.
  - The target's label becomes `this building · building 0.43`.
  - The number is the detector's confidence, 0–1, from `detections.json` `conf`.
  - A **dashed** box has `geom_ok = false`: it was not used for positioning (tilted view or user photosphere).
  - Chips toggle each class on/off and show counts per class.
  - Facts explain the source:
    - *This photo*: "the pipeline's own view …" or "aimed at the object; boxes projected from … headings".
    - *Match*: degrees off centre, for assets.
    - *Panorama*: the pano id.
  - The toggle is remembered for the browser tab (`sessionStorage`) and applies to every evidence photo.
- **Label placement:** labels stay inside the photo and above the caption strip, and never overlap. Text widths are
  measured with the real font (`web/src/lib/labelLayout.ts` `placeLabels`, `web/src/lib/textWidth.ts`
  `measureText`).

**How a box is linked to the object** (`evidence.py`):

| Object | Rule |
|---|---|
| Building, "Front" view | The stored box (`attribute_view.x1..y2`, saved by the pipeline) is matched to the detection of class `building` with **IoU ≥ 0.5**. That detection is the target. No match: the stored box itself is drawn as the target and a note says so (`target: "record_box"`). |
| Building, "Sign" view | The signboard detection whose OCR text (from `ocr.json`) equals the building's recorded OCR text. |
| Fallback | A detection flagged `footprint_faced == <building id>`, highest confidence. |
| Asset | Boxes from the same panorama's planned views are **projected** into the aimed view (pinhole camera, same centre; `project_box`). The pole (or, for a streetlight, lamp head then pole) box whose centre is closest to the aimed direction, within 6° (pole) or 12° (lamp), is the target. If none: a **crosshair** marks where the camera was aimed, with the text "No box was found in the aimed direction: the cross marks where the camera was aimed, not a detection." |

When no detections are stored for a view, the saved box alone is drawn ("No detections are stored for this view; the
box is the one saved with the finding.").

**Clicking the image or a box does nothing.** The SVG has `pointer-events-none`; boxes are not interactive. The only
controls are:
- the **view tabs** ("Front" / "Sign" / "Camera N"), which switch the photo;
- the **"How do we know?"** toggle and its class chips;
- **"Live 360°"**. It sets `ui.dive`, which turns the shared map into Google's interactive panorama at the same
  pano and heading. *On the Review page this panorama is behind the page overlay and not visible* (see
  [limitations](#known-limitations--not-implemented)).

Error / empty: "No Street View evidence stored for this item." when the endpoint returns an error or no view.

### Right column: decision

| Element | Shows | Source |
|---|---|---|
| "Why a person should check" | the plain reasons (above), as a bullet list | `reviewReasons` |
| "What we saw", building | `<use> · <N floor(s)> · <register match>` + "(synthetic register)". Use via `useLabel` ("Use not known" if absent). Floors from `attributes.floors.value` ("floors not known" if absent). Match: "Matches the register" / "Differs from the register" / "Not in the register". | building record `attributes.use.value`, `attributes.floors.value`, `match_status` from `GET /areas/<slug>/buildings` |
| "What we saw", asset | "Pinpointed" (triangulated) or "Approximate position", then the asset-register status: "In the register" / "Differs from the register" / "Not in the register" / "Seen in one photo only: needs a second look". Plus "(synthetic register)". | asset record `method`, `register.status` from `GET /areas/<slug>/assets` |
| Status line | "Status: Waiting for review / Approved / Rejected / Appealed" + "· note: …" if a note is stored | review row `status`, `note` |
| Offline line | "Offline — read-only" above the buttons | store `offline` |
| Buttons | **Approve: the finding is right** (A) · **Reject: the finding is wrong** (R) · **Appeal with a note or photo** (E). Disabled while offline or saving. The pressed button shows a spinner and "Saving…". | — |
| Appeal box (after E or the Appeal button) | textarea "Why? (required)", "+ Photo (optional)" (jpeg/png/webp), **Send appeal** (disabled until a note is typed) | local state |
| **Show on the map** | switches to Explore and selects the object (opens its evidence drawer; the map flies to it) | `propsFor` + `ui.select` |
| Status area (live region) | "Saving…" / "Undoing…"; after a decision **"Approved ✓ <display name> · Undo [U]"**; after an undo **"Undone: <display name> is back to how it was."** (only while that item is on screen); errors | local state |

### Interactions

| Input | Effect |
|---|---|
| Click a list row | Shows that item (ignored while a save is in progress). Closes the appeal box. |
| **J** / **K** | Next / previous item in the list (clamped at the ends; no skipping). Ignored while saving and while typing in a text field. |
| **A** / Approve button | Decision `approve` on the current item. |
| **R** / Reject button | Decision `reject`. |
| **E** / Appeal button | Opens the appeal box (the button toggles it). The decision is sent by **Send appeal**. |
| **U** or **Ctrl/⌘+Z** / "Undo" link | Undoes the decision named in the toast. |
| "+ Photo" | Picks a file (accept `image/jpeg, image/png, image/webp`). Sent with the appeal. |
| "show the whole queue" | Leaves the Explore-sent filter. |

Keys are handled by a `keydown` listener on `window` in `Review.tsx`. They are ignored when focus is in a `textarea`
or `input`.

#### Approve / Reject / Appeal, end to end

1. **Lock.**
   - `decide(action)` returns at once if there is no item id (offline data has no ids), if offline, or if a save is
     running (`lock` ref). So each key press acts on exactly one item, and presses during a save are dropped.
   - An appeal without a note just opens the appeal box.
2. **UI.** The pressed button shows "Saving…"; all decision buttons are disabled; the status area says "Saving…".
3. **Request.** `PATCH /review/{id}` with `multipart/form-data` (`web/src/lib/review.ts` `saveDecision`):
   - `action`: `approve` | `reject` | `appeal`;
   - `note`: optional, required for appeal, ≤ 2000 characters;
   - `reviewer`: **required** since D29 (≤ 120 characters), asked once in the browser and sent with every decision;
   - `photo`: optional file, appeal only.
4. **Server** (`backend/app/review.py` `review_decide`):
   - Validates the action (anything else → 422, e.g. the old `reset`) and requires a note for an appeal (422).
   - If a photo is attached, uploads it first (see [Appeal photos](#appeal-photos)).
   - Runs `DECIDE_SQL`: **one SQL statement** that does four things:

     | Change | Table | Columns |
     |---|---|---|
     | The decision | `review_items` | `status` ← approved/rejected/appealed; `reviewer` ← `coalesce(new, old)`; `note` ← `coalesce(new, old)`; `appeal_photo_url` ← `coalesce(new path, old)`; `updated_at` ← `now()` |
     | One history row | `review_events` | `action`, new `status`, `previous_status`, `previous_reviewer`, `previous_note`, `previous_photo`, `reviewer`, `note`, `created_at` |
     | The object's status (used by the map and records) | `buildings` or `assets` | `review_status` ← the new status |
     | Cache version | read only | returns the area's new version for the cache |

   - `DbStore.patch_review` then updates the in-memory area bundle in place (no reload of all records).
   - Response: the review row plus **`event_id`** (the new `review_events.id`).
5. **Client after success.**
   - `patchReviewCaches` updates the cached `/review` list, the building/asset records and the GeoJSON feature's
     `review_status`, then invalidates only that object's detail query.
   - The waiting count, the list badge, the rail badge and the map update at once.
   - The page moves to the **next item still waiting** after the current one, skipping items decided in this session.
     It moves only after the save succeeded.
   - The toast shows "<Approved|Rejected|Appealed> ✓ <display name> · Undo".
6. **Errors.**
   - 503 (offline): "Offline — read-only. Nothing was saved."
   - Other errors: the server's message (e.g. "an appeal needs a note", a storage error).
   - The page does not advance.

Measured on 26 Sep 2026 (item 193, a Sathy Main Road building, `reviewer='test'`, restored afterwards):
- **Before:** `review_items` `(193, 'pending', reviewer NULL, note NULL, photo NULL, updated_at 2026-09-25 06:06)`;
  no events; `buildings.review_status = 'pending'`.
- **After approve:** `(193, 'approved', 'test', NULL, NULL, 2026-09-26 12:24:38)`; event
  `(71, 'approve', 'approved', previous 'pending', 'test')`; `buildings.review_status = 'approved'`.
- **Visible effects:** the waiting count went 258 → 257 and the map feature's `review_status` became `approved`.
- **Timing:** this PATCH took 3.3 s. Earlier timings on warm connections were 0.3–0.5 s (D23).

#### Undo

- **Request.** `POST /review/{item_id}/undo` with JSON body `{"item_id": <same id>, "event_id": <the decision>}`
  (`backend/app/review.py` `review_undo`, `web/src/lib/review.ts` `undoDecision`). The toast keeps both ids, so Undo
  always targets the item and decision it names.
- **Refused with 422:**
  - no `item_id`, or `item_id` in the body ≠ the path (Pydantic / explicit check);
  - `event_id` is not a decision on that item, or is itself an undo.
- **Refused with 409:**
  - the decision was already undone;
  - a **later** decision on the same item is still in effect. Undo steps back one decision at a time, newest first.
- **Effect** (`UNDO_SQL`, one statement):
  - `review_items` gets back exactly the `previous_status`, `previous_reviewer`, `previous_note` and `previous_photo`
    stored in that event. `updated_at` becomes `now()`.
  - A new `review_events` row is written: `action 'undo'`, `undoes = <event id>`.
  - `buildings/assets.review_status` is set to the restored status.
  - Nothing else is touched. The uploaded photo file, if any, stays in the bucket.
- **UI.**
  - Shows "Undoing…".
  - On success, moves to the undone item and shows "Undone: <name> is back to how it was." until another item is shown.
  - The waiting count goes back up.

The same measured run:
- **After undo:** `(193, 'pending', NULL, NULL, NULL, 2026-09-26 12:24:52)`; events 71 (approve) and
  `(72, 'undo', 'pending', previous 'approved', undoes 71)`; `buildings.review_status = 'pending'`; waiting count back
  to 258.
- **Refusals seen:** undo without `item_id` → 422; with a wrong `item_id` → 422; a second undo of event 71 → 409
  "this decision was already undone, or a later decision on this item must be undone first".

```mermaid
sequenceDiagram
  actor P as Person
  participant UI as Review.tsx
  participant API as FastAPI review.py
  participant DB as Postgres
  participant C as DbStore cache
  P->>UI: press A (item 193)
  UI->>UI: lock, "Saving…", buttons disabled
  UI->>API: PATCH /review/193 (action=approve)
  API->>DB: DECIDE_SQL (update review_items, insert review_events,<br/>update buildings.review_status, read version)
  DB-->>API: row + event_id 71
  API->>C: patch_review (in place)
  API-->>UI: review row + event_id
  UI->>UI: patch caches (list, records, map), advance to next waiting,<br/>toast "Approved ✓ … · Undo"
  P->>UI: press U
  UI->>API: POST /review/193/undo {item_id:193, event_id:71}
  API->>DB: UNDO_SQL (restore previous_*, insert undo event 72,<br/>update buildings.review_status)
  alt event not latest / already undone
    DB-->>API: no row
    API-->>UI: 409
  else ok
    DB-->>API: restored row
    API-->>UI: row (status pending)
    UI->>UI: back to item 193, "Undone: … is back to how it was."
  end
```

#### Appeal photos

```mermaid
sequenceDiagram
  actor P as Person
  participant UI as Review.tsx
  participant API as review_decide
  participant ST as storage.py
  participant BK as Supabase Storage (appeal-photos, private)
  participant DB as Postgres
  P->>UI: E, type note, "+ Photo", Send appeal
  UI->>API: PATCH /review/{id} multipart (action=appeal, note, photo)
  API->>ST: upload_photo(slug, id, bytes, content type)
  ST->>BK: POST /storage/v1/object/appeal-photos/<slug>/review-<id>-<10 hex>.<ext>
  BK-->>ST: 200
  API->>DB: DECIDE_SQL (appeal_photo_url = path, note, status appealed, event)
  API-->>UI: row + event_id
```

- **Upload** (`backend/app/storage.py` `upload_photo`):
  - Types: jpeg, png, webp. Max **8 MB** (`MAX_BYTES`). Violations → HTTP 502 with a plain message
    (`main.py` `_storage` handler).
  - Path: `<area slug>/review-<item id>-<10 random hex>.<ext>`. `x-upsert: false`, so it never overwrites.
  - Uses the Supabase **service-role key** on the server only. The browser never sees it.
- **Storage.** Only the **path** is stored, in `review_items.appeal_photo_url` (despite the column name) and in the
  event's `previous_photo` for undo.
- **Viewing.** `GET /review/{id}/photo` returns a **signed URL valid for 600 s** (`storage.signed_url`). The bucket is
  private: without a signed URL the file cannot be read.
  - **The UI never calls this endpoint.** There is no appeal-photo viewer (not implemented).
  - The API has no user authentication, so anyone who can reach the API can request a signed URL.
- **Order of operations.** The upload happens *before* the database update. If the database write then fails, the file
  stays in the bucket unreferenced.

#### Per-item history panel

**Not implemented in the UI.**
- The API provides `GET /review/{id}/events`, newest first. Fields: `id`, `action`, `status`, `previous_status`,
  `reviewer`, `note`, `undoes`, `created_at`.
- The table is append-only: trigger `review_events_no_change` in `backend/migrations/004_review_events.sql` refuses
  UPDATE and DELETE.
- It has no foreign keys, so history outlives items and areas.
- Test runs also write events there. They cannot be removed without dropping the trigger.

#### Offline mode on the Review page

- `GET /review` is served from `data/areas/<slug>/export.json` `review_queue`.
- Statuses are the export's (all "pending") and **ids are null**.
- The list still shows, and the photos and reasons work.
- Decisions are impossible: the buttons are disabled, keys do nothing (`decide` needs an id), and the header says
  "Offline — read-only".

### What a decision changes elsewhere — and what it does not

| Changes | Where |
|---|---|
| Rail "Review" badge (pending count) | `Rail.tsx` |
| Explore findings table "Review" column ("waiting" / approved / …) | `FindingsTable.tsx`, from the patched building/asset records |
| Explore map: dashed chalk outline on buildings **waiting** for review (layer toggle "Review") — a decided building loses it | `web/src/map/layers.ts` layer `bld-review` (`review_status === 'pending'`) |
| Explore "Waiting for review" list (KPI click) and the Explore evidence drawer's review section | `derive.ts` `matchBuilding` (`review.status === 'pending'`), `EvidenceDrawer.tsx` `ReviewActions` |
| `buildings.review_status` / `assets.review_status` columns and the GeoJSON `review_status` property | database, `GET /areas/<slug>/geojson` |

| Does **not** change |
|---|
| The finding itself: `match_status`, discrepancies, severity, attributes, positions, the dashboard/KPIs computed from them. Rejecting a "not in the register" finding does not make it matched. |
| The **"Waiting for review" KPI number** in Explore counts **pending** items only (`dashboard.kpi.waiting_for_review`, D29); `low_confidence_observations` stays the queue size. Ward 29: 218 waiting of 218 (1 Oct). |
| `export.json`, `run_report.json`, `data/model_card.json`, the Trust page, the pipeline's outputs or thresholds. Decisions are never fed back into the pipeline. |
| The review queue's membership or priorities. Reloading an area keeps decisions. |

---

## Under the Hood page

Component: `web/src/pages/Hood.tsx`. Route `#/hood` or `#/hood/<section id>`. Data: `GET /areas/{slug}/hood`
(`backend/app/hood.py`), which computes **every number from the area's records and its run files** (panos, plan,
plan_anomalies, _views_done, detections, ocr, building_views, vlm_unmapped, sign_links); each value carries its source
(`src`), and pytest recounts them from the raw files (D29). `GET /areas/{slug}/hood/examples?key=` gives up to 3 real
items per step, each with its reason, photo and a small plan (`GeoMini`, D39).

### What it is for
A verifier page (D16), in plain words only (D31: the Plain / Technical toggle was removed): what the pipeline did for one
area, step by step, what was kept and what was dropped, with real examples behind every number.

### Elements, top to bottom
1. **Header** "How <area> was analysed" and **area tabs** (every area; "Compare all N").
2. **Coverage & summary:** the map-coverage verdict ("full — 10% of photos face no mapped building") and **the run in N
   sentences**: the `story[]` sentences rebuilt from computed numbers. Corrections of the stored text are listed on
   Trust › Stored vs computed (D29, D31).
3. **Ten chapters**, each a counted-up figure, one sentence, a kept-vs-dropped bar and "see real examples":
   01 Streets planned · 02 Camera positions · 03 Photos fetched · 04 Objects detected · 05 Signs read · 06 Local or
   cloud AI · 07 Floors and use · 08 Positions · 09 Matched · 10 Findings. Ward 29: 733 panoramas (2 user photospheres
   excluded), 203 camera stops, 1,154 views (111 face no outline), 5,554 boxes (4,617 usable), 2,065 sign crops (807
   read locally, 180 escalated), 381 buildings, 268 poles and streetlights (20 triangulated), 218 items for review.
4. **Whole pipeline** (an SVG funnel / Sankey; Nivo is not used), **What got dropped** (skipped panoramas split by the
   planner's rules, D30; boxes rejected by the quality gate; names dropped by the gate), **Street by street** (table and
   plan), **Street names** (pick a display name per street, D47).
5. **Time and cost.** Originals: model-card GPU minutes and the photo cost from the run files (Ward 29: 1,154 views +
   266 building photos = 1,420 photos ≈ $9.94, D46), captioned "Photo cost is at Google's list price — Google's free
   monthly allowance may cover it" (P7 R3); their stage timings keep the "resumed run, not representative" badge (D1).
   Live areas: their own minutes, photo count, cloud-AI calls and cost (as measured), and the stage timeline (D34).

### Interactions
Scroll (figures count up; reduced motion shows the final values), a sticky section nav that follows the scroll, "see
real examples" (the example sheet: photos with boxes and plans), area tabs (switch the app's area), `#/hood/<id>`
(scrolls to that section). No writes. Offline mode serves the same numbers from the JSON files.

---

## Jobs page

Component: `web/src/pages/Jobs.tsx` (default export `Jobs`). Route `#/jobs`.

### What it is for

It lists what the app can show:
- the **pre-computed runs** (areas already in the database);
- the **analyses started from this app** (jobs created with "Analyse" on the map), with their status and whether an
  analysis worker is online.

It is read-only. Jobs are created and cancelled from Explore's Analyse panel.

### Elements, top to bottom

| Element | Shows | Source |
|---|---|---|
| Header | "Jobs", "Analyses" | — |
| Worker line | "Analysis worker: **online** / **offline**". When offline: "— new streets stay queued until the Colab worker is running". When the API is in offline mode: "Offline data mode: jobs need the database." | `GET /jobs` → `worker_online` (a worker id seen within the last **45 s** in memory (P6: plus `worker` = device and current job, D34): `jobs.py` `worker_online`, `Settings.worker_online_s`); `offline` |
| "Pre-computed runs" list | Per area: short name; "N building(s) · N pole(s) & lights · N dark stretch(es)", and "· few buildings on the map here" when coverage is partial. Buttons **Open on the map** (Explore) and **Under the hood**. | `GET /areas` → `views.area_card`: `counts.buildings`, `counts.assets`, `counts.streetlight_gaps_60m` (computed from records); `coverage.level` (from `meta.run.coverage.verdict`) |
| "Started from this app" list | Per job: street name (or "New street"); created time (Indian locale), stage and message; the status label in its colour; **Open** for done jobs. | `GET /jobs` (most recent first, up to 50) → table `jobs` joined to `areas` for `area_slug` |
| Empty state | "No analyses started from this app yet. Use Analyse on the map to pick a street." | — |

The list refreshes every 15 s (`refetchInterval`). On 26 Sep 2026 the table held two jobs, both "Sanganur Road",
both cancelled.

### Job lifecycle and statuses

Stored in `jobs.status`. The column only allows `queued`, `running`, `done`, `failed`, `expired_token` and
`no_street_view` (check constraint, `backend/migrations/001_init.sql`). Labels and colours come from
`web/src/lib/labels.ts` `jobStatus`.

| Shown as | Stored | Set by | Colour |
|---|---|---|---|
| **Queued** | `queued` | `POST /jobs` (`jobs.py` `job_create`), from the Analyse confirm sheet | accent (orange) |
| **Running** | `running` | `POST /worker/next`: the worker claims the oldest claimable job (sets `started_at`, `heartbeat_at`, `worker_id`) | accent |
| **Done** | `done` | `POST /worker/result`: files saved, run report built, area loaded (`area_id`, `finished_at`) | teal (matched) |
| **Failed** | `failed` | `POST /worker/fail` with an unknown code | red (no record) |
| **Cancelled** | `failed` **+** `message = 'cancelled by user'` | `POST /jobs/{id}/cancel` (allowed from queued, running, expired_token) | grey (neutral) |
| **No Street View** | `no_street_view` | `/worker/fail` with `NO_STREET_VIEW`, `NO_STREETS` or `NO_CAMERAS` | amber |
| **Paused: key expired** | `expired_token` | `/worker/fail` with `AWS_TOKEN_EXPIRED`; the job can be claimed again after the keys are refreshed | accent |
| *interrupted* | **no such status** | A `running` job whose heartbeat is older than **2 minutes** (`STALE_RUNNING`, P6) is shown as Interrupted and can be claimed again by `/worker/next`. | sodium glow |
| **Needs approval** | `needs_approval` | `/worker/fail` with `NEEDS_APPROVAL` (cost cap, before any photo is bought); Approve → queued with `approved = true`, or Cancel (D34) | accent |

```mermaid
stateDiagram-v2
  [*] --> queued: POST /jobs
  queued --> running: /worker/next
  expired_token --> running: /worker/next (keys refreshed)
  running --> running: /worker/next after 2 min without heartbeat (interrupted, D34)
  running --> done: /worker/result
  running --> no_street_view: /worker/fail NO_STREET_VIEW|NO_STREETS|NO_CAMERAS
  running --> expired_token: /worker/fail AWS_TOKEN_EXPIRED
  running --> failed: /worker/fail other
  queued --> failed: /jobs/{id}/cancel ("cancelled by user")
  running --> failed: /jobs/{id}/cancel
  expired_token --> failed: /jobs/{id}/cancel
```

Other job columns: `kind` (`street_click` | `polygon`), `input` (jsonb), `stage`, `done`, `total`, `message`,
`area_id`, `created_at`, `started_at`, `finished_at`, `heartbeat_at`, `worker_id`.

`input` holds the click or polygon, the resolved street, the OSM way ids, the job polygon (a 45 m buffer around the
street, possibly trimmed), the length and the output slug.

### With and without a worker (P6, D34–D40)

- The worker is built: `worker/colab_worker.py`, one Colab / Kaggle / laptop cell (`worker/README.md`,
  `worker/colab_setup_cells.md`). It claims a job (`/worker/next`), heartbeats every 15 s, reports progress per stage,
  then uploads the result (`/worker/result`, retried with back-off on a network blip, P7 R3) or fails with a code.
- **No worker:** a new street stays **Queued**. The job card and Jobs say "Queued. The analysis computer is not
  connected yet; it starts as soon as it is", and the top bar says "Analysis off". Nothing is lost.
- **Cost cap:** the worker plans the camera stops first; a street above the job's cap ($2 by default, P7.2) pauses as
  **Needs approval** before any photo is bought. Approve or Cancel on the job card or on Jobs.
- Statuses shown: queued, running (stage N of 10), needs approval, done, failed (Retry when retryable), no Street View,
  key expired (paused), cancelling, cancelled, interrupted (running with no heartbeat for 2 min; claimable again).
- The Jobs page: the analysis-computer line, Pre-computed runs, Started from this app (list and detail: estimate,
  stages, plan, Retry / Approve / Cancel, Delete this analysed area…, Remove from list, Clear test jobs…).

```mermaid
sequenceDiagram
  actor P as Person (Explore → Analyse)
  participant API as FastAPI jobs.py
  participant DB as jobs table
  participant W as Colab worker
  P->>API: POST /jobs/preview {lat, lon} (street + planner estimate)
  P->>API: POST /jobs {lat, lon[, lines], cost_cap_usd}
  API->>DB: insert (queued)
  W->>API: POST /worker/next (X-Worker-Token)
  API->>DB: queued → running
  W->>API: /worker/progress, /worker/heartbeat (every 15 s)
  W->>API: /worker/result (export.json + run files; retried)
  API->>DB: load area, running → done
  API-->>P: the map flies to the new area
```

### Offline mode

- `GET /jobs` returns an empty list when served from JSON (`job_list`: `if s.source == "json": return []`), and the page
  shows the offline sentence.
- Creating a job needs the database: `POST /jobs` → 503 "offline data mode — read only (jobs need the database)".

---

## Where data lives

| Data | Stored in | Written by | Read by |
|---|---|---|---|
| Buildings, assets, gaps, unmapped businesses (the findings) | `data/areas/<slug>/export.json` → tables `buildings`, `assets`, `streetlight_gaps`, `unmapped_businesses` (each row keeps the original record in `record` jsonb) | pipeline (Colab); `backend/load_area.py` / `loader.load_area` | `DbStore._load` → all pages; `JsonStore` offline |
| Review queue (membership, priority, reasons) | `export.json` `review_queue` → `review_items` (`item_type`, `ref_id`, `priority`, `reasons`, `discrepancies`, `ord`, geometry) | pipeline; loader | `GET /review` → Review page, rail badge, Explore |
| Review decision (current) | `review_items.status`, `reviewer`, `note`, `appeal_photo_url` (a path), `updated_at` | `PATCH /review/{id}`, `POST /review/{id}/undo` | `GET /review`, detail endpoints |
| Review status on objects | `buildings.review_status`, `assets.review_status`; GeoJSON `review_status` | the same SQL statements; loader (initial) | map layers, findings table |
| Review history | `review_events` (append-only) | same SQL statement as each decision / undo | `GET /review/{id}/events` → the History panel on Review |
| Appeal photos | Supabase Storage bucket `appeal-photos` (private), path `<slug>/review-<id>-<hex>.<ext>` | `storage.upload_photo` (service key) | `GET /review/{id}/photo`, `GET /review/{id}/events/{event_id}/photo` → signed URL, 600 s |
| Evidence boxes | `data/areas/<slug>/detections.json`, `ocr.json` (files only, not in the DB) | pipeline | `evidence.Detections` → `GET /areas/<slug>/evidence/...` |
| Street View pixels | Google (never stored) | — | browser, Static API |
| Pipeline counts for Under the Hood | `data/areas/<slug>/run_report.json` → `areas.run_report` jsonb | `tools/build_run_report.py` (also run by `/worker/result`); loader | `GET /areas/{slug}` → Hood page |
| Area list and counts | `areas` table + records | loader | `GET /areas` → Jobs page, area switcher |
| Jobs | `jobs` table | `POST /jobs`, `/jobs/{id}/cancel`, `/worker/*` | `GET /jobs`, `GET /jobs/{id}` |
| Worker online flag | API process memory (`app.state.workers`), lost on restart | `/worker/*` calls | `GET /jobs` |
| Accuracy / cost figures | `data/model_card.json` | project owner | Trust page, Analyse estimate (not these three pages) |
| UI preferences | `localStorage` (`gc.area`, `gc.mode`, …), `sessionStorage` ("How do we know?" toggle) | browser | browser |

## Spec vs code

| Topic | Spec says | Code does (1 Oct) |
|---|---|---|
| Review filters | CLAUDE.md §9.4: priority, reasons, filters | Status, priority, street and reason filters; every filter is strict (D30). |
| Review decisions API | `PATCH /review/{id}` | As specified, plus `event_id`, `POST /review/{id}/undo`, `GET /review/{id}/events` and the append-only `review_events` (D24). |
| `appeal_photo_url` | a URL | The storage **path**; links are signed on request (10 min). |
| Reviewer | `reviewer` column | Required on every decision; asked once in the browser and remembered (D29). |
| Under the Hood | story timeline, Sankey, sign funnel, Gantt, cost waterfall, route donut, verdict banner, per-street table, dropped list, compare runs | Coverage & summary with the story, ten chapters, whole-pipeline funnel, dropped list, street by street, street names, time and cost, compare runs (D29–D31). The original runs' timings are greyed with the "resumed run" badge (D1). |
| Jobs page | status, duration, cost, links | Status, stage, time so far / taken, estimate, cost, links to the area and to Under the Hood (P6). |
| Job statuses | six | Plus needs approval, and the display states cancelled / cancelling / interrupted (D34, D35). |
| Worker heartbeat | 30 s | 15 s; interrupted after 2 min. |
| Guided tour | §9.5: the example queries with fly-throughs | Seven plain steps from the ? button (P7.5). |

## Known limitations / not implemented

1. **No authentication.** The reviewer name is a label for the history, not an identity check.
2. **Undo goes back one step at a time, newest first** (409 for an older decision while a later one is live).
3. **An orphaned photo can stay in the bucket** if the database write fails after a successful upload.
4. **`review_events` holds test rows** from before the test area existed (append-only by design).
5. **Live 360° on Review** shows through the page (a see-through overlay; one map instance, D3).
6. **One street at a time** (409 while a real job is queued, running, paused or waiting for approval).
7. **The worker-online flag lives in the API's memory** and resets when the API restarts (the worker reconnects within
   15 s).
8. **The original areas' stage timings come from resumed runs** (D1) and are shown greyed.

## Open questions

1. **Supabase row-level security.** RLS is on for every table with no policies in the migrations; whether any were
   added in the dashboard is not visible from the repository.
2. **Bucket access rules** beyond "private" are not in the repository.
3. **Who made the decisions on items #94 and #97** before `review_events` existed (26 Sep). The one-time reset of
   27 Sep (D30) set every item back to waiting.
