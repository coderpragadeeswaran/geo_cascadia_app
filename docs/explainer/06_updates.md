# GEO-CASCADIA explainer · 06 — Updates after 00–05

**What's in this file**
- The running log of every change made after explainer files 00–05 were written, newest at the bottom.
- Each entry has a date, its decision number (D…), and the same parts: what it does, why, how it works, the files changed, the key numbers, and the limits.
- Files 00–05 are not rewritten for these changes. When a line there became wrong, it was fixed and the fix is listed in the entry.

[← 05 Explain and defend](05_EXPLAIN_AND_DEFEND.md) · [Start here](00_START_HERE.md) · (this is the last file) →

**Standing rule (CLAUDE.md):** every future change is documented as a new dated entry here (what, why, how, files, numbers, limits).

---

## 3 Oct 2026 · D53 — Local map data for four cities (short entry)

- **What:** OpenStreetMap roads, building outlines and shop points, plus Microsoft's building outlines, for **Coimbatore, Trichy, Tiruppur and Madurai** are kept in the app's own database (PostGIS) and refreshed by hand once a month. Clicking a street, the small plans, the cost estimate and the analysis computer's "Reading the map" step read this copy. Elsewhere the app still asks OpenStreetMap's public servers, and keeps each answer 30 days.
- **Why:** "Reading the map" took 466 s for one 276 m street, and 441 s of that was downloading Microsoft's outline files. Street clicks waited 10–65 s on OpenStreetMap's busy public servers, or failed.
- **Speed:** "Reading the map" for that street: 466 s → about 1 s. Five demo street clicks from an empty cache: 42.9 / 64.5 / 16.3 / 5.0 / 2.9 s → 2.8 / 1.0 / 0.9 / 3.4 / 3.0 s.
- **Same results:** for all 8 analysed areas and 6 demo streets, the copy gives exactly the same roads, names, lengths, outlines and shop points as OpenStreetMap's live servers (checked one by one).
- **The 50 m question:** "Show not-in-register buildings within 50 m of a possible dark stretch". The database measures the distance on the ground. Ward 29: **15 of the 27** not-in-register buildings.
- **Limits:** a monthly snapshot (a road added on OpenStreetMap later is not seen until the next refresh); outside the four cities a street can't be picked while OpenStreetMap's servers are down; Microsoft has no outlines around Tiruppur.
- Full detail: DECISIONS D53, and [04 §13](04_BACKEND_DB_WORKER.md#13-costs-and-performance).

---

## 3 Oct 2026 · D54 + D55 — Lighting priority and the downloadable area report

### What it does
1. **Lighting priority.** Every possible dark stretch now gets **High, Medium or Low** priority and one plain sentence saying why, for example "376 m on a main road, 37 shops and businesses along it". The list of possible dark stretches opens in priority order ("Fix first"); "Longest first" gives the old order. The stretch's card, its hover card and the map show the priority: on the map, the edge of the dark band is brighter and wider for higher priority (Night), deeper indigo on paper (Daylight). You can ask "High priority dark stretches", or add a **Priority** chip to a dark-stretch question.
2. **Downloadable report.** A **Download report: PDF · Excel** button on the area's "What stands out" panel, and **Report for this street** on a street's panel.
   - The **PDF** is a summary for city officials: the area (or street), the date, where the data comes from and how old it is, the key numbers exactly as the app shows them, a map, the tables of findings, the possible dark stretches in priority order, the review queue, what the run cost, the Gate 1 statement as on the Trust page, and the limits.
   - The **Excel** workbook has the same tables, one sheet each (buildings with findings, poles and streetlights, possible dark stretches, review items), plus an "About" sheet with the numbers, sources and limits.

### Why
- All possible dark stretches looked equal. An official with a small budget needs to know where to look first: a long dark stretch on a busy main road with shops matters more than a short one on a quiet lane.
- Officials work with files they can print, forward and file. The app's screens can't be attached to a letter.

### How it works
**The priority is a fixed points rule (no model).** It was written down before the first result was seen and not changed afterwards to give a nicer order. Three things, each worth 0–3 points:

| Factor | 0 points | 1 point | 2 points | 3 points |
|---|---|---|---|---|
| Length (the recorded length the app shows) | — | under 120 m | 120–239 m | 240 m or more |
| Road type (OpenStreetMap, from the app's copy) | not known | residential street, service lane, other | connecting road (tertiary, unclassified) | main road (trunk, primary, secondary) |
| Shops and businesses within 30 m | none | 1–4 | 5–9 | 10 or more |

- Total 0–9 points: **High = 7–9, Medium = 5–6, Low = 0–4.** Equal points: the longer stretch first.
- **Road type:** the kind of road that runs under most of the stretch (within 15 m of it).
- **Shops and businesses:** analysed buildings whose use is a shop or business (or shop + home), plus OpenStreetMap shop, amenity and office points that are not inside one of those buildings, plus businesses read from shop signs that have no analysed building. A sign within 10 m of a counted OpenStreetMap point is taken as the same place, so it is not counted twice.
- The distances are measured on the ground by the database, to the stretch exactly as the map draws it (the same line as the 50 m question in D53).

**The report is built once, then drawn twice.** One step on the server collects every number and table from the same records and the same rules the app uses (the same key-number formulas, the same plain labels, the same priority, the same cost and photo-date figures as Under the Hood, the same Gate 1 wording and figures as Trust). The PDF and the Excel file are drawn from that one collection, so they always agree with each other and with the app.
- **The map in the PDF is drawn from our own data:** roads from the app's OpenStreetMap copy, building outlines coloured by finding (pink = not in the register, blue-green = differs, slate = matches), the possible dark stretches coloured by priority with their number in the list, a scale bar, north, and "© OpenStreetMap contributors". **No Google map or Street View photo is in the report** (Google's terms). Each row instead has a **"View in Google Maps"** link, a normal Google Maps address that opens the place.
- **The register is SYNTHETIC**, and the report says so in a banner on the first page, in the sources, in the table headings, in the limits and in the footer of every page.
- The report uses the app's own typeface; Tamil sign text is printed correctly.
- A **street report** contains only that street's buildings, poles, stretches and review items, and its key numbers are the same ones the app shows when that street is selected. Cost and Gate 1 are for the whole area's run, and the report says so.

### Files changed
- New: `backend/app/lighting.py` (the priority rule), `backend/app/report.py` (the report), `backend/app/report_fonts/` (the app's typeface for the PDF, with its licence), `tools/build_report_fonts.py`, `backend/tests/test_report.py`, `web/src/components/ReportButton.tsx`, `web/scripts/lighting-shots.ts`.
- Changed: `backend/app/main.py` (new addresses `/areas/{slug}/lighting`, `/areas/{slug}/report.pdf`, `/areas/{slug}/report.xlsx`; the priority on the map's stretches and in questions; the file name passed to the browser), `backend/app/views.py` (the priority in questions), `backend/app/queryparse.py` ("possible" no longer counts as an unknown word), `backend/requirements.txt`, `backend/tests/test_offline.py`; in the web app `GapList.tsx`, `EvidenceDrawer.tsx`, `Inspect.tsx`, `Key.tsx`, `Panel.tsx`, `QueryPanel.tsx`, `lib/labels.ts`, `lib/query.ts`, `map/layers.ts`, `design/tokens.ts`, `api/types.ts`, `scripts/test-ui.ts`.
- No change to the analysis pipeline or the Colab worker.

### Key numbers
**Ward 29: 3 High, 3 Medium, 5 Low.**

| # | Street | Length | Road type | Shops and businesses ≤ 30 m | Points (length + road + shops) | Priority |
|---|---|---|---|---|---|---|
| 1 | Sathy Main Road | 376 m | main road (trunk) | 37 | 3 + 3 + 3 = 9 | High |
| 2 | Sakthi Main Road | 142 m | main road (trunk) | 14 | 2 + 3 + 3 = 8 | High |
| 3 | Ganapathy - Avarampalayam Road | 193 m | main road (secondary) | 9 | 2 + 3 + 2 = 7 | High |
| 4 | 8th Street, Ganapathy | 313 m | residential street | 7 | 3 + 1 + 2 = 6 | Medium |
| 5 | Sathy Main Road | 67 m | main road (trunk) | 5 | 1 + 3 + 2 = 6 | Medium |
| 6 | Sri Ganapathy Gardens 3rd Street (approx.) | 254 m | residential street | 2 | 3 + 1 + 1 = 5 | Medium |
| 7 | 4th Street, Tatabad / Vinobaji Street | 211 m | residential street | 2 | 2 + 1 + 1 = 4 | Low |
| 8 | 2nd Street, Ganapathy Gardens (approx.) | 203 m | residential street | 2 | 2 + 1 + 1 = 4 | Low |
| 9 | 2nd Street, Gandhi Nagar | 99 m | residential street | 4 | 1 + 1 + 1 = 3 | Low |
| 10 | Korathottam Road | 83 m | residential street | 1 | 1 + 1 + 1 = 3 | Low |
| 11 | Korathottam Road | 78 m | residential street | 1 | 1 + 1 + 1 = 3 | Low |

- Other areas: Trichy 5 High and 3 Medium (all on one main road); Tiruppur 2 High, 1 Medium; Vadakku Masi Veethi 2 High; the Bharathiar Road area 1 Medium; the 4th Street and Kattabomman areas 1 Low each.
- **Report, Ward 29:** 27 pages (most of them the 218 review items), made in about 9 seconds; the Excel file in about 1 second. **Sathy Main Road:** 8 pages, key numbers 44 buildings checked, 2 not in the register, 10 differ, 2 possible dark stretches (1 High, 1 Medium), 10 use not known.
- **Every number matches the app.** A test checks it for Ward 29 and for Vadakku Masi Veethi (a small area analysed from the app), for the whole area and for one street: the key numbers, the table sizes, the priority order and reasons, the cost sentence, the photo dates and the Gate 1 figures, and it reads the PDF and Excel files back to confirm they contain the same values. In the browser, the key numbers on screen for Ward 29 and for Sathy Main Road were the same as in the PDFs.

### Limits
- **These are POSSIBLE dark stretches.** The lamp detector finds about 43% of lamp heads in a photo (model card, checked on 49 lamps), so a stretch may have lamps that were missed. The priority ranks candidates; it does not confirm a stretch is dark, and a photo can't tell whether a lamp works.
- **The shop count is incomplete.** It counts only buildings whose use is known (in Ward 29, 139 of 381 buildings have no known use), and OpenStreetMap "amenity" points include some places that are not businesses (the app's copy does not keep the point's type).
- **The levels are fixed points, not a ranking within an area.** An area along one main road can have only High and Medium stretches (Trichy).
- **The road type is OpenStreetMap's** label for the road, which can be out of date or wrong.
- **The priority needs the app's database.** In offline data mode the list shows "longest first" and says the priority is not available; the report says the same.
- **The report is a snapshot** of the data on the day it is made. The register in it is synthetic; the photos are from Jun 2018 to Feb 2026 (Ward 29: 40 of 203 camera positions are over 3 years old); Gate 1 is measured against OpenStreetMap's outlines, not a survey, so it is "not verified".
- Locations in the report are approximate map points, not survey points.

### Lines fixed in 00–05
- [03](03_APP_AND_FLOWS.md) §10 (the table of spec questions): the 60 m answer said "11 stretches, longest first". It now says they are shown in priority order, with "Longest first" giving the old order.
- [00](00_START_HERE.md) reading table and [05](05_EXPLAIN_AND_DEFEND.md)'s page links now point on to this file (navigation only).

---

## 3 Oct 2026 · D56 — Final polish and a regression pass before the demo

### What it does
1. **Fairer shop count for the lighting priority.** A building near a possible dark stretch now counts as "a shop or business along it" when its use is a shop or business (or shop + home) **or** a shop name was read clearly from its own sign. The points and the High / Medium / Low cut-offs are unchanged.
2. **Excel lists every pole and streetlight.** The report's Excel file now has all of them on the Assets sheet (Ward 29: 268), with the register finding in its own column, empty when there is none. The PDF still lists only those with a finding.
3. **"+ 9 seen only by camera".** Wherever the app shows how many buildings were checked, it now also says how many more the camera saw where the map has no building outline, for example **"381 buildings checked · + 9 seen only by camera"**. The main number stays the same, because those buildings can't be checked against the register.
4. **Memory re-measured** on the production build: well under the 60 MB target.
5. **A regression script** that checks the whole app in one go, to run before the demo.

### Why
- Use is not known for 139 of Ward 29's 381 buildings, so counting shops by use alone missed shops whose use the model couldn't read but whose sign it could.
- An official filing the Excel file wants the full asset list, not only the problems.
- "381 buildings" was true but incomplete: 9 more were seen and shown on the map's camera-only layer, and nowhere else said so.
- The project is frozen after this round; one command that re-checks everything lowers the risk on demo day.

### How it works
- **Shop count:** the same database query as before (D54), with one more condition: "or the building's sign name was read clearly". A shop point from OpenStreetMap that lies inside such a building is not counted twice.
- **Camera-only count:** read from the analysis's own list of camera-only buildings (the same list the map's orange diamonds come from). It is not added to the building count anywhere. When a street is selected the line is hidden, because these points are not tied to a street.
- **Regression script:** `tools/regression.py` runs six sections and writes a log:
  - **A** the four spec questions and seven extra ones (two in Tamil, "High priority dark stretches", the 50 m question, poles on a street, 100 m, "possible dark stretches") must give the expected filters and counts;
  - **B** one review decision and its Undo; afterwards every review item, building and pole must be exactly as before (only the item's "last changed" time and two history lines remain, by design);
  - **C** the Analyse flow up to the cost estimate, for a street inside the app's map data (Sakthi Main Road) and one outside it (a road in Erode); no analysis is created;
  - **D** PDF + Excel reports for every area and one street; every key number must equal the app's;
  - **E** every page of every area in both themes, with no console errors, plus the guided tour (`web/scripts/regression.ts`);
  - **F** the fallback cases: map servers blocked, the analysis computer offline, Google keys missing, the server stopping mid-session (the existing offline check, with the two helper servers it needs started and stopped by the script).

### Files changed
- New: `backend/app/camonly.py`, `tools/regression.py`, `web/scripts/regression.ts`.
- Changed: `backend/app/lighting.py` (the shop condition), `backend/app/report.py` (Excel assets, the camera-only note), `backend/app/views.py` and `backend/app/hood.py` (the camera-only count), `backend/app/main.py`, `backend/tests/test_report.py`; in the web app `KpiRibbon.tsx`, `Inspect.tsx`, `Tour.tsx`, `CommandPalette.tsx`, `pages/Hood.tsx`, `pages/Jobs.tsx`, `pages/Trust.tsx`, `lib/labels.ts`, `api/types.ts`, `scripts/audit.ts`.
- No change to the analysis pipeline or the Colab worker.

### Key numbers
**Ward 29 shop counts, before → after** (priority unchanged for every stretch; only the order of #2 and #3 swaps, because Ganapathy - Avarampalayam Road rose from 7 to 8 points and is longer than Sakthi Main Road):

| Street | Length | Shops before → after | Points before → after | Priority |
|---|---|---|---|---|
| Sathy Main Road | 376 m | 37 → 39 | 9 → 9 | High |
| Ganapathy - Avarampalayam Road | 193 m | 9 → 13 | 7 → 8 | High |
| Sakthi Main Road | 142 m | 14 → 14 | 8 → 8 | High |
| 8th Street, Ganapathy | 313 m | 7 → 7 | 6 → 6 | Medium |
| Sathy Main Road | 67 m | 5 → 6 | 6 → 6 | Medium |
| Sri Ganapathy Gardens 3rd Street (approx.) | 254 m | 2 → 3 | 5 → 5 | Medium |
| 4th Street, Tatabad / Vinobaji Street | 211 m | 2 → 3 | 4 → 4 | Low |
| 2nd Street, Ganapathy Gardens (approx.) | 203 m | 2 → 4 | 4 → 4 | Low |
| 2nd Street, Gandhi Nagar | 99 m | 4 → 9 | 3 → 4 | Low |
| Korathottam Road | 83 m | 1 → 2 | 3 → 3 | Low |
| Korathottam Road | 78 m | 1 → 1 | 3 → 3 | Low |

- **Seen only by camera:** Ward 29 9, Trichy 79, Tiruppur 12, Vadakku Masi Veethi 4, Sanganur Road 2; the three other app-analysed streets 0.
- **Memory** (production build, two runs): Ward 29 idle 25.4 / 25.6 MB; a building's evidence open 45.0 / 45.3 MB; after the whole tour 46.2 / 46.4 MB (target ≤ 60 MB).
- **Regression results:** one complete run on 3 Oct 2026, **all six sections passed** (log `docs/screenshots/regression/run-2026-10-03_1502.log`, 242 checks): A 11 of 11 questions right; B after a decision and its Undo, all 376 review items and 1,057 buildings and poles exactly as before; C Sakthi Main Road found in 0.3 s, estimate 416 photos, $2.94 (above the $2 cap, so it would wait for approval), and a road in Erode (outside the four cities) 97 photos, $0.68, no job created; D reports for all 8 areas and Sathy Main Road, every key number equal to the app; E every page of every area in both themes, no console errors, the 7-step tour; F all four fallback cases.
- **Fixes made during the pass:** (1) the regression's fallback section now removes any test job left behind if a check stops half way (found when the API server was stopped by a time limit during a first attempt, which left one test job queued; it was removed); (2) the audit script printed an empty Gate 1 status (the badge is in capitals); (3) the first memory measurement hit an older dev server still running on the app's port; it was stopped and the numbers re-measured on the production build.

### Limits
- A name board read clearly on a home also counts as a "shop sign"; the shop count can still miss shops with no readable sign and no known use.
- The camera-only buildings are not analysed (no use, floors or register check); their positions come only from where camera lines of sight cross.
- The regression script needs the server and the web app running, Google's map and OpenStreetMap's public servers reachable for the "outside" street, and takes about half an hour. Its expected answers are Ward 29's current numbers: if the data are reloaded or re-analysed, the expected values in the script must be updated by hand.
- The review round trip leaves two lines in the review history (the decision and its undo, reviewer "regression check"): the history is append-only by design.

### Lines fixed in 00–05
- None. The earlier D54 entry above keeps its original table; this entry gives the new counts.

---

## 4 Oct 2026 · D57 — Three UI fixes: dark stretches easy to see, a clicked stretch highlighted, one piece of a street

### What
1. **Possible dark stretches are easy to see in every state.** Each one is now drawn as a dark core line with a
   priority-coloured edge and a thin outline (dark at night, white by day). It sits on top of the selected street's highlight and
   its building dots. The priority colours are stronger (no pale Medium or Low). The map key, the High / Medium / Low pill in the
   list and the stretch's card all show the same small picture of a stretch, drawn exactly like the map.
2. **Clicking a stretch shows which one it is.** In the dark-stretch list, a card click keeps the list open, highlights
   that card, outlines that stretch in orange on the map, fades the others and zooms to it. Clicking the stretch on the map
   highlights its card. The same card again, Esc or × clears it.
3. **A street pick takes only the piece that was clicked.** When the same street name continues somewhere that does not
   connect (pieces count as connected when their ends are within 5 m), the Analyse box says "This street continues
   elsewhere (N m) — include it?" with a switch, off by default. Switched on, the length, the estimate and the job cover
   both pieces and the end dots are hidden (a stretch cannot run across the gap).

### Why
- On a selected street (8th Street, Ganapathy) the Medium stretch disappeared into the pale street highlight; at area zoom the
  street's building dots covered it. In Daylight the stretch's core was the same ink as the street highlight. A pale colour
  also reads wrong for a "dark" stretch, and the Medium pill looked empty at night (a dark core on a dark panel).
- With two stretches on one street (Sathy Main Road), clicking a card replaced the list with the stretch's card, and the
  orange "selected" outline sat underneath the wider High-priority edge, so nothing on the map showed which stretch it was.
- Clicking one part of Rathinapuri (Sanganoor) Main Road picked two separate pieces of that name (549 m), with Sanganoor
  Road in between, and the job analysed and paid for both without asking.

### How it works
- **Map** (`map/layers.ts`): three lines per stretch (outline, priority edge, core); widths per priority as before (High
  widest). At area zoom the stretches are drawn after the building dots; at street zoom they stay under poles and lamps. A
  selected stretch: orange outline outside everything, the other stretches faded.
- **Colours** (`design/tokens.ts`): Night `#3446b8 / #6b78ee / #a9b1ff`, Daylight `#8f99e3 / #5560cc / #2a2a8f` (Low →
  High), checked with the dataviz colour validator; the new `darkCasing` token is the outline. The PDF report's map uses
  the Daylight colours and a white outline too.
- **List** (`components/GapList.tsx`, `store/ui.ts`): while a dark-stretch list is open, picking a stretch keeps the list
  (`gapListOpen`), highlights the card and scrolls it into view; everywhere else a stretch still opens its own card.
- **Street pick** (`backend/app/streetpick.py` `split_pieces`, `with_elsewhere`): runs on the finished answer, so names,
  "already analysed" and every cache are unchanged; a street in one piece comes back exactly as before. `POST /jobs` and
  `POST /jobs/plan-estimate` take `include_elsewhere`. In the browser (`map/analyse.ts`, `components/AnalysePanel.tsx`,
  `map/MapView.tsx`, `map/TrimHandles.tsx`) the switch sets it; the other piece is a dashed line on the map until included.

### Files changed
- Backend: `app/streetpick.py`, `app/jobs.py`, `app/report.py`; tests `tests/test_ui_fixes.py` (new), `tests/test_d40.py`
  (updated: a street with gaps now keeps only the clicked piece unless included, an intended change).
- Web: `design/tokens.ts`, `map/layers.ts`, `map/MapView.tsx`, `map/TrimHandles.tsx`, `map/analyse.ts`, `store/ui.ts`,
  `components/GapList.tsx`, `components/Key.tsx`, `components/EvidenceDrawer.tsx`, `components/AnalysePanel.tsx`,
  `api/types.ts`; `scripts/test-ui.ts` (two tests), `scripts/ui-fixes-shots.ts` (new).
- No change to the analysis pipeline or the Colab worker. Finished jobs and areas are not changed.

### Key numbers
- **Sathy Main Road:** card 1 → gap60-001 (376 m, map zoom 17.3), card 2 → gap60-002 (67 m, zoom 18); a click on
  gap60-001 on the map → card 1 highlighted.
- **Rathinapuri (Sanganoor) Main Road,** clicked west of Sanganoor Road (the job's click): 327 m kept. The rest is 65 m
  when the answer comes from the analysed area's own lines (they stop at its outline), or 222 m from OpenStreetMap (327 +
  222 = the job's 549 m). With the switch on: both pieces, a new estimate (one live run: 141 → 191 photos, $1.00 → $1.35),
  no end dots. A click on the southern piece: 794 m connected + 230 m elsewhere.
- **Normal streets unchanged:** all six demo streets (Sakthi Main Road 1,221 m in 4 parts, Ganapathy - Avarampalayam Road
  1,039 m in 3 parts, Dr Alagesan Road 1,201 m, Pioneer Mills Cross Street 291 m, Sanganur Road 1,106 m, Unnamed road near
  5th Street 50 m) come back with exactly the same line, length and job area as their cached answers, and no switch.
- **Tests:** backend 443 passed, 1 skipped (incl. 7 new); typecheck, build, test:ui (18), check:data and the audit (both
  themes) pass. Regression (`tools/regression.py`, API + production preview): a first run failed A (the log was redirected
  to a file in the Windows code page, which cannot print "→") and two Night Explore checks of small areas that loaded slowly
  (the same areas passed in Daylight); the re-run with UTF-8 output passed **all six sections, 266 checks**
  (`docs/screenshots/regression/run-2026-10-04_1246.log`), now with 9 areas in D and E. No expected answer was changed:
  the script reads the area list live, so the new Rathinapuri area was included without edits.
- **Screenshots** (`docs/screenshots/ui-fixes/`, both themes): `a1/a2` 8th Street selected (area / street zoom), `a3/a4` every
  stretch and the key, `b0–b4` Sathy Main Road (list, each card clicked, map click, cleared), `c1/c2` Rathinapuri before and
  after the switch; `before/` holds the same views from before the fix.

### Limits
- Streets stored in pieces in an analysed area now offer the rest too: Ward 29's Sathy Main Road (cut at the ward edge into
  803 / 111 / 37 m) and Sakthi Main Road (142 / 13 m) show "continues elsewhere" when picked in Analyse.
- The "elsewhere" length depends on where the answer comes from: an analysed area's own lines stop at its outline (65 m
  for Rathinapuri), OpenStreetMap gives the whole name within the usual 1.5 km search (222 m).
- With both pieces included, a trim is not possible; switch it off to trim the clicked piece.
- The Low priority colour is below 3:1 contrast on the panel / paper; the core, the outline, the width and the word carry it.
- While checking, one old job with no area ("Unnamed road between Marutha Konar Street and Maniakarar Nagar", status failed;
  the app's rule lists only test jobs and jobs cancelled before any worker started them) was removed from the Jobs list by the app's own "clear test jobs" call, together
  with the two test jobs made for this check.

### Lines fixed in 00–05
- None.

---

[← 05 Explain and defend](05_EXPLAIN_AND_DEFEND.md) · [Start here](00_START_HERE.md) · (this is the last file) →
