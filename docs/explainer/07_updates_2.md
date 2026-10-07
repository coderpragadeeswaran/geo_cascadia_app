# GEO-CASCADIA explainer · 07 — Updates, part 2

**What's in this file**
- The running log of changes from D59 on, newest at the bottom. It continues [06 Updates](06_updates.md), which is now closed (D53–D58).
- Each entry has a date, its decision number (D…), and the same parts: what it does, why, how it works, the files changed, the key numbers, and the limits.
- Files 00–06 are not rewritten for these changes. When a line there became wrong, the entry says so under "Lines that are now out of date".

[← 06 Updates](06_updates.md) · [Start here](00_START_HERE.md) · (this is the last file) →

**Standing rule (CLAUDE.md):** every future change is documented as a new dated entry here (what, why, how, files, numbers, limits).

---

## 7 Oct 2026 · D59 — UI polish 2: a usable street list, short photo tags, Review asks a question, honest OpenStreetMap wording

### What
1. **The whole-city projection is gone:** its Under the Hood section, the PDF/Excel part, the `GET /projection` endpoint,
   `backend/app/projection.py`, its test and its cache file. Page 6 of the PDF is now "How sure the counts are" (floor
   confidence and the OpenStreetMap cross-checks).
2. **The street list has room again.** A selected street's sentences take at most 22% of the panel, and "Drive this street"
   and the report share one row (the report is one "Street report" button that opens PDF · Excel · GeoJSON · Shapefile). At
   1366×768 the list shows 5 rows (it showed 1–2). Clicking a tab (e.g. "Buildings 44") opens the **full list** in a larger
   view beside the panel, with more columns (use, floors, review, ID). It scrolls, and × or Esc closes it. "Open the full
   list" under the list does the same.
3. **Photo boxes have short tags.** On the photo there are no long labels any more: a small letter per kind (B building,
   P pole, S sign, L streetlight), numbered when there are several (S1, S2 …). The orange box alone means "this building"
   (or pole …). Boxes that belong to this building get a light-orange tag. The confidence shows only on hover or tap. A
   **key under the photo** says "Orange = this building · B building · P pole · S sign · L streetlight" and lists the
   tagged boxes ("S2 = shop sign 'EXALT CUTS', part of this building · 35%"). Hovering a key entry highlights its box, and
   hovering a box highlights its entry.
4. **The photo is smaller:** 300 px wide in the Explore drawer and 400 px in Review (still square), so the photo, its key
   and the photo-date / Front / Sign / Live 360° row fit at 1366×768, and the next sections come into view as you scroll.
