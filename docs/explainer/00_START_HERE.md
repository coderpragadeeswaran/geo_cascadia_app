# GEO-CASCADIA explainer · 00 — Start here

**What's in this file**
- The one-page summary: the problem, what GEO-CASCADIA does, who it helps and the headline results.
- The improvements: the four key findings from writing this explainer, now fixed (P7a), and how to read files 00 → 05.
- The glossary of every term used in these files.

← (this is the first file) · [Start here](00_START_HERE.md) · [01 What and why →](01_WHAT_AND_WHY.md)

---

## How to read these files

**Reading order: 00 → 01 → 02 → 03 → 04 → 05.** Short on time? Read this file, then [05](05_EXPLAIN_AND_DEFEND.md) (demo script and FAQ).

| File | What it holds | Sections |
|---|---|---|
| [00_START_HERE](00_START_HERE.md) | summary, the improvements (the four key findings, fixed in P7a), glossary | [§1](#1-one-page-summary), [§16](#16-glossary) |
| [01_WHAT_AND_WHY](01_WHAT_AND_WHY.md) | context and Gate 1, architecture, tech stack, data sources, synthetic register | [§2](01_WHAT_AND_WHY.md#2-context-the-task-gate-1-and-the-organisers-guidance)–[§5](01_WHAT_AND_WHY.md#5-data-sources-in-detail) |
| [02_PIPELINE_AND_ACCURACY](02_PIPELINE_AND_ACCURACY.md) | pipeline step by step, methods compared, accuracy and honesty, known building errors | [§7](02_PIPELINE_AND_ACCURACY.md#7-the-pipeline-step-by-step), [§8](02_PIPELINE_AND_ACCURACY.md#8-methods-compared), [§9](02_PIPELINE_AND_ACCURACY.md#9-accuracy-and-honesty) (9.1–9.6, 9.9) |
| [03_APP_AND_FLOWS](03_APP_AND_FLOWS.md) | the app page by page, click flows, legend, review, sources and error owners, traced examples | [§10](03_APP_AND_FLOWS.md#10-the-app-page-by-page), [§9.7](03_APP_AND_FLOWS.md#97-where-every-ui-item-comes-from-and-who-owns-an-error), [§9.8](03_APP_AND_FLOWS.md#98-traced-examples-real-ids) |
| [04_BACKEND_DB_WORKER](04_BACKEND_DB_WORKER.md) | the technical file: server requests, database, analyse-a-street end to end, worker and Colab, costs | [§11](04_BACKEND_DB_WORKER.md#11-backend), [§6](04_BACKEND_DB_WORKER.md#6-the-database), [§12](04_BACKEND_DB_WORKER.md#12-live-analysis-and-the-worker), [§13](04_BACKEND_DB_WORKER.md#13-costs-and-performance) |
| [05_EXPLAIN_AND_DEFEND](05_EXPLAIN_AND_DEFEND.md) | demo script, FAQ, limitations, to-do, decisions D1–D45, conflicts, open questions | [§14](05_EXPLAIN_AND_DEFEND.md#14-demo-script-for-judges), [§17](05_EXPLAIN_AND_DEFEND.md#17-faq), [§15](05_EXPLAIN_AND_DEFEND.md#15-limitations-and-known-issues), [§18](05_EXPLAIN_AND_DEFEND.md#18-still-to-do-p7), Appendices A–C |

Section numbers ([§1](#1-one-page-summary)…[§18](05_EXPLAIN_AND_DEFEND.md#18-still-to-do-p7)) are kept from the original single document, so every "[§7.11](02_PIPELINE_AND_ACCURACY.md#711-asset-positions-and-pole-merging)" style reference is a stable link.

**Plain words.** Files 00, 01, 02, 03 and 05 describe what happens in plain words. The technical names (server requests, files, database tables, code) are only in [04](04_BACKEND_DB_WORKER.md).

**Audience tags.** Every app screen is labelled with its audience:
- **For users**: Explore, Review, Jobs / Analyse. You look, click, play and learn.
- **For anyone digging deeper**: Under the Hood, Trust. These pages explain how a result was made and how far to trust it.

**Source → owner.** Throughout, each item says where it comes from and who owns a mistake in it: detector and other models (MODEL) · our rules and code (OUR RULES) · OpenStreetMap (OSM) · Google (GOOGLE) · the made-up register (SYNTHETIC).

**Conventions.**
- IDs such as w1252504945 are OpenStreetMap IDs of building outlines; the app shows them in the details panel. asset-0160 is a pole. gap60-001 is a dark stretch.
- Every count was re-computed from the saved results of each analysed area. Every accuracy figure is quoted from the model card (the project's single record of measured accuracy). Owner facts are recorded as decision D41.
- No Street View photo is copied into these files (Google terms). Photos are described in words.
- No keys, tokens, passwords or database addresses appear here.

---

## 1. One-page summary

### The problem (FarmwiseAI Task 5)
- A city keeps registers of properties (use, floors, area, location) and street assets (poles, streetlights).
- These registers go out of date. Someone adds a floor, a house becomes a shop, a streetlight disappears.
- Checking every street on foot is slow and expensive.
- The task: use **Google Street View** to find buildings, poles, streetlights and shop signs, place them on a map, compare them with a register, and show **what is missing, changed or wrong**, with photo evidence and a way for a person to check.

### What GEO-CASCADIA does, in one breath
- A city official opens a map. **Ward 29, Coimbatore** is already analysed.
- The app shows, on a dark "city at night" map:
  - which buildings are **not in the register** (pink points and outlines);
  - which **differ from it** (glacier-blue);
  - which stretches of road have **no visible streetlight** (black bands on the glowing orange roads);
  - which shops have **no building on the map** (hollow rings).
- Click anything and you get the **Street View photo** with the object boxed, what the models saw, what the (made-up) register says, and why a person should check it.
- A reviewer works through a **review queue** with keyboard shortcuts (approve / reject / appeal / undo).
- Click **any other street in India** and a **GPU worker on Google Colab** runs the same analysis live. The new street appears like the originals, usually within minutes.
- Two pages exist only for people who want to check the method: **Under the Hood** (what happened, step by step, with real examples) and **Trust** (every measured accuracy number, with its sample size, plus what was tried and dropped).

### Who it helps
- **City officials:** a short list of places worth a visit, with evidence.
- **Reviewers:** a prioritised queue, 27 urgent items first in Ward 29.
- **Judges and teammates:** every number can be traced to its source, and every weak spot is labelled.

### Headline results (Ward 29, counted from the area's saved results unless marked)

| What | Number | Where it comes from |
|---|---|---|
| Streets analysed | 10 streets, 4,829 m of road | the street list of the run |
| Street View panoramas found / camera stops used / photos planned | 733 / 203 / 1,154 | the panorama search and the photo plan |
| Objects the detector boxed | 5,554 (2,411 buildings, 2,065 signs, 958 poles, 120 lamp heads) | the detector's results |
| Buildings analysed (registered OSM outlines) | 381 | the area's results |
| Buildings not in the register / differ from it / match | 27 / 50 / 304 | the area's results (the register is synthetic: it copies the observations except planted mistakes) |
| Building use known / not known | 242 / 139 | the area's results |
| Poles / streetlights located | 230 / 38 (20 pinpointed from 2+ cameras, 248 approximate) | the area's results |
| Dark stretches (no streetlight seen within 60 m) | 11 stretches, 2,019 m recorded length | the area's results |
| Shop names read clearly / also on Google Maps | 96 / 25 | the area's results |
| Businesses with no analysed building (no outline, or an outline outside the 381) | 26 | the area's results |
| Items for a person to review | 218 (27 urgent, priority 1) | the area's results |
| Register test: planted mistakes caught / records paired with their own building | 68 of 78 / 349 of 354 (98.6%) | computed (Trust › Register tests) |
| Single-camera poles and streetlights: circle within 8 m of the camera / farther | 132 at ±2.4 m / 116 at ±5 m | the area's results (D45) |
| Building position vs OSM front-wall centre (Gate 1, the fair number) | median **2.8 m**, **60.4%** within 3.5 m, n=260 | model card, Gate 1 position |
| **Fresh full Ward 29 run** (owner, Colab T4, 28 Sep 2026, router on) | **11.5 min · 1,420 Street View images (≈ $9.94) · cloud AI $0.0887** | owner (D41); 11.5 min also in the model card's cost and time section |
| Cloud-AI cost with / without the local router, like for like | **$0.070 (589 calls) / $0.089 (782 calls)** | recounted from the run's saved calls (P8, D50); the model card's "$0.056 / 339 calls" left out 250 name and business-sign checks ([§9.5](02_PIPELINE_AND_ACCURACY.md#95-the-fresh-full-ward-29-colab-run-vs-the-apps-numbers)) |
| Street View photos of Ward 29 taken | Jun 2018 – Feb 2026; 40 of 203 camera positions older than 3 years | the stored panorama dates (P8) |
| Street View cost | $0.007 per photo | model card, cost and time |

**The honest one-liners you should be ready to say:**
- "The register is **synthetic**. It copies what the photos show, except 78 planted mistakes in Ward 29, and it is paired with the buildings by location only. So 'not in register' and 'differs' test the comparison logic end to end; they don't say the city's records are wrong."
- "Gate 1 (≤ 3.5 m) is **not verified**. There is no surveyed reference. Against the OSM front-wall centre our camera-derived positions have a median of 2.8 m and 60% are within 3.5 m."
- "Use is unknown for 139 of 381 buildings. We show that number on the map instead of hiding it."
- And the improvements below: the four problems found while writing this explainer are fixed (P7a, D42–D45).

### Improvements: the four key findings, fixed in P7a
These four problems came out of writing this explainer. They are fixed in the shared pipeline code, so every live run
from the Colab worker has the fixes. They were re-applied to all six areas from saved results only, with no model or
Street View calls (D42–D45, 1 Oct 2026). What changed and why, one line each:

1. **The synthetic register now means something (D42).** Before, it invented a random use and guessed floors, so most
   "differs" flags were noise (Ward 29: 46 of 50 use and 30 of 36 floor flags were not planted). Now each record copies what
   was observed, except the planted mistakes. A use or floor count that is not known is left empty, so it is "not
   compared". Ward 29: differs 117 → 50, and every remaining difference is a planted mistake or comes from a moved pin
   paired with a neighbour. Trust › Register tests shows caught / missed / false alarms: all areas, 94 of 108 planted
   mistakes caught, 14 false alarms ([§5.6](01_WHAT_AND_WHY.md#56-the-synthetic-register-synthetic)).
2. **Register records are paired with buildings by location (D43).** Before, records carried the building's OSM ID (a
   lookup a real register can't do). Now each record's pin is paired with the nearest building, one-to-one, with a match
   confidence. With the IDs hidden: 530 of 538 records (98.5%) find their own building; every record whose pin was not
   moved does; 18 of 26 moved pins do. A real register (a spreadsheet or map file) can be loaded with the register import
   tool, which reports every row it skipped and why.
3. **Signs are linked by their own line of sight, when it is clear (D44).** Before, a sign belonged to the building its
   photo was aimed at, so a neighbour's sign could name the wrong building. The first fix moved every sign to the first
   outline its own line of sight hit: 966 of 2,065 Ward 29 sign crops (47%). Checked against Google's map pins for the same
   business names, those moves did not help: in Ward 29, 19 put the sign further from Google's pin and 15 closer. So a sign
   now moves only when its line of sight, and the lines 4° either side, all hit the same other outline and none touches the
   aimed one. Ward 29: 570 crops move (28%); against Google, 14 closer and 6 further (all areas: 40 closer, 20 further,
   median 6.8 m closer). Names read clearly 105 → 96. Google's pins are not surveyed, so this is an agreement check
   ([§9.3](02_PIPELINE_AND_ACCURACY.md#93-what-is-not-verified)).
4. **Single-camera pole circles grow with distance (D45).** Before, every one-camera pole got ±3.5 m. Now each distance
   band uses the larger of two measurements. The first is our own check: for poles two cameras pinpointed, each camera's own
   estimate vs the pinpointed spot (63 estimates, "8 in 10 within"). The second is the earlier surveyed check (typical error
   1.64 m within 8 m, 4.55 m at 8–15 m). Result: ±2.4 m within 8 m of the camera, ±5 m beyond. Beyond 8 m the ±5 m comes
   from a typical (median) error, so only about half of those poles fall inside the circle; Trust says so.

---

## 16. Glossary

| Term | Meaning here |
|---|---|
| Area | one analysed region (Ward 29, Trichy, …) |
| Panorama | one 360° Street View sphere |
| User photosphere | a panorama uploaded by the public; used for photos, never for positions |
| Camera stop | a panorama chosen by the planner |
| View / planned photo | one 640×640 photo at a heading, pitch and field of view |
| Detection / box | a YOLO rectangle with a class and a confidence (0–1) |
| Usable for positions | the box came from a level Google-car photo, so it can place things |
| Outline / footprint | a building polygon from OSM (or Microsoft) |
| Registered building | an outline at least one planned photo faced; one of the 381 |
| Ray / line of sight | the line from the camera in the direction of a point in the photo |
| Triangulation | where rays from two or more cameras cross |
| Rough distance | distance from where a pole's base meets the ground in the photo (≤ 15 m) |
| Approximate | positioned from one camera only; its circle is ±2.4 m within 8 m of the camera, ±5 m beyond (D45) |
| Quality check / gate | the rule that rejects slivers and cut-off building boxes |
| OCR | reading text from sign crops (PaddleOCR) |
| Tier 0/1/2/3 | watermark / no name / read / unsure → cloud model |
| VLM / cloud AI | Amazon Nova Lite, a vision-language model |
| Local router | CLIP + logistic regression deciding use on the machine |
| Name gate | a cloud name is kept only if ≥ 70% of its letters appear in the OCR text |
| Route | which model decided a value: the local model, the cloud model, a shop sign, OCR, or the cloud model checked against OCR |
| Synthetic register | made-up property records that copy what the photos show except planted mistakes (D42); the asset register is synthetic too |
| Planted-mistake recovery | caught / missed / false alarms per kind of planted mistake (Trust › Register tests) |
| Paired by location | a register record is matched with the nearest building, one-to-one, never by a shared ID (D43) |
| Match confidence | high / medium / low: how clearly a record's pin points at one building |
| Sign's own line of sight | the ray from the camera through a sign box; the sign moves to another outline only when that ray, and the rays 4° either side, clearly hit it and miss the aimed one (D44) |
| Business with no analysed building | a read shop sign on no outline, or on an outline that is not one of the analysed buildings |
| Planted mistake | a deliberate error in the synthetic register, used to score matching |
| Match status | matched / differs / not in register |
| Kinds of difference | location shift, area understated, use change, extra floor, missing record; for assets type mismatch |
| Dark stretch | ≥ 60 m with no streetlight seen within 30 m of the camera stops |
| Predicted position | the Gate 1 point (triangulated / wall hit / wall centre / footprint centre) |
| Road-facing wall | the outline edge whose middle is nearest the street |
| Self-consistency | spread of camera-pair estimates, a precision measure |
| Review item / event | an item in the queue / one decision or undo in the history, which is only ever added to |
| Job / worker | an analysis request / the Colab cell that runs it |
| Resumed run | a run restarted from saved stage results; its timings are partial |
| Offline mode | read-only fallback to the saved results when the database is down |
| Model card | the project's single record of measured accuracy numbers; the Trust page shows it |
| Gate 1 | FarmwiseAI's ≤ 3.5 m building-position target |
| Night Survey | the app's design system (dark indigo + sodium orange) |

---

← (this is the first file) · [Start here](00_START_HERE.md) · [01 What and why →](01_WHAT_AND_WHY.md)
