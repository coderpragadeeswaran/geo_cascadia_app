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

## 8 Oct 2026 · D62 — The orange "this building" box is chosen by what the camera can actually see (M3), display only

### What
1. On each building's **Front** photo (or its **Best photo** when it has no Front photo), the orange box is now the
   building box that best covers the part of the building the camera can see, after nearer buildings on the map hide what
   is behind them. Until now it was the box whose centre line of sight happened to hit the building first.
2. When no building box covers enough of it (less than 40 % overlap), **no box is orange**, the other tags stay, and one
   line under the photo says: "Can't tell which box is this building in this photo." This shows in the Explore drawer and in
   Review.
3. Review: for an item whose only reason is "Seen from one camera position only" and whose photo is a can't-tell photo, the
   question becomes "We can't tell which box is this building in this photo. Look at the photo (or Live 360°): can you see
   this building?" (Yes / No keep their meaning). There is no such item in today's queues; the wording is tested.
4. "How do we know?" → "Which box" explains the choice, and says when the analysis used a different box (its results are
   unchanged).
5. Every area, including streets analysed later: the choice is computed by the API from the saved run files and the map's
   building outlines.

### Why
- The Part 2 experiment (80 labelled photos, development / test halves) found today's rule claims a wrong box on about a
  quarter of photos (test: 24.2 %). M3 cut that to 12.1 % on the held-out half. The owner checked the labels and chose to port
  M3 for display only (level 1).

### How it works
- `backend/app/boxchoice.py` is the experiment's M3, unchanged: one line of sight per 4 px image column (161 per photo),
  from 1.5 m to 60 m, into every building outline (outlines the camera stands in are skipped). The first outline each line
  meets is what that column sees. Score of a box = overlap (IoU) between its columns and the building's visible columns;
  the best box wins (ties: detector confidence); below 0.4: can't tell.
- The outlines are the ones the run used (the pipeline's own area loader around the run's cameras: the run-era cache, else
  the app's local OpenStreetMap / Microsoft copy, else OpenStreetMap). Results: `data/areas/<slug>/box_choice.json`
  (`tools\box_choice.py`; a new worker area in the background after delivery — until then its photos show the analysis'
  own box).
- The evidence API marks the chosen box (`box_choice`: same / changed / cant_tell; `analysis_box`). Sign photos, assets,
  business signs, the "Nearest camera" photo and Under the Hood's quality-gate examples are unchanged.
- **Unchanged:** positions and Gate 1, register matches, the review queue and its counts, reports / Excel / GIS, every
  number in the app, and which sign boxes are linked to a building.

### Files changed
- Backend: new `app/boxchoice.py`; `app/evidence.py` (reads box_choice.json, `apply_choice`), `app/jobs.py` (new areas).
  Tests: new `tests/test_m3_level1.py` (10); `tests/test_p5.py` and `tests/test_evidence.py` updated for the intended change
  (a can't-tell photo has no orange box; a changed photo's orange box is the M3 box).
- Tools: new `tools/box_choice.py`. Data: new `data/areas/<slug>/box_choice.json` (9 areas).
- Web: `components/EvidenceViews.tsx` (the line, "Which box"), `lib/reviewQuestions.ts`, `pages/Review.tsx`, `api/types.ts`,
  `api/queries.ts`; scripts `test-ui.ts` (1 new), new `m3-level1-shots.ts`.
- Docs: this entry, DECISIONS D62, README, manual checks 76–79. No change to the pipeline or the worker; no photo fetched.

### Key numbers
- **Experiment (test half, n = 33; one item = 3 points — a small sample):** M3 84.8 % correct, 12.1 % wrong box, 93.9 % get
  a box; today 75.8 % / 24.2 % / 100 %. Single-camera photos 38 → 15 % wrong, row / attached 36 → 21 %; small building in
  front of a big one 29 → 29 % (no gain).
- **Consistency:** the app's choice = the experiment's M3 output for 80 of 80 labelled photos.
- **Per area (building Front / Best photos):** Ward 29 338 photos — 42 changed box, 30 can't tell (of the 219 still served
  by Google: 30 / 25); Trichy 53 — 3 / 7; Sanganur Road 49 — 5 / 3; Vadakku Masi Veethi 47 — 9 / 2; Rathinapuri 42 — 4 / 3;
  3rd Street, Sridevi Nagar 24 — 9 / 0; Unnamed road between Bharathiar Road and Sankara Linganar Street 8 — 1 / 1;
  Kattabomman 7 — 0 / 1; Tiruppur 1 — 0 / 0.
