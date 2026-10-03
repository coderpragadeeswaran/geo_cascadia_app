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

[← 05 Explain and defend](05_EXPLAIN_AND_DEFEND.md) · [Start here](00_START_HERE.md) · (this is the last file) →