5. **Review asks a question.** Each item shows the question in plain words and Yes / No buttons (keys A / R as before).
   After a No on a question about a value (floors, use, a sign's name), a box asks for the right value (optional) and a
   note (optional). The value is saved with the decision. It never replaces the AI's value or the register: the drawer
   shows "Reviewer says: 3 floors", and so do the report, Excel and GIS files. After each answer, one line says what was
   saved ("Saved: reviewer says it has 3 floors, not 2."). Undo still restores everything, including the value.
6. **OpenStreetMap shops:** the 9 Ward 29 "matched" pairs are now "near each other (location only)" everywhere, and the
   app says the names didn't match. The counts are unchanged.
7. **OpenStreetMap floor levels:** the building card shows OpenStreetMap's floor count only on buildings that have the tag
   (Ward 29: 2 of 381). Under the Hood has one line: "OpenStreetMap has floor counts for 2 of 381 buildings — too few to
   compare." The Excel column is blank where there is no tag.
8. **Extra:** `pip install -r backend\requirements.txt` works again from the repo root (and from `backend\`).

### Why
- The projection was an estimate nobody needed for the demo, and it made the report longer.
- After the report and GIS buttons were added, the street list had shrunk to one or two visible rows.
- On busy photos, labels like "part of this building · sign 88%" covered the photo; with 17 boxes nothing could be seen.
- In Review the photo filled the screen, and people didn't know what "Approve: the finding is right" meant for a reason
  like "Floor count is an estimate".
- "Matched" overstated the OpenStreetMap comparison: none of the 9 Ward 29 pairs share a name, and 4 are 13–22 m apart.
- A floor cross-check that exists for 2 of 381 buildings said "OpenStreetMap has no floor count" on the other 379.
- `../pipeline` in requirements.txt has never installed: pip reads the path from the folder you run it in (repo root:
  invalid path), and `pipeline/` has no `pyproject.toml` (from `backend\`: "not installable"). The app imports
  `geo_cascadia` through `sys.path` (`backend/app/main.py`), so the line was never needed.

### How it works
- **Tags** (`web/src/lib/photoTags.ts`, pure): the shown boxes are the target, the linked boxes, plus every box when "How do
  we know? (everything the detector found)" is open. Each non-target box gets its kind's letter, numbered left to right
  when there are several of a kind. `EvidencePhoto` measures its width, so tags are drawn at 11 px on screen whatever the
  photo's size. The existing placement rule keeps tags from overlapping (now with a 15 px tag height). The key
  (`PhotoKey`) and the boxes share one highlighted box. The API adds each sign box's OCR text (`text`, from `ocr.json`
  by crop file) for the key. **How the "this building" box is chosen is unchanged.**
- **Questions** (`web/src/lib/reviewQuestions.ts`, pure): built from the item's reasons and its own record (register
  floors / use / pin distance / area, our floors / use / sign name). Yes = approve, No = reject, so stored statuses and
  every count built on them keep their meaning. When an item has a register question and a floor estimate, the register
  question is the one Yes / No answers; the floor check is shown as "Also, if you can tell" and its value can be
  corrected after a No. "Seen from one camera position only" is the question when it's the only reason, else a "look
  closely" hint.
- **Storage** (migration `009_review_corrected.sql`, additive and nullable): `review_items.corrected jsonb`;
  `review_events.corrected` / `previous_corrected`. The decision and its history row are written in the same statement as
  before; Undo restores `previous_corrected`. `PATCH /review/{id}` takes `corrected` (JSON: floors 0–60, one of the 7
  uses, or a name of 1–120 characters; anything else is refused with 422). A No may now carry its own note; a Yes may not.
  A photo is still for "send back" only. In the browser, the appeal box's text still never goes with Yes / No.
- **Report / Excel / GIS:** the Review column reads e.g. "Rejected — reviewer says: 3 floors" (`report.review_cell`).
- **OpenStreetMap wording:** `osmref`, `views`, `report`, `OsmPanels`, `QueryPanel`. The API keys stay `matched` /
  `matched_same_name`, so nothing that reads them breaks.
- **Requirements:** the `../pipeline` line is replaced by a comment saying why it isn't there.

### Files changed
- Backend: `app/review.py`, `app/store.py`, `app/report.py`, `app/evidence.py`, `app/osmref.py`, `app/views.py`,
  `app/main.py`, `migrations/009_review_corrected.sql` (new), `requirements.txt`; removed `app/projection.py`.
- Tests: `tests/test_ui_polish2.py` (new, 13), `tests/test_p5.py` (a No may carry a note — intended), `tests/test_extras.py`
  (projection test removed).
- Web: `lib/photoTags.ts`, `lib/reviewQuestions.ts`, `components/ReviewAsk.tsx` (new); `components/EvidenceViews.tsx`,
  `EvidencePhoto.tsx`, `EvidenceDrawer.tsx`, `ExampleSheet.tsx`, `Panel.tsx`, `FindingsTable.tsx`, `ReportButton.tsx`,
  `DrivePanel.tsx`, `OsmPanels.tsx`, `QueryPanel.tsx`, `pages/Review.tsx`, `pages/Hood.tsx`, `lib/review.ts`,
  `lib/labelLayout.ts`, `api/types.ts`, `api/queries.ts`; scripts `test-ui.ts` (4 new tests), `ui-polish2-shots.ts`
  (new), `extras-shots.ts`, `lighting-shots.ts`.
- Tools: `tools/regression.py` (section B and one question).
- No change to the analysis pipeline or the Colab worker. No paid calls, no new Street View photos.

### Key numbers
- **Street list (1366×768):** 5 rows visible on 2nd Street, Gandhi Nagar and on Sathy Main Road (list 385 px high).
- **Busy photo** (hitech gears, Sathy Main Road, `w1252503923`): 17 boxes, 11 of them signs linked to the building.
  Before: 12 long labels covered the shop fronts. After: tags S1–S12, B1, B2, L, P, and a key.
- **Review reasons in the data** (all 9 areas, 404 items; Ward 29 218): single-detection asset 290 (Ward 29 157),
  seen from one view 46 (29), high-severity discrepancy 39 (27), attribute discrepancy 28 (14), floor estimate 27 (4),
  name read by the AI only 1 (1). Each has a question (listed in DECISIONS D59).
- **OpenStreetMap, Ward 29:** 147 / 14 → 9 near each other (0 with the same name), 138 camera only, 5 OpenStreetMap only.
  Floor tags 2 of 381.
- **Requirements:** in a fresh Python 3.12 venv, `pip install -r backend\requirements.txt` → exit 0 from the repo root
  and from `backend\`; `app.main` and `geo_cascadia` import. Before: exit 1 from both.
- **Tests:** backend 469 passed, 1 skipped (13 new); typecheck, build, test:ui (22), check:data and the audit (both themes) pass. Regression: run 1 passed all six sections (291 checks); run 2 failed one check, "no console errors" on one area, because an outside server's connection dropped (every functional check passed); run 3 passed all six sections (291 checks). Logs in `docs/screenshots/regression/` (`run-2026-10-07_1754`, `_1812`, `_1833`). Expected answers: none changed; added the No-with-a-value round trip and "Businesses near an OpenStreetMap point" → 9.
- **Screenshots:** `docs/screenshots/ui-polish-2/` — `before-*` / `after-*`, Night and Daylight: `s1–s3` street list and full list, `p1–p3` busy photos, `r-*` one Review card per reason, `n1–n3` a No with 3 floors → saved line → drawer, `o1/o2` OpenStreetMap on Under the Hood and Trust; `report/` the Ward 29 PDF pages.

### Limits
- **About a third of the Ward 29 panoramas no longer load** (a free metadata check: 5 of 12 sampled return ZERO_RESULTS,
  "transport india pvt ltd" on 2nd Street, Gandhi Nagar among them). Google has replaced them since the run, so those
  photos show "No Street View image for this view". The tags and key still list the boxes; nothing was re-fetched (that
  would need new Street View photos).
- A corrected value is the reviewer's word, not checked. It is never counted as a measured value.
- On a photo with very many boxes, a tag that finds no free place is left off the photo (its box is still drawn and it's
  in the key). The key's list scrolls after three lines.
- The OCR text in the key is the raw reading (often a fragment, e.g. "cmmnatdunae"), not a confirmed name.

### Lines fixed in 00–05
- None. README: Review (how to answer), the projection paragraph removed, the street report button, the install line.

---

## 7 Oct 2026 · D60 — Photos Google no longer serves: a current photo instead, no failing requests, the real Street View bill

### What
1. **A photo Google no longer serves is replaced, plainly.** Google has retired about a third of the panoramas the Ward 29
   analysis used (their old ids now answer "no such panorama"). Those photos used to show "No Street View image", e.g.
   transport india pvt ltd on 2nd Street, Gandhi Nagar. Now the app shows Google's **current** photo from the same spot,
   aimed at the same thing (the building's front, the pole, the sign) with the same width of view, and says under it:
   "Current photo (Feb 2026) — Google no longer serves the photo used in the analysis, so its boxes can't be shown. Same
   capture month, taken from the same spot: Google now serves it under a new ID." The old boxes are **not** drawn on it, the
   photo key is hidden, the date badge shows the current photo's month, and Live 360° opens the current panorama.
   - It says "Newer photo (…)" only when Google's capture month really is later. Today it never is (see Key numbers).
   - With no current photo within 25 m: "No Street View photo available here any more", and no photo is requested. No
     stored photo is in that case today; the Live 360° button then asks Google's own panorama service (50 m) on click and
     says "No live 360° view here either" if it finds nothing.
   - Everywhere a stored photo appears: the Explore drawer (building, pole / light, business sign), Review, Under the
     Hood's "see real examples", Trust's sign spot-check, and Drive the street.
2. **No failing photo requests from a normal browse.** The app asks its own API first whether Google still serves a
   panorama (Google's free metadata service; the answer is kept 30 days) and never asks Google for a photo it knows is gone.
3. **Under the Hood, per area, one line:** "303 of 852 analysis photos are no longer served by Google; Google's current
   photos of the same spots are shown instead, without boxes (same capture month: Google re-issued them under new IDs).
   Checked 2026-10-07." Areas where every photo still loads say so.
4. **The real Street View bill.** "Routing and cost" keeps the list-price line ("Street View photos (Google): $9.94 — 1,420
   photos at Google's global list price.") and adds: "Billed under Google's India pricing: ₹0 so far — within the free
   monthly allowance (17,747 Street View photos billed at ₹0, Sep 7 – Oct 6 2026)." "Time and cost" says the same.
   Street View (Google) and the cloud model (Amazon Nova, AWS) are on separate lines everywhere costs are shown: both Hood
   sections (and a live run's), the PDF report, the Analyse estimate and the Jobs card. There is no combined total any more.
5. **Docs:** the change log continues in this file (07); 06 is back to how it was before D59, and CLAUDE.md's standing
   rule names 07.

### Why
- A third of Ward 29's evidence showed an empty black square, and the drawer looked broken.
- Google's metrics showed about 13,000 failed Street View requests (~30%). The browser asked for retired panoramas on
  every view, and every regression and screenshot run walked through dozens of them.
- "$9.94" read like money spent. Google bills this account under India pricing, and the owner's billing report shows ₹0
  so far for 17,747 photos.

### How it works
- **The check** (`backend/app/photos.py`): metadata by `pano` (free). OK → served. ZERO_RESULTS / NOT_FOUND → gone; then
  metadata by `location` = the original camera, `radius=25`, `source=outdoor` (free) → the current panorama, its position
  and month. Only those definite answers are kept, in `data/cache/streetview_meta.json`, for 30 days. A refused key, a quota
  answer or a network error counts as "not known", is never kept, and the stored photo is shown as before. Without a
  server key (tests) only the cache is read. Python's calls go over IPv4: on this laptop IPv6 routes to Google time out.
- **Aiming:** from the current panorama's position to the target: a building's front-wall centre (the middle of the same
  road-facing wall as its position, D33); a pole, light or business position; for a building's Sign photo the sign itself
  (the point on the stored sight line at the front wall's distance, so the camera stays on the sign). The stored pitch and
  field of view are kept. Where no target is known (Drive, the Hood step examples, Trust's spot-check) the stored heading is
  kept: the current camera is at most 5 m from the old one.
- **API:** every evidence view gets `served` (true / false / null) and, when gone, `current` (pano id, heading, pitch, fov,
  month, position, metres from the old camera). `GET /photos/{pano_id}` answers the same for any stored panorama (Drive, the
  Hood examples, Trust). `GET /areas/{slug}/hood` adds `photo_check` (the note) and `billing`.
- **Browser:** `EvidencePhoto` asks first (or takes the evidence API's answer) and only then requests a photo: the stored
  one, the current one, or none. The wording is one pure function (`web/src/lib/photoSwap.ts`, tested in test:ui).
- **One-off check** (`tools/check_photos.py`, metadata only): every evidence photo the app shows (the evidence API's own
  views, so exactly what a user sees), all areas → `data/areas/<slug>/photo_check.json` (committed; the Hood note) and the
  shared cache. 463 free metadata calls in all.
- **Billing line:** `data/billing.json` holds the owner's figures with their source (account-wide, not per area). The Hood
  and the PDF print its line under the list-price line.
- **Where the failing requests came from** (app, worker and scripts searched): (1) the browser's Street View Static
  requests for retired panoramas: drawer, Review, Hood examples, Trust spot-check, Drive and its prefetch. Google answers
  404 because the app asks with `return_error_code=true`; Chrome logs it as `ERR_BLOCKED_BY_ORB`. (2) Everything that
  drives the browser through those screens: the regression (section E: every area, both themes), the audit and the
  screenshot scripts. The worker and the pipeline only fetch photos of panoramas they have just found, and every metadata
  call (cost planner, worker search, setup check, the new check) answers HTTP 200 even for "no panorama". The
  `/design-preview` reference route (not linked in the app) still requests its sample panoramas directly; left as it is.

### Files changed
- Backend: new `app/photos.py`; changed `app/main.py` (evidence `served` / `current`, `GET /photos/{pano_id}`, Hood
  `photo_check` + `billing`), `app/report.py` (separate cost lines + the billing line). Tests: new
  `tests/test_photo_fallback.py`; `tests/test_report.py` expects the separate lines and no total (intended).
- Tools: new `tools/check_photos.py`.
- Web: new `lib/photoSwap.ts`, `scripts/photo-browse.ts`, `scripts/photo-fallback-shots.ts`; changed
  `components/EvidencePhoto.tsx`, `components/EvidenceViews.tsx`, `components/ExampleSheet.tsx`,
  `components/DrivePanel.tsx`, `components/AnalysePanel.tsx`, `pages/Hood.tsx`, `pages/Jobs.tsx`, `api/types.ts`,
  `api/queries.ts`, `api/p5.ts`, `scripts/test-ui.ts`.
- Data: new `data/billing.json`, `data/areas/<slug>/photo_check.json` (9 areas). Docs: this file (new; the D59 entry moved
  here from 06), 06 restored, CLAUDE.md, README, DECISIONS D60, P7_MANUAL_CHECKS 65–71. No change to the pipeline or the
  Colab worker; no new analysis.

### Key numbers
- **Availability, 7 Oct 2026** (a photo reference = one evidence photo of one object; one panorama can serve several):

  | Area | Photo refs | Still served | Gone | Gone, current photo nearby | Panoramas (gone) |
  |---|---|---|---|---|---|
  | Ward 29, Coimbatore | 852 | 549 | 303 | 303 | 201 (69) |
  | Bharathidasan Salai, Trichy | 223 | 221 | 2 | 2 | 91 (1) |
  | Sanganur Road | 130 | 130 | 0 | — | 17 (0) |
  | Vadakku Masi Veethi | 128 | 128 | 0 | — | 19 (0) |
  | Rathinapuri (Sanganoor) Main Road | 119 | 119 | 0 | — | 21 (0) |
  | 3rd Street, Sridevi Nagar | 46 | 46 | 0 | — | 9 (0) |
  | Uthukuli Road, Tiruppur | 36 | 36 | 0 | — | 23 (0) |
  | Unnamed road between Bharathiar Road and Sankara Linganar Street | 18 | 18 | 0 | — | 7 (0) |
  | Kattabomman Street Extention | 18 | 18 | 0 | — | 4 (0) |

- **Every replacement is the same imagery under a new id:** all 70 gone panoramas have a current one 0.0–5.0 m from the
  old camera with the **same capture month** (Ward 29: 67 Feb 2026, 2 Nov 2022; Trichy: May 2025). None is newer, so the
  app says "Current photo", never "Newer photo".
- Ward 29 objects affected: 77 of 221 building front photos, 105 of 268 poles / lights (at least one photo), 10 of 30
  business signs.
- **Failing photo requests, the same Ward 29 click path** (`web/scripts/photo-browse.ts`: 15 buildings with every photo, 8
  Sathy Main Road poles / lights, 3 businesses, 8 Review items): **before 17 of 33 failed (52%) → after 0 of 34 (0%)**. The
  path leans on 2nd Street, Gandhi Nagar, so it fails more often than the ward as a whole (36% of references gone).
- **Cost, Ward 29:** Street View photos $9.94 at list price (1,420 photos) · billed ₹0 (account-wide: 17,747 photos,
  7 Sep – 6 Oct 2026) · cloud AI (Amazon Nova Lite) $0.070.
- **Checks:** backend 484 passed, 1 skipped (incl. the 13 new D60 tests; `test_report` now expects the separate cost lines, intended; one earlier full run had 1 failure in `test_p6::test_delete_area_removes_it_everywhere` that passed alone, in its file and in a second full run); typecheck, build, test:ui 23 (1 new), check:data and the audit (both themes) pass. Regression (production preview, output to a file): the first run lost the internet mid-way (section E `ERR_INTERNET_DISCONNECTED`, F stopped at its first check because the API fell back to offline data; A–D passed, `run-2026-10-07_2018.log`); the re-run **ALL PASSED, 291 checks, 0 retries** (`run-2026-10-07_2132.log`). No expected answer changed. Live: the evidence API, `GET /photos/{id}`, the Hood note and billing line called against the running API.
- **Screenshots** (`docs/screenshots/photo-fallback/`, Night and Daylight, 1366×768): `before-…-t-w1236978849*` →
  `after-…-t-w1236978849*` (transport india, Front and Sign); `after-…-w-w1252503923` (hitech gears: still served, 17 boxes and
  the key unchanged); `after-…-a-asset-0001` (pole), `after-…-u-ub-0000` (business sign), `after-…-r-review-w1236978849`
  (Review), `after-…-d-drive-gone-stop` (Drive); `after-…-h1-photo-note`, `h2-routing-cost`, `h3-time-and-cost` (Hood).
  No stored photo lacks a current one, so the "no photo anywhere" case has no screenshot (tested in pytest and test:ui).

### Limits
- The current photo is aimed at the target from up to 5 m away; it is not the photo the analysis read, so a box, a floor
  count or a sign reading can't be checked on it. Hood examples, Trust's spot-check and Drive keep the stored heading.
- Google may retire more ids at any time. The cache is 30 days; until an id is checked again a newly retired photo shows
  "No Street View image for this view" once, as before. Re-run `tools\check_photos.py` monthly (README).
- "Gone" is Google's metadata answer by panorama id; it was not confirmed by requesting each photo (that would be billed).
  On the click path, all 13 panoramas whose photos failed before are ones the metadata calls gone, and afterwards no
  photo failed.
- The ₹0 line is the owner's billing report for the whole account, not this area's photos, and only up to 6 Oct 2026.
- The share of the ~13,000 failed requests that came from photos vs metadata can't be seen from here; Google's console
  splits them by response code and method.

### Lines that are now out of date in 00–06
- 00_START_HERE's table lists 00–06 only; this file (07) is the change log from D59 on.

---

## 7 Oct 2026 · D61 — Are re-issued photos the same photo? Checked with the detector: no. No boxes restored; the check runs by itself

### What
1. **The question.** D60 found 303 Ward 29 photo references (and 2 in Trichy) whose Google panorama IDs are retired, each with
   a replacement 0–5 m away from the same month, and called it "the same photo under a new ID". Before drawing the analysis'
   boxes on the replacements, this was tested with the real detector.
2. **The answer: no.** The replacements are neighbouring photos from the same drive, not the analysis photo. **No box is
   restored**; those photos keep showing Google's current photo without boxes, as since D60.
3. **The wording that said otherwise is corrected.** Under such a photo: "… Taken on the same drive, less than 1 m from the
   analysis camera: a neighbouring photo, not the one the analysis used." (was "taken from the same spot: Google now serves it
   under a new ID"). Under the Hood: "303 of 852 analysis photos are no longer served by Google; Google's current photos taken
   near the same spots are shown instead, without boxes (taken on the same drive, up to 5 m from the analysis cameras:
   neighbouring photos, not the ones the analysis used; re-running the detector, the saved boxes came back on 3 of 68 checked
   panoramas)." Drive's "Current photo" tooltip says the same.
4. **The monthly photo check now does this test by itself** (`tools\check_photos.py`) for every newly retired panorama, and
   lets the app draw the saved boxes (with the note "Same photo under a new Google ID") only where the test passes.
5. **Building drawer:** "1 building · 6 sign boxes in 4 photos linked to it (light-orange S tags on the photos; the same sign is
   often boxed in several photos, and some boxes aren't shop signs)". It used to say "6 shop signs linked to it … marked
   'part of this building' on the photos", which counted boxes as signs and described labels that no longer exist.
6. **`/design-preview` removed.** The old design reference page was linked from nowhere and still asked Google for retired
   panoramas.

### Why
- Drawing old boxes on a different photo would put "this building" on the wrong thing. The owner asked for proof first.
- "The same photo under a new ID" was an assumption (same month + a few metres); the test shows it is false.
- One sign seen from three cameras is three boxes, and a 20-photo check (D47) found 6 of 20 sign boxes aren't shop signs.

### How it works
- **The rule, fixed before any photo was fetched** (`backend/app/sameimage.py`): fetch the replacement at the stored heading,
  pitch and field of view; run the production detector (YOLOv8s, the owner's weights, on the laptop CPU) exactly as the
  pipeline does; match boxes per class one-to-one (Hungarian, by overlap). A photo is the same image when at least 2 saved
  boxes of confidence ≥ 0.5 exist, the matched boxes overlap with median IoU ≥ 0.80, ≥ 80 % of those confident boxes are found
  again (IoU ≥ 0.5) and nothing is shifted by more than 6 px. Go / no-go: restore only if ≥ 90 % of the retired photos pass and
  their overlap is within 0.05 of still-served control photos; otherwise nothing at all.
- **The study** (`tools\verify_same_image.py`): 40 retired references spread over 7 streets and 6 kinds (poles / lights,
  building fronts, signs, best photos, nearest cameras, business signs) and 10 still-served controls.
- **The monthly check** (`tools\check_photos.py` → `tools\detect_photos.py` in a separate CPU venv; photos only in memory): one
  spot-check photo per newly retired panorama (the view with the most confident saved boxes; up to 3 if it can't tell), then
  the per-area gate (≥ 90 % of judged panoramas pass). Verdicts and one row per retired photo reference (old → new ID, same
  image yes / no) are kept in `data/areas/<slug>/photo_check.json` and re-used while Google's replacement ID stays the same,
  so a re-run fetches nothing. Without the detector, new retirements stay "not checked" (no boxes).
- **App:** the API (`photos.same_images`) marks a replacement `same_image` only for a passed panorama in an area whose gate
  passed; the browser then shows it under the new ID at the stored view, with the boxes, tags and key (`photoSwap` state
  `same`). Today no photo is in that state.
- **Sign grouping, tried and dropped:** grouping boxes of one sign by where their sight lines meet the outline would put 26 %
  (Ward 29) / 13 % (Trichy) of box pairs from one photo — different signs by definition — within 1 m of each other; identical
  read text joins only 103 pairs. Not reliable, so the drawer says "sign boxes".

### Files changed
- Backend: new `app/sameimage.py`; `app/photos.py` (`same_images`, `gone_panoramas`, `check_area` references and counts, the
  Hood note), `app/main.py` (evidence and `/photos` pass the verdicts). Tests: new `tests/test_box_restore.py` (12).
- Tools: new `tools/detect_photos.py`, `tools/verify_same_image.py`; `tools/check_photos.py` (spot-check, gate, compact file).
- Web: `lib/photoSwap.ts` (state `same`, `showsBoxes`, `shownView`, corrected note), `components/EvidencePhoto.tsx`,
  `EvidenceViews.tsx`, `ExampleSheet.tsx`, `DrivePanel.tsx`, `EvidenceDrawer.tsx` (sign-box line), `api/types.ts`, `main.tsx`;
  removed `design/DesignPreview.tsx`, `NsDrive.tsx`, `NsShell.tsx`, `NsStory.tsx`, `NsParts.tsx`, `nsLayers.ts`,
  `design/data/ward29-sathy-drive.json`; scripts `test-ui.ts` (1 new test, 1 updated), new `box-restore-shots.ts`.
- Data: `data/areas/*/photo_check.json` (verdicts, gate, references). Docs: this entry, DECISIONS D61, README, manual checks
  72–75. `backend/.env` (git-ignored) gained `DETECTOR_PYTHON` / `DETECTOR_WEIGHTS`. No change to the pipeline, the worker, the
  analysis results or the database.

### Key numbers
- **Study (40 retired, 10 controls):**

  | | same / different / can't tell | boxes found again | median overlap (IoU) | typical sideways shift | the object's own box |
  |---|---|---|---|---|---|
  | retired → replacement | 0 / 34 / 6 | 120 of 233 | 0.49 | 20 px (up to 89) | median IoU 0.17 |
  | still served (control) | 8 / 1 / 1 | 63 of 63 | 1.00 | 0 px | 1.00 |

  Pass rate 0 % (needed 90 %) → **nothing restored.** The replacements were 0.4–4.9 m from the old cameras.
- **Every retired panorama (monthly check, 7 Oct):** Ward 29 69 → 65 different, 3 pass alone, 1 can't tell → gate 3 of 68
  (4 %): no restore. The 3 are 0.1 / 0.4 / 1.2 m away with overlap 0.83–0.88 — close neighbours, not identical (1.00). Trichy
  1 → different.
- **Cost:** 122 Street View photos (50 study + 72 spot-check) = $0.85 at Google's list price; Amazon Nova (AWS) $0. Metadata
  calls 0 (cache). A re-run of the check fetched 0 photos. The screenshot runs loaded about 20 more photos in the browser.
- **Checks:** backend 496 passed, 1 skipped (12 new in `test_box_restore.py`); typecheck, build, test:ui 24 (1 new; the D60 wording test updated, intended), check:data and the audit (both themes) pass. Regression (production preview, output to a file): ALL PASSED, 291 checks, 0 retries (`run-2026-10-07_2302.log`); no expected answer changed. Live: the evidence API, `GET /photos/{id}` and the Hood note called against the running API (no `same_image` anywhere, the new note).
- **Screenshots** (`docs/screenshots/box-restore/`, Night and Daylight, 1366×768, before = main's frontend + API):
  `t-w1236978849` (+ `-sign`) transport india, `x-w1236978077` (one of the 3 panoramas that pass alone: still no boxes),
  `w-w1252503923` hitech gears (the sign-box line), `h-photo-note` (Hood).

### Limits
- The test shows the saved boxes don't fit the replacements; it does not measure how far each replacement moved the view.
- The 3 panoramas that pass alone show the photo thresholds can admit a very close neighbouring frame; the area gate stops
  them. A stricter photo rule (e.g. overlap ≥ 0.95) would separate them more cleanly; not applied (tuning after the fact).
- The monthly check needs the detector venv and the weights on the laptop; without them new retirements stay without boxes.

### Lines that are now out of date in 00–06
- D60's wording "Same capture month, taken from the same spot: Google now serves it under a new ID" (quoted in this file's
  D60 entry and in DECISIONS D60) is wrong: they are neighbouring photos (D61).
- Anything naming `/design-preview` as the design reference route (DESIGN.md, D15): the page is gone; the tokens remain.

---

[← 06 Updates](06_updates.md) · [Start here](00_START_HERE.md) · (this is the last file) →