- **Checks:** backend: full suite 503 passed, 2 failed, 1 skipped — the 2 were `test_evidence` asserting the stored box is always orange (intended change, updated; a first full run also failed `test_p5::test_no_guessed_building_box` the same way, updated, and the known-flaky `test_p6` delete test, which passed alone and in the rerun); after the updates the changed files pass (test_evidence, test_m3_level1, test_p5, test_p6). typecheck, build, test:ui 25 (1 new), check:data pass; the audit: first run 1 fail ("Esc closes the palette", Night — unrelated code), second run all passed. Regression (production preview): ALL PASSED, 291 checks, 0 retries (`run-2026-10-08_0710.log`); no expected answer changed. Live: the evidence API for the three cases and the Ward 29 key numbers (unchanged) against the running API.
- **Screenshots** (`docs/screenshots/m3-level1/`, Night and Daylight, 1366×768): `w27-warehouse`, `c28-compound-wall`,
  `n30-cant-tell` (drawer), `r30-review-cant-tell` (Review).

### Limits
- **The owner's two examples are not fixed by M3:** #27 (the small building in front still gets the warehouse box) and
  #28 (the compound wall still gets the box). M3 + linked signs fixed #27 on the test half but was not the development
  half's choice, so it is not ported.
- 12 % wrong boxes remain on the test half; can't tell removes the orange box from about 6 % of photos.
- The labels are one labeller's (Claude Code), spot-checked by the owner; 33 test items.
- **Level 2 not done:** positions and Gate 1 still use the analysis' box. The experiment's what-if (Ward 29: 260 → 247
  camera-derived positions, median 2.80 → 2.74 m, 60.4 → 64.0 % within 3.5 m) comes mostly from buildings leaving that set and
  uses the same map wall as the reference, so it is not a measured gain.
- A Front photo's use and floors were read by the analysis from its own box; when M3 marks a different box, the readings
  are not redone (display only).

