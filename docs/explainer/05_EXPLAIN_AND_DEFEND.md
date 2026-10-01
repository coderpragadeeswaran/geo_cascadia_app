# GEO-CASCADIA explainer · 05 — Explain and defend

**What's in this file**
- The demo script for judges ([§14](#14-demo-script-for-judges)) and the FAQ ([§17](#17-faq)).
- Limitations ([§15](#15-limitations-and-known-issues)) and the P7 to-do list ([§18](#18-still-to-do-p7)).
- [Appendix A](#appendix-a-every-decision-d1--d49) (decisions D1–D49), [Appendix B](#appendix-b-conflicts-found) (conflicts found, stale docs) and [Appendix C](#appendix-c-open-questions) (open questions).

[← 04 Backend, database and worker](04_BACKEND_DB_WORKER.md) · [Start here](00_START_HERE.md) · (this is the last file) →

---

## 14. Demo script for judges
Before the demo: the server and the web app running, the database awake (or the offline badge is fine for read-only flows), Night mode, Ward 29 selected, 3D on. Each flow: **do → what the app asks for → what they see → why trust it → the honest caveat.**

1. **The opening flight.** *Do:* load the app. *Asks for:* the area list, then Ward 29's summary, map shapes, building and pole records and review queue. *See:* a flight over the dark city; the streetlights of Ward 29 fade on; black bands where it's dark. *Trust:* every lamp is a detector result placed from camera rays. *Caveat:* "dark" means no lamp was **seen**; the detector finds 43% of lamp heads (n=49).
2. **"What stands out."** *Do:* open the panel. *See:* 27 not in register (6 on 2nd Street, Gandhi Nagar), 50 differ, 2,019 m dark, 26 businesses with no analysed building, 139 use not known, 218 waiting. *Trust:* sentences are computed from the records, not written by hand. *Caveat:* the register is **synthetic**: it copies the observations except planted mistakes.
3. **The spec question with an empty answer.** *Do:* ask "Commercial buildings with more than 2 floors and no record". *Asks for:* the server's reading of the question. *See:* the chips and the why-empty funnel 381 → 27 → 5 → 2 → 0. *Trust:* rule-based engine, same answer every time; nothing is applied unless every word was understood. *Caveat:* only 5 of the 27 no-record buildings are commercial and 2 have a measured floor count, none above 2, so the empty answer is correct, not a failure.
4. **Dark stretches, sorted.** *Do:* "Streets where no streetlight is detected within 60 m", then change 60 to 100. *See:* 11 stretches, longest Sathy Main Road 376 m (≈ 424 m along the road); at 100 m, 7 stretches. *Caveat:* lengths are straight-line; bending roads are longer; one stretch is marked "check".
5. **Click a building: Savitha Dry Cleaner.** *Do:* type w1252504945. *Asks for:* the building's record and evidence photos, then the Street View photo and the Google listing. *See:* "Best photo" with the orange box and the sentence that it failed the quality check (a sliver); the Sign tab reads SAVITHA; use commercial from the shop sign; Google confirms the name; the register matches (it copies the observation), paired by location with high confidence (How do we know? › Paired by). *Trust:* the box and the sign are the pipeline's own links (box overlap / the sign's line of sight). *Caveat:* the sign rule is not measured yet.
6. **"How do we know?" on a busy photo.** *Do:* open w1252504929 (Sathy Main Road) → How do we know?. *See:* all 12 boxes with confidences; 5 buildings: this one, 2 registered neighbours, 1 unregistered outline, 1 with no outline. *Trust:* each building box is linked by its camera ray to the first OSM outline. *Caveat:* only outlines faced by a planned photo are analysed (381 of about 2,044 in the ward).
7. **Live 360° and the mini-map.** *Do:* Live 360°, look around, Back to map. *See:* Google's panorama at the same view with pins; the mini-map with the camera and its line of sight. *Caveat:* single-camera pins are "approx.".
8. **Poles: four in the photo, one on the map.** *Do:* open asset-0160. *See:* "Found 7 times… from one camera position, so its position is approximate", with a dashed ring of ±2.4 m ("one camera, 4 m away"). *Trust / caveat:* boxes within about 5 m merge; the map means "a pole here", not an exact count; within 8 m the circle size is a consistency check; beyond 8 m it is ±5 m from the surveyed check, and about half fall inside (Trust › Pole & light positions).
9. **Review round-trip.** *Do:* Review → A on an item → U. *Asks for:* saving the decision, then undoing it. *See:* "N waiting" drops by 1 and comes back; the History panel shows both events. *Trust:* the decision and its history entry are written in one step, and the history is only ever added to. *Caveat:* no login; the finding itself does not change.
10. **Trust: Register tests.** *See:* 94 of 108 planted mistakes caught across six areas, 14 false alarms, 530 of 538 records paired with their own building by location, and the note "This tests the comparison logic end to end on made-up data". *Caveat:* say that every miss comes from a moved pin taken by a neighbour, and that a real register can be loaded with the register import tool.
10b. **Trust: Gate 1 and "tried and dropped".** *See:* camera-derived median 2.8 m, 60% ≤ 3.5 m (n=260), status "not verified"; YOLO26s rejected; condition withheld (53% vs 66%). *Caveat:* say out loud why no pooled "all buildings" figure is quoted.
11. **(If a worker is online) Analyse a street.** *Do:* Analyse → click a short street → trim → Start. *See:* Stage 1 of 10…, the street sweeping; Done → the map flies to the new area. *Caveat:* the estimate comes from the real camera plan (D46, D47) and runs high on time for a big area (Ward 29: 16.0 min estimated vs 11.5 real); the new street is compared with a **synthetic** register too. *No worker?* Show "Queued. The analysis computer is not connected yet" and open Vadakku Masi Veethi (Madurai, 162 photos, $1.13, 6.2 min).

---

## 17. FAQ

1. **Is the 3.5 m target met?** Not verified. Against the organiser's reference (the OSM front-wall centre), camera-derived positions have a median of 2.8 m and 60.4% within 3.5 m (n=260). No surveyed truth exists, so we can't claim it.
2. **Why not quote a pooled "all buildings" figure?** It would include 121 buildings whose position *is* the reference point (0 m by construction).
3. **Is the register real?** No. It is synthetic, generated per area: it copies what the photos show except planted mistakes (78 in Ward 29), because no open municipal register exists. It is regenerated for every new street too. A real one can be loaded with the register import tool.
4. **So what does "differs from the register" prove?** That the comparison works end to end: 94 of 108 planted mistakes were caught across six areas, and every difference shown is a planted mistake or a moved pin taken by a neighbour (14 false alarms). Before D42 most use and floor differences were noise from random register values (46 of 50 and 30 of 36 in Ward 29); that is fixed.
5. **Why does the photo show more buildings than the map highlights?** The photo shows every detection; the map highlights the selected building. Other boxes belong to neighbours, to outlines that are not registered, or to buildings with no OSM outline ([§10.4](03_APP_AND_FLOWS.md#104-the-photo-shows-45-buildings-but-the-map-highlights-only-12-why)).
6. **Why does the photo show 4 poles and the map 1?** Pole detections within about 5 m merge; distant or hidden-base poles place nothing. The map means "a pole here" ([§10.6](03_APP_AND_FLOWS.md#106-poles-streetlights-and-dark-stretches-on-the-map)).
7. **Are all buildings mapped?** No: 381 outlines along 10 streets, about 19% of the ward's OSM outlines, plus 26 businesses with no analysed building ([§10.5](03_APP_AND_FLOWS.md#105-are-all-buildings-mapped-no-here-is-exactly-what-the-381-are)).
8. **What happens when I approve?** The item becomes approved with your name, a history row is written, the waiting count, rail badge and "Waiting for review" KPI drop by one, and the dashed review outline disappears. The finding, its colour and the other KPIs don't change. Undo restores it exactly.
9. **Why is use unknown for 139 buildings?** Use is read only from a clear photo of the front; 117 photos failed the quality check and 43 buildings were never boxed. A readable shop sign on the building fills in 21 of them.
10. **Where do accuracy numbers come from?** Only the model card, measured on hand labels. The app never computes an accuracy on its own.
11. **Is an LLM answering my questions?** No. A fixed rule engine from the pipeline, with a synonym layer. If a word isn't understood, it tells you and applies nothing.
12. **Why a cloud model at all?** Only for uncertain cases: 180 of 2,065 sign crops and 58 of 221 building uses in Ward 29, plus floor counts. Routing keeps accuracy (0.90 routed = 0.90 cloud-only) and cuts cloud calls from 782 to 339.
13. **How much does a street cost?** Vadakku Masi Veethi, 383 m: 162 photos ($1.13) + $0.0134 of cloud AI. The whole of Ward 29 (4.8 km, the owner's fresh run on 28 Sep): 11.5 min on a T4, 1,420 photos ≈ $9.94, cloud AI $0.0887. The imagery dominates.
14. **What if the database is down on demo day?** The server serves the same data read-only from the saved results; the UI shows "Offline — read-only".
15. **What if no worker is online?** New streets stay "Queued, waiting for a worker"; everything already analysed still works.
16. **How do you know which building a box belongs to?** A ray from the camera through the box's middle; the first OSM outline it crosses within 40 m.
17. **Does a dark stretch mean the lights are broken?** No, only that no lamp was seen in the photos. The detector finds 43% of lamp heads, and a photo can't tell whether a lamp works.
18. **Why Google Maps and not Mapbox?** Street View content may only be shown through Google's APIs, with attribution.
19. **Are Street View photos stored?** No. The browser fetches them live; the server stores only ids, headings and boxes.
20. **Why does Trichy have fewer buildings per street?** 33% of its photos faced no OSM outline; Tiruppur 90%. Open building maps are sparse outside big cities, which is why businesses with no outline exist and why Microsoft outlines fill in where OSM is under 8%.
21. **Can a bad reviewer break the data?** Decisions never change the findings or the models, and every change is kept in a history that is only ever added to. There is no login, though.
22. **What was tried and dropped?** YOLO26s, the cloud lamp check (0/20), facade condition (53% vs 66% baseline), zoom re-shoots, a 3-example floors prompt, Google Places as the use signal (66%), monocular building heights, a junk-crop filter ([§8](02_PIPELINE_AND_ACCURACY.md#8-methods-compared)).
23. **Would matching work with the city's real register?** Yes, that is what D43 is for: records are paired with buildings by location, never by a shared ID. With the IDs hidden, 530 of 538 synthetic records paired with their own building. The register import tool loads a spreadsheet (CSV or Excel) or a map file (GeoJSON), with a small file saying which column holds what, and reports every skipped row. FarmwiseAI said they may provide register data (D41).
24. **Is every shop name on the right building?** Not always. Before D44 every sign belonged to the building its photo was aimed at. A first fix moved every sign to the first building its own line of sight hit (966 Ward 29 crops), but against Google's map pins for the same names that made Ward 29 slightly worse (15 closer, 19 further). Now a sign moves only when its line of sight, and the lines 4° either side, clearly hit another building (570 crops): 14 closer, 6 further in Ward 29; 40 vs 20 across all areas. Google's pins are not surveyed, and a spot-check by eye is still on the to-do list.
25. **How far off is an "approximate" pole?** It depends on its distance from the camera: about ±2.4 m within 8 m, ±5 m farther (D45). Each band takes the larger of our two-camera check ("8 in 10 within", 63 estimates) and the notebook's surveyed check. Beyond 8 m the surveyed typical error (4.55 m) is the larger, so about half of those poles fall inside the ±5 m circle; Trust says so.
26. **Which Google keys does the project use?** One server key (Street View photos, Places, Geocoding if enabled; no application restriction) for the server, Colab and the worker, and a separate referrer-restricted browser key only for the map (D41).

---

## 15. Limitations and known issues

**Fixed in P7a (D42–D45); what remains of each:**
1. **Register noise: fixed.** The synthetic register copies the observations except planted mistakes. Remaining: moved pins
   can pair with a neighbour (8 of 26 moved pins across the areas), which causes all 14 false alarms.
2. **ID-based matching: fixed.** Records are paired by location. Remaining: tested only on synthetic registers; a real
   register's pins may be noisier (the notebook: 72.2% at 10 m pin noise).
3. **Sign-to-building linking: fixed, and checked against Google.** A sign follows its own line of sight only when that is
   clear (±4°); the first, plain version was checked against Google's pins and replaced. Remaining: not checked by eye;
   Google's pins are not surveyed; the 17 new business candidates in Ward 29 could not be cloud-checked in the re-apply.
4. **Single-camera ±3.5 m: replaced by distance bands (±2.4 m / ±5 m).** Remaining: within 8 m the band rests on a
   consistency check that leans small; beyond 8 m on the notebook's surveyed median, so only about half fall inside.

**Everything else:**
- **The register is synthetic** (property and asset). "Not in register" / "differs" demonstrate the pipeline, not real-world errors. It is regenerated for every new street as well.
- **Coverage:** only outlines faced by a planned photo along the analysed streets (381 of about 2,044 in Ward 29). No-outline buildings are not exported as buildings.
- **Use not known for 139 of 381** (Ward 29). Floors not known for 160.
- **Positions:** Gate 1 not verified; camera-derived median 2.8 m vs OSM (60% ≤ 3.5 m). 121 buildings use the map's front-wall centre (no camera measurement). Single-camera poles: see item 4 above ([key finding 4](00_START_HERE.md#improvements-the-four-key-findings-fixed-in-p7a)).
- **OSM outline problems:** merged compounds (Tiruppur w344655428), missing outlines, cameras "inside" outlines (13).
- **Sign names:** fragments (44 in Ward 29), Tamil not checked (5), OCR garble that looks like a word can still pass ("DEXENTERARSSES" was accepted as a good name before D44), posters ("COACHING"). Sign linking: see item 3 above ([key finding 3](00_START_HERE.md#improvements-the-four-key-findings-fixed-in-p7a)).
- **Detector misses:** lamp heads 43% recall, poles 58%, buildings 71%. 43 Ward 29 buildings never got a box.
- **Pole merging:** poles closer than about 5 m become one. 369 of 822 pole boxes placed nothing.
- **Dark stretches:** straight-line lengths on curves (not planned to fix); lamps can't be judged working.
- **Businesses with no analysed building:** with no outline the position is assumed 12 m along the ray. Some kept names are the cloud model's reading of garbled OCR (Tiruppur "Edelweiss Mutual Fund" from "Haletha Inectmento").
- **Timings of the three original runs** are from resumed runs (D1). The real Ward 29 full run is the owner's 28 Sep run (11.5 min, 1,420 photos, $0.0887 cloud AI), whose results are not in the repository. Hood's Ward 29 photo cost now counts the run files' 1,420 photos (≈ $9.94 at list price, P7.2).
- **Street names** of the live areas now agree between the picker and the records (D46, D47: "3rd Street, Sridevi Nagar").
- **Job estimate** from the real camera plan: photos a few per cent high, time high on a large area (Ward 29 16.0 min vs 11.5 real; D47).
- **No authentication:** anyone who can reach the server can review, delete a live area or open appeal photos.
- **Manual browser checks** for P7 are listed in docs/P7_MANUAL_CHECKS.md; the exact Colab setup-cell text is still to be pasted into worker/colab_setup_cells.md.
- **The README is a one-line placeholder.**

---

## 18. Still to do (P7)

**Done in P7 (rounds 1–3, D46–D49):** the guided tour; the polish audit (loading / empty / error states, keyboard, both
themes, numbers vs the database); the production heap re-check (21.6–46.3 MB); the README with demo-day steps and the
offline fallback; cached OpenStreetMap lookups (disk caches + `tools/warm_osm_cache.py`) with a timeout fallback; the
Analyse camera and end handles; "< 1 minute"; "Unnamed road between …"; the estimate from the real planner; the $2 cost
cap; the camera-only buildings layer; the offline-fallback test (automated: map servers blocked, worker offline, Google
keys missing, API down); the sign-move spot-check on Trust (AI first pass + a person can redo it); "1 pole on the map ·
seen in N photos"; the Hood photo cost from the run files (1,420); street-name consistency (picker and records); the
stale docs; `worker/colab_setup_cells.md`; the worker's result upload retried with back-off.

**Still open:**
- [ ] **Paste the exact S0 / S1a / S1ba / S1bb cell text** into `worker/colab_setup_cells.md` (marked "PASTE CELL HERE").
- [ ] **A person redoes the sign spot-check** on Trust (today: an AI first pass).
- [ ] **Cloud-check the business candidates the re-apply could not check** (Ward 29: 17) with a live re-run.
- [ ] A **new surveyed check of single-camera pole positions** by distance (D45 uses the notebook's older surveyed
  medians beyond 8 m).
- [ ] **The manual browser checks** in `docs/P7_MANUAL_CHECKS.md` (rounds 1–3).
- [ ] A **real-run test of the tunnel** on demo day with `127.0.0.1` (the IPv6 note in the README).

**Intentionally not planned:**
- Hosting the app (it runs on the laptop plus a tunnel).
- A separate demo mode.
- A demo video.
- The along-the-bend dark-stretch length fix in the pipeline (the app shows the along-road length and flags "check" instead, D13).

---

## Appendix A: every decision, D1 → D49

| # | One line |
|---|---|
| D1 | Stored run timings/costs come from resumed runs: Ward 29 cost/time from the model card; stage timings greyed with "resumed run, not representative". |
| D2 | Countable facts are computed from records; mismatches are listed on Trust; accuracy only from the model card (floors n=36). |
| D3 | Performance: browser memory ≤ 60 MB idle; screen sharpness capped at 1.5×; reduce-motion / 2D switch. |
| D4 | Offline data mode: read-only saved results when the database is down; writes refused; a badge says so. |
| D5 | Trust shows the production floors method separately from rejected variants. |
| D6 | Supabase setup: map support enabled; the connection type that works over IPv4. |
| D7 | Asset review items found by rounded position + type; the few-shot floors route; a layer for register entries with nothing seen; Inter + Noto Sans Tamil (later Anek Tamil). |
| D8 | Tool versions: Vite 8, React 18.3, TypeScript 5.9, zod 4, Node 24, Python 3.12. |
| D9 | Unclassified use is always shown ("use: not classified"), never hidden. |
| D10 | Database additions (full records, streets, missing records, …); area outline rule; reloads can be repeated and keep decisions; row-level security on. |
| D11 | One code path online/offline with an offline flag; dashboard recomputed; street preview before a job; review decisions can carry a photo; private photo storage; exact numbers. |
| D12 | Map layers drawn over the map; floors × 3.2 m display; unknown floors flat + hatched; zoom bands; drawn minimap; map rebuilt on theme change. |
| D13 | Street names joined from the run's name list; gap display along the road / "check"; recorded length always shown. |
| D14 | Explore: one store; editable chips via canonical text; why-empty funnel; evidence rules; estimate; Places search in Ctrl+K. |
| D15 | Night Survey design system; 64 px rail; one panel; declutter; Night roadmap only; Cloud map styles. |
| D16 | Two audiences: plain USER screens, "How do we know?" as the one door, deep detail on Hood and Trust. |
| D17 | Query UX: synonyms + understood/ignored; nothing applied on partial understanding. |
| D18 | Evidence photos with every box; projected boxes for assets; Live 360° pins. |
| D19 | Street picker on the server: local answer, a budget for OSM lookups, cache, display names, "already analysed"; CPU estimate by length. |
| D20 | Drive the street: merged branches, strictly forward stops, road-tangent forward view. |
| D21 | Memory measured; a leak fixed by reusing the map; 60–63 MB evidence view and ~70 MB theme switch accepted. |
| D22 | Type scale +3 px; WCAG AA contrast both modes; review reasons follow the finding. |
| D23 | Walkthrough fixes: filler words neutral, gaps at any interval, one scope, loose street names, flashlight, trim, faster review saves. |
| D24 | Review history that is only ever added to; single-item Undo of one history entry; tests restore only their own entries. |
| D25 | P4.5 part 1: building positions from camera rays (box centre); results not accepted. |
| D26 | Aim at the front wall (box edges); Gate 1 evaluation vs OSM facade and Google pins; not met, not verifiable. |
| D27 | Fixed position rule (triangulated / wall hit / footprint centre), 10 m plausibility, self-consistency, UI. |
| D28 | Plausibility vs the road-facing wall; variant B (≥ 2 cameras) chosen. |
| D29 | P5 pages: Hood numbers computed with sources; Trust from the model card only; reviewer required; appeal-only notes; job statuses. |
| D30 | One-time review reset (27 Sep); Review filters strict; Hood skipped-panorama reasons; layout. |
| D31 | Only the pipeline's own box-to-outline match is "This building"; plain-only Hood and Trust. |
| D32 | Building use from a readable business sign (rule); stricter display names; generic sign words. |
| D33 | Organiser guidance: OSM accepted; position = centre of the front → new "wall centre" method; fair Gate 1 row = camera-derived. |
| D34 | How the worker talks to the server, live areas, cost cap, "needs approval", interrupted after 2 minutes, one street at a time, delete. |
| D35 | Progress stages 1–10; unnamed-road names; delete/clear; cancel handshake; Drive resume; fake-worker estimate. |
| D36 | "Unnamed road between A and B / off A / near A"; object mini-maps; no version tags in names. |
| D37 | transformers 5.x fix + pin 4.57.6; Retry; honest resume note; cleaned pasted inputs. |
| D38 | OCR in its own process; memory lines; OCR self-test; tests never claim a real job. |
| D39 | One mini-map component everywhere; TensorFlow removal; browser-key detection; retries when the OpenStreetMap server is busy. |
| D40 | Multi-part job areas for streets with gaps; readable server errors; "no imagery" vs a refused key. |
| D42 | Synthetic register copies the observations except planted mistakes (empty = not compared); planted-mistake recovery on Trust. |
| D43 | Register records paired with buildings by location (one-to-one, ≤ 50 m, match confidence); a register import tool. |
| D44 | Signs linked by their own line of sight when it is clear (±4°), after a check against Google pins showed the plain rule did not help; businesses on no analysed building; Google check reusable from saved places. |
| D45 | Single-camera pole uncertainty by camera distance (±2.4 m ≤ 8 m, ±5 m beyond): per band the larger of the two-camera check and the notebook's surveyed median. |
| D46 | Analyse: one framing per street, two end handles, "< 1 minute", unnamed-road names, a raced OSM lookup with a 5 s budget, the estimate from the real camera plan, a $2 default cost cap. |
| D47 | Time = start-up + photos × 0.49 s; Google's own name for an unnamed road; camera-only buildings layer; linked sign boxes; the street-name picker; the sign rule and its AI spot-check on Trust. |
| D48 | Street lookup answers "pending" instead of 503 and keeps looking in the background; mirrors raced with health; plain words on user screens; no city badges. |
| D49 | Guided tour; demo-day map cache (warm-up tool); the planner never caches a failed Street View search; worker upload retries; the app opens without a map key; API-lost banner; no pooled Gate 1 row; heap re-measured; README and docs. |
| D41 | Owner facts (30 Sep): the fresh full Ward 29 run (28 Sep: 11.5 min T4, 1,420 photos, cloud AI $0.0887, router on) is the real full-run time/cost; FarmwiseAI doubt session (27 Sep): OSM accepted, position = centre of the front, register data may come later; one Google server key for the server, Colab and the worker, browser key for the map only, D40 was that key refused. |

---

## Appendix B: conflicts found
Rule (owner, 30 Sep): **the code wins everywhere.** Code and data beat the decision log and the project brief, which beat the history notes. The winner is in **bold**. The stale docs are not edited now; they are listed under "To update in P7" at the end of this appendix.

1. **Status colours.** Project brief §9.1: matched teal, discrepancy amber, no record red, review violet. **Code and design notes: matched dusk slate, differs glacier, not in register peony, review chalk (dashed).**
2. **Area-level base map.** Project brief §9.3: hybrid satellite at area zoom. **Code (D15): Night = dark roadmap only; satellite is a Daylight option.**
3. **Worker heartbeat.** Project brief §8: every 30 s. **Code: 15 s; interrupted after 2 min (D34).** The older pages document (26 Sep) still says 10 min.
4. **Job statuses.** Project brief §6 lists six. **Code adds "needs approval" and display statuses cancelled / cancelling / interrupted.**
5. **Appeal photo.** Project brief: stored as a web address. **Code: stored as a private location; a short-lived link is made on request.**
6. **The older pages document is stale (26 Sep).** It says Review has no filters and no history panel, the UI never sends a reviewer, the worker is not built, Hood has 9 chapters, and Ward 29 has 260 review items. **Code: filters, History panel, reviewer required (D29), worker built (P6), 10 chapters + overview, 276 items (after D32).**
7. **"How do we know?" memory.** D16 and the older pages document: remembered for the session. **Code: each section starts collapsed and is not remembered.**
8. **Number of example questions.** The owner's prompt says 5. **Code (D17): 6.**
9. **Pole merge distance.** History chat 1: merge radius 6 m chosen. **Code (pipeline settings): 5 m.**
10. **Detector figures.** History chat 1: YOLOv8s weighted F1 0.608, v8n 0.571 (sign threshold 0.40); history chat 2: v8s 527.6 ms per photo on CPU (PyTorch). **Model card: F1 0.625 / 0.582 at pipeline thresholds; 320 ms CPU.**
11. **Register record ids.** History: W29-0016, W29-0044. **Code: P-0016, P-0044** (same buildings, same planted mistakes).
12. **OSM outlines in Ward 29.** History: 2,183. **Today's saved download: 2,044** with their centre in the study area (different fetch time and method).
13. **Inventory counts.** History: 224 poles / 34 streetlights, 706 OCR reads, 107→146 named buildings. **Current data: 230 / 38, 807 read, 145 named (96 clearly, after D44).** Later runs.
14. **Stored vs computed** (all on Trust): use local/cloud 193/73 vs **163/58**; triangulated 29 vs **20**; usable views 266 vs **221**; Trichy cloud 44 vs **41**; floors validation note n=33 vs **model card n=36**.
15. **Ward 29 run time.** The area's saved results: 3.3 min (resumed run, D1). **The owner's fresh full run: 11.5 min on a T4** (D41), matching the model card.
16. **Ward 29 photo cost on Hood.** Hood: 1,154 × $0.007 = $8.08 (planned views only). **The owner's fresh run fetched 1,420 photos (≈ $9.94)**, and the run's saved results agree (1,154 + 266 building crops). Hood under-counts.
16b. **Ward 29 cloud-AI cost.** Model card: $0.056 with the router, $0.089 without. **The owner's fresh run with the router on: $0.0887** (D41, used as the real full-run cost). The reason for the gap is not confirmed ([Appendix C](#appendix-c-open-questions)).
17. **Single-camera uncertainty basis** (resolved by D45). The results and UI used to say "86% of monocular distances within 3.5 m". **History chat 1: 86% only for 0–8 m; median 4.55 m at 8–15 m; overall median 3.91 m.** Model card: only 7 of 26 single-camera assets on or near. D45 now uses ±2.4 m within 8 m and ±5 m beyond (the surveyed median rounded up).
18. **Street name of a live run.** Job/picker: "Unnamed road off 4th Street". **Its records: "3rd Street, Sridevi Nagar"** (the pipeline's Google Geocoding name). Different sources, both shown.
19. **Google-pin Gate 1 block.** The model card keeps it, labelled **"computed before D33 (old fallback); not re-run"**. It is stale.
20. **Hood design.** Design notes: 7 chapters. **Code: 10 chapters + an overview.**
21. **Charts library.** Project brief: Nivo Sankey. **Code: not installed; own drawings.**
22. **Fonts.** Project brief: Inter or Geist; D7: Inter + Noto Sans Tamil. **Code (D15): Anek Tamil + Martian Mono.**
23. **The third history note is identical to the first.** A third history note seems to be missing.
24. **The README** is a one-line placeholder, while the project brief §11 (P7) expects demo-day steps.

### To update in P7 (stale docs) — done in P7 R3 (D49)
The project brief (CLAUDE.md), the design notes, the older pages document and the README were brought up to date on 1 Oct 2026; the rows below are kept as the record of what changed. The third history note was not replaced (the real one is not in the repository).

| Document | What is stale | What the code does |
|---|---|---|
| Project brief | status colours (teal/amber/red/violet) | slate / glacier / peony / chalk (item 1) |
| Project brief | area-level hybrid satellite | Night roadmap only; satellite in Daylight (item 2) |
| Project brief | fonts Inter or Geist | Anek Tamil + Martian Mono (item 22) |
| Project brief | worker heartbeat 30 s | 15 s; interrupted after 2 min (item 3) |
| Project brief | six job statuses | + "needs approval", display states cancelled / cancelling / interrupted (item 4) |
| Project brief | Nivo Sankey for the pipeline funnel | own bars, funnel and donuts (item 21) |
| Project brief | appeal photo stored as a web address | a private location, short-lived link on request (item 5) |
| Design notes | Under the Hood has 7 chapters | 10 chapters + an overview (item 20) |
| Older pages document | whole document (26 Sep): no Review filters/history, no reviewer, no worker, 9 chapters, 260 items, 10-min interrupted | see item 6 |
| Decision log, D16 | "How do we know?" remembered for the session | collapsed each time (item 7) |
| README | placeholder | needs a real README (item 24) |
| Third history note | duplicate of the first | the real third note should replace it (item 23) |

---

## Appendix C: open questions
Things that could not be confirmed from the code or data. **Resolved by the owner on 30 Sep (D41), no longer open:** the fresh full Ward 29 run (11.5 min, 1,420 photos, $0.0887 cloud AI, router on); the FarmwiseAI doubt-session guidance (incl. "register data may come later"); the Google keys and the D40 incident (the server key was refused until the Street View Static API was added).

Still **not confirmed**:
1. **Why the fresh run's cloud-AI cost ($0.0887, router on) is close to the model card's *without-router* $0.089** rather than its with-router $0.056. The run's results are not in the repository.
2. **Whether Geocoding is enabled on the server key today** (the owner says "if enabled"; D36 found it disabled then).
3. **A realistic (spatial) register matcher** for real data: the notebook's realistic mode (97.8% precision) is not in the current pipeline, and whether it exists elsewhere is not confirmed.
4. **The hand-label sets** (use n=29/31, floors n=36, names n=31, detector test set) are not in the repository; only their numbers are (D32).
5. **YOLO-World** zero-shot results: not recorded (history chat 1).
6. **Supabase dashboard settings:** any security or storage rules added by hand, outside the project's database set-up scripts.
7. **The exact setup-cell text (S0, S1a, S1ba, S1bb):** `worker/colab_setup_cells.md` describes each cell; the text itself is marked "PASTE CELL HERE" until the owner pastes it.
8. **Accuracy of the D32 sign rule:** not measured.
8b. **Whether the D44 sign moves are right:** 570 Ward 29 sign crops changed building. Checked against Google's pins (14 closer, 6 further), not against the photos by eye.
9. **Why some Tiruppur business names passed the 0.7 OCR gate** with little visible support (e.g. "coimbatore association" from OCR "gngiuguy"): not investigated.
10. **Real-world position accuracy** (buildings and poles): no surveyed reference.
11. **Floors on unseen cities** beyond Trichy (n=6).
12. **The true stage timings of the three original runs** (D1): the original logs are not available.
13. **Microsoft outline IDs** (built from the outline's centre) change between Microsoft releases: how a reloaded live area keeps its review decisions after a re-fetch is not confirmed.
14. **Google Places price** is not in the model card, so Places cost is "not recorded".
15. **Photo dates:** the app does not show a panorama's capture date, and whether Google's embedded panorama shows it in this configuration (address control off) is not confirmed.
16. ~~Production memory after P6~~: re-measured in P7 R3 (21.6–46.3 MB, [§13.4](04_BACKEND_DB_WORKER.md#134-memory-d3-d21-production-build-js-heap-after-gc)).

---

[← 04 Backend, database and worker](04_BACKEND_DB_WORKER.md) · [Start here](00_START_HERE.md) · (this is the last file) →