### Lines that are now out of date in 00–06
- Descriptions of the orange box as "the box whose line of sight hits the building first" (explainer 04 evidence section,
  D31's H7 wording) now describe the analysis' choice, not what the app draws.

---

## 8 Oct 2026 · D63 — One AWS GPU server for the website, the API and the GPU worker (http://65.1.253.18/)

### What
1. **The plan:** one g4dn.xlarge (4 vCPU, 16 GB, NVIDIA T4) in ap-south-1 runs the website, the API and the analysis
   worker; the database stays on Supabase. The site is open to anyone with the link (port 80); SSH only from the owner's
   IP. **Live since 8 Oct 2026: http://65.1.253.18/**, instance `i-09e10c6bc76bb84dc`, Elastic IP `65.1.253.18`. It is
   **stopped** between uses; `tools\deploy\start.ps1` starts it (README, Deployment).
2. **Scripts** in `tools\deploy\` (laptop, PowerShell): `make_bundle.ps1`, `launch.ps1` (asks first; refuses a second
   instance), `deploy.ps1`, `start.ps1`, `stop.ps1`, `extend.ps1`, `refresh_keys.ps1`, `status.ps1`; AWS calls go through
   `aws_ops.py` in its own small venv (`C:\projects\gc-deploy\.venv`, boto3 only).
3. **Server files** in `tools\deploy\server\`: `setup.sh` (idempotent), `install_release.sh`, `put_env.sh`, nginx site,
   two systemd services (API, worker), the auto-stop (`gc-autostop` + a boot unit + a one-minute timer), and the worker's
   requirement lists.
4. **The worker as a service:** `worker/server_worker.py` runs the Colab cell's own code (`colab_worker.py` without its
   last line, the way the tests load it) with no questions, no Drive and no tunnel. The Colab cell keeps working as the
   fallback; its only change is one setting, `OCR_PYTHON` (None = as before).
5. **PDF reports on Linux:** the four symbols Anek Tamil lacks (≤ ≥ → ↑) come from DejaVu Sans when Arial isn't there
   (before: they would have been replaced by "<=", ">=" …).

### Why
- The owner wants the app reachable by anyone with a link, with the GPU worker always next to it, instead of the laptop +
  Colab + tunnel.
- Money safety first: the server must stop by itself, and every paid step must be asked for.

### How it works
- **Bundle** (`make_bundle.py`): only files git tracks (no `.env`, venvs, caches by accident) — backend without tests,
  `pipeline/geo_cascadia`, the two worker files, five server-side tools (`build_run_report`, `box_choice`,
  `fetch_osm_tags`, `check_photos`, `detect_photos`), the server files, the app data the API reads (`data/areas` incl.
  `photo_check.json` and `box_choice.json`, `model_card.json`, `billing.json`, the study area) — plus the production web
  build made with `VITE_API_URL=/api`, and three runtime caches as seeds (`streetview_meta.json`, `streetpick/`,
  `planest/`). It refuses any image file, any file over 40 MB, and uncommitted changes. Text files get LF. Sorted
  entries, fixed owner and times, gzip without a timestamp: the same commit gives the same bytes (checked: two builds,
  same sha256). The model files go in a separate `gc-assets.tar.gz` (the detector `best.pt`, `use_router.joblib`, the
  two floor-count example photos — the only images, because the floors prompt needs them).
- **Server layout:** `/opt/geo-cascadia/releases/<time>` (code; the last 3 kept), `current` → the newest,
  `/opt/geo-cascadia/data` (persistent; each release links `data` to it), `/opt/geo-cascadia/assets` (models). A deploy
  overwrites the bundle's data files and never deletes, so areas analysed on the server survive updates; caches are
  seeded only where missing.
- **Secrets on the server** (`/etc/geo-cascadia`, all 600): `app.env` (API: Supabase, Google keys, worker token; made
  by `deploy.ps1 -Env` from `backend\.env`, only the needed names, plus `CORS_ORIGINS`), `worker.env` (worker token +
  Google server key, derived from `app.env`), `aws_builder.env` (Builder role, worker user only, `refresh_keys.ps1`). The
  API runs as `gcapp`, the worker as `gcworker`; the API and the website never get AWS keys.
- **nginx:** the web build at `/`, the API at `/api/` (prefix stripped; uvicorn `--root-path /api`, checked locally:
  routes and `/docs` answer), the worker's endpoints are not reachable from outside (only the read-only
  `/api/worker/status`).
- **Worker service:** two venvs — `venv-worker` (torch, ultralytics, transformers 4.57.6, boto3 …; D37) and `venv-ocr`
  (Paddle + PaddleOCR) — so torch and Paddle never share CUDA libraries; the OCR process runs with `GC_OCR_PYTHON`.
  TensorFlow is uninstalled from both, `USE_TF=0`, `TRANSFORMERS_NO_TF=1` (D39). It reads the AWS key file before each
  job, and after "AWS token expired" it waits for the file to change, then continues the same job (as on Colab). Systemd
  restarts it after a crash; a job it was running is "interrupted" and resumes from its files.
- **Auto-stop:** the instance is launched with "shutdown = stop". `gc-autostop` keeps a stop time; every boot arms 90
  minutes, a timer checks every minute and powers off when it has passed; a stop time from before the current boot is
  never acted on (re-armed instead). The launch's user data installs it on first boot, from the same files `setup.sh`
  installs. `extend.ps1` adds 60 minutes.

### Phase 1: AWS read-only checks (8 Oct 2026)
- EC2 role: identity OK (account …6700, role FAI-TCE-Team22-EC2-Task5). g4dn.xlarge offered in ap-south-1a/b/c. Running
  G-instance vCPU quota **4** = exactly one g4dn.xlarge.
- Latest **Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04)**: `ami-04a61a72eafe2d8ab` (2 Oct 2026 build;
  root 75 GB by default, launched with 100 GB).
- **Dry run:** the role allows the full launch (100 GB gp3, shutdown = stop, IMDSv2, user data, tags on the instance)
  but **refuses tags at creation on anything except the instance** (volume, network interface, Elastic IP, key pair,
  security group: UnauthorizedOperation; untagged they pass). The role refuses t3.micro: the type is pinned. So the
  launch tags the instance at creation and tags the rest right after with CreateTags (reported if refused).
- RDS: not visible to this role (DescribeDBInstances: AccessDenied); not creatable from here. The AWS price API: refused.
- Builder role: one Amazon Nova Lite call (`apac.amazon.nova-lite-v1:0`, ap-south-1): answered, 7 + 3 tokens,
  $0.0000011, 1.1 s.

### Phases 2–4: launch, deploy, live test, Google keys (8 Oct 2026)
- **Launch** (owner's "go launch"): one g4dn.xlarge, AMI above, 100 GB gp3, shutdown = stop, IMDSv2; the user data armed
  the 90-minute auto-stop on first boot (checked: timer active, boot re-arm enabled, `gc-autostop show`). Tesla T4,
  driver 595.91.07, 15 GB GPU; 4 vCPU, 15 GB RAM; 48 GB of the disk free after setup's AMI (it uses 50 GB).
- **Tags:** only the instance carries `Project=fai-tce-team-22-geo-cascadia`. The role refuses CreateTags after creation
  too (UnauthorizedOperation) on the volume `vol-06dbd13680d798527`, network interface `eni-0ad9f79d099edce28`, security
  group `sg-09328e0a6344a1184`, Elastic IP `eipalloc-0924f956730fb1b42` and key pair `key-0316a3ecdb4bb304e`. Whoever
  manages the role would have to allow `ec2:CreateTags` on them.
- **Setup** (first run ~15 min, most of it Paddle's 2–3 GB download from its own index at ~11 MB/s): uv 0.12.23,
  Python 3.12.15; torch 2.14.1 (CUDA, sees the T4), transformers 4.57.6, scikit-learn 1.6.1 (pinned: the router was
  pickled with 1.6.1 and warns on 1.9.1; on 1.6.1 it loads cleanly), ultralytics 8.4.174; Paddle 3.3.1 (CUDA build, 1
  GPU), PaddleOCR 3.7.0 (PP-OCRv6 models); venv sizes: worker 6.0 GB, API 0.2 GB. A re-run of setup takes ~1 min.
- **Fixes found on the first launch** (committed): ssh's stderr ended the PowerShell scripts (PS 5.1 under
  `ErrorActionPreference = Stop`) → the remote helpers use `Continue` and the exit code; `sudo` works only once cloud-init
  has finished → launch waits for it; PowerShell's pipe put a UTF-8 BOM in front of the env files (the API still connected)
  → `put_env.sh` strips it; setup's OCR check ran as the worker user from a folder it can't read → it runs from the
  worker's home; Ultralytics' config folder → `YOLO_CONFIG_DIR` in the service.
- **Live checks** (the running server, through nginx): `/api/health` ok, database online, worker online (GPU); 9 areas;
  Ward 29 and Uthukuli Road (Tiruppur): area, Under the Hood, buildings, review queue all 200; PDF (Ward 29 19 pages, ≤ drawn
  from DejaVu, SYNTHETIC on every register page; Tiruppur 8 pages) and Excel (6 sheets) download in 10.3 s / 1.1 s and
  1.4 s / 0.3 s; `POST /api/worker/next` from outside → 404. Playwright, 1366×768, Night: Explore, Review, Under the Hood,
  Trust, Jobs for both areas load with 0 console errors (WebGL on); checked by eye: the 3D map with Ward 29's layers, a
  Street View evidence photo with its orange box in Review, Under the Hood. Screenshots: `docs/screenshots/deploy/`.
- **Worker:** OCR self-test on the T4 in full mode read "HOTEL" in 10.9 s; refresh_keys checked the Builder keys with one
  Nova call and restarted the idle worker.
- **Google keys:** before the browser key allowed the site, every page logged `RefererNotAllowedMapError` and Explore had
  no map. The owner added the website restriction `http://65.1.253.18/*`; after that the map and Street View photos load.
  The server key needed no change: a Street View metadata call from the server answered OK (no IP restriction).
- **Live analysis** (owner approved; "Unnamed road near 5th Street", Coimbatore, 50 m; estimate 21 photos $0.15, Nova
  $0.0013, 3 Places look-ups, 4 GPU min): job `6eeca41b…` ran 2 min 19 s (claimed 06:53:04, delivered 06:55:23 UTC) —
  panoramas 0.7 s, area 0.2 s (the app's OpenStreetMap snapshot), plan 0.1 s, detect 99.1 s, geometry 0.3 s, OCR 12.0 s
  (full, GPU), cloud AI 25.3 s, the rest < 1 s. Result: area `unnamed_road_near_5th_street_6eeca4` — 5 buildings, 3 poles,
  0 not in register, 0 differ, 0 dark stretches, 1 review item; **20 Street View photos ($0.14 at list price), 4 Nova calls
  ($0.0008), 1 Places look-up**; use router local. It appears in Explore, Under the Hood and Jobs. The worker deleted its 6
  photo crops after delivery; no Street View image is left on the server (the only image is the self-test's drawn word).
- **Stopped** with `stop.ps1` at the end (AWS: "stopped"). Running time today ≈ 60 min (05:56–06:31 and 06:42–07:04 UTC)
  ≈ $0.58.

### Key numbers
- **Prices** (AWS public price files, 7 Oct 2026 publication, ap-south-1): g4dn.xlarge Linux **$0.579/hour**; gp3
  **$0.0912 per GB-month** → 100 GB **$9.12/month**; public IPv4 (Elastic IP) **$0.005/hour** in use or idle →
  **$3.65/month**. Stopped: disk + IP only, **$12.77/month**. Running 3 h a day for 30 days: 90 × $0.579 = $52.11 +
  $12.77 = **$64.88/month**.
- **Bundle:** 3.5 MB (1,024 files, 21.7 MB unpacked): data 14.0 MB (298 files), cache seeds 4.2 MB (604), web 2.3 MB (24),
  backend 0.85 MB (54), pipeline 0.18 MB (24), worker 2, tools 5, server files 12. Model files: `best.pt` 21.5 MB.
- **Checks on main** (before these changes): backend 505 passed, 1 skipped; typecheck, build, test:ui 25, check:data and
  the audit (both themes) pass; regression (production preview) ALL PASSED, 291 checks, 0 retries (`run-2026-10-08_0802.log`). After the changes: 8 new tests (`test_d63_server_worker.py`) and the worker + report tests (106 passed, 1 skipped) pass.

### Limits
- `use_router.joblib` and the two floor-count example photos are **not on this laptop** (only on the Drive folder
  `MyDrive/alldataset`): copy them to `C:\projects\geo-cascadia-assets\models\` and `…\crops_building_v1\` before the
  first deploy. Without the router every building's use goes to the cloud model (costs more); without the photos the
  floors step can't run, so the worker refuses to start.
- Torch and Paddle are not pinned (only transformers and scikit-learn are): a fresh setup takes what pip resolves that day;
  the versions in use are in `/opt/geo-cascadia/freeze-*.txt`.
- Detection took 99 s for 20 photos on the first job after a boot (Ultralytics warned "NMS time limit exceeded"): the
  first job pays for model loading and CUDA warm-up. Not measured on a second job.
- The worker's start line still says "Drive is not mounted: an interrupted street starts again from the beginning" (the
  Colab cell's wording). On the server the job files stay on disk, so an interrupted street does continue.
- Only the instance is tagged (see above).
- Not checked live: the 2-minute "interrupted" resume after a worker crash, and "AWS token expired" mid-job (both are
  the Colab cell's tested code paths).
- The laptop API and the server API share one Supabase database. An area analysed on the server keeps its run files on
  the server (`/opt/geo-cascadia/data/areas`), not on the laptop.
- Plain HTTP (no domain, no certificate): the site is not encrypted.

### Lines that are now out of date in 00–06
- README's architecture sketch at the top and "Demo day" describe the laptop + Colab + tunnel set-up; it stays as the
  fallback. The new "Deployment" section describes the server.

---

[← 06 Updates](06_updates.md) · [Start here](00_START_HERE.md) · (this is the last file) →
