# GEO-CASCADIA — Chat Handoff (Tier 2/3 diagnostics session)

## 1. Scope of this chat

- **Date:** 27 September 2026 (single session, several hours, spanning at least one Colab
  restart and one lost session).
- **Project:** GEO-CASCADIA, FarmwiseAI Campus Product Challenge Task 5 — Google Street View
  urban asset and property intelligence for Ward 29, Coimbatore, Tamil Nadu.
- **Team:** Praga (vision / geometry / backend), Sriram (data / matching / UI).
- **Entry state:** arrived with handoff v3 + v4. YOLOv8s already adopted over nano; production
  thresholds fixed; Tier 1 (YOLO) and Tier 2 (PaddleOCR) already run over Ward 29; triangulation,
  DBSCAN, synthetic-register matching and review queue already built.
- **What this session actually covered:**
  1. Attempt to raise signboard-detector precision with a cheap crop filter (rejected).
  2. Discovery and repair of a crop→detection join bug in Tier 2.
  3. An audit of whether the OCR business names are real names (they largely are not).
  4. First working Tier 3 — Amazon Nova Lite on AWS Bedrock — for signboard reading.
  5. Re-scoping Tier 3 from "fix OCR" to per-building reasoning (floors, use, condition,
     shop units), after re-reading the proposal and the official requirements document.
  6. Monocular building-height estimation from camera geometry (rejected).
  7. Three attempts at VLM floor counting, none yet validated.
- **Explicitly out of scope, untouched:** triangulation, DBSCAN, synthetic-register matching,
  review-queue logic, UI. Those were already done and were not modified.

---

## 2. What was built

All work is in the single Colab notebook `geo_cascadia_fixed_1__2_.ipynb` (76 cells on arrival,
numbered 1–45 in comments). Everything added this session is a new cell numbered 46 upward.
Drive working directory: `/content/drive/MyDrive/alldataset`.

### Cells added

| cell | purpose | GPU? |
|---|---|---|
| 46 | Signboard crop feature table + crop→detection join audit | no |
| 47 | Junk-filter rule sweep, scored on VLM calls saved vs names lost | no |
| 48 | Image check on the chosen filter (3 panels) | no |
| 49 | Apply filter into `_v1` files — **built, never adopted** | no |
| 50 | Hard-negative export from filter drops — superseded by 55 | no |
| 51 | v8s inference speed benchmark, GPU and CPU | GPU for one number |
| 52 | Narrow-FOV re-shoot for v8s — **written, never run, now obsolete** | GPU |
| 53 | (a) outcome by detection-confidence band; (b) redundant-escalation count | no |
| 54 | Adopt the join fix into the live names file, with backup | no |
| 55 | Hard negatives from the tier-1 population (346 crops) | no |
| 56 | Name plausibility audit | no |
| 57 | Tier 3 queue, one best crop per unnamed building | no |
| 58 | Image check on the 20-call queue | no |
| 59 | Extend queue to every building with a text-bearing crop (166) | no |
| 59b | AWS credential entry + Bedrock preflight | no |
| 59c | Model-id / region diagnostic — one-off, delete after use | no |
| 60 | Tier 3 Nova Lite call loop, resumable | no |
| 61 | Merge VLM answers into names v2 + OCR-vs-VLM agreement | no |
| 62 | Print VLM results (text only) | no |
| 62b | Show 20 random VLM results at readable size | no |
| 62c | Clear results file so 60 re-runs cleanly | no |
| 63 | Sign clustering by bearing (multi-shop buildings) — **written, not run** | no |
| 64 | OSM `building:levels` / `height` coverage query | no |
| 65 | Building queue: attach building detections to footprints, pick isolating view | no |
| 66 | Per-building Tier 3 with the target marked by a red rectangle | no |
| 67 | Inspect floor-count results | no |
| 68 | Geometric floor estimate + sliver gate (was numbered 70, renumbered) | no |
| 69 | Geometric height sanity check | no |
| 71 | Visual check of the tallest geometric estimates | no |
| 72 | Aspect-ratio / edge-touch analysis of implausible boxes | no |
| 73 | Mine VLM notes that contradict the VLM's own floor count | no |
| 74 | A/B test: enumerate-then-count prompt (v2) — failed, see §6 | no |
| 75 | No-worked-example prompt (v3) on 20 samples | no |
| 76 | Full v3 floor run, resumable | no |
| 77 | Spearman correlation: VLM floors vs height vs box pixels | no |
| 78 | Inline hand-labelling tool (three versions attempted, see §6) | no |
| 79 | Score v3 / v1 / geometry against hand labels | no |

### Cells deleted this session
- The duplicate cell 44 (notebook index 68) — identical logic and identical output to index 67.
- Index 67 kept **frozen** as the nano FOV-zoom baseline record. Never edit or re-run it.

### Files written to Drive

```
LIVE / ADOPTED
  ward29_building_names.json                    rewritten by cell 54, 146 names
  ward29_building_names_cell34join_backup.json  the 107-name version, backed up
  ward29_signboard_features_v1.json             1744 rows, feature table
  ward29_vlm_queue_v2.json                      166-building signboard queue
  ward29_vlm_results_v1.json                    Nova Lite signboard results (50 done)
  ward29_building_names_v2.json                 names after VLM merge, 153
  ward29_building_queue_v1.json                 385-building facade queue
  ward29_floors_v1.json                         Tier 3 per-building, 120 results (v1 prompt)
  ward29_floors_v3.json                         Tier 3 floors, v3 prompt, 30 results
  ward29_floors_geom_v1.json                    geometric floor estimates, 385
  crops_building_v1/                            red-box building crops
  hard_negatives_v1/                            346 crops + manifest.csv, unlabelled
  ward29_osm_levels_v1.json                     7 OSM-tagged buildings
  ward29_floors_truth.csv                       hand labels — INCOMPLETE, see §9

REJECTED, safe to delete
  ward29_detections_v8s_filtered_v1.json        output of the rejected junk filter
  ward29_signboards_by_building_v1.json         same
  ward29_floors_v2test.json                     failed enumerate-prompt A/B
  ward29_floors_v3test.json                     20-sample v3 probe
```

---

## 3. Methods and options compared

| decision | options tried | results (numbers + n) | chosen | why |
|---|---|---|---|---|
| Reduce VLM cost by filtering junk signboard crops | (a) geometric rules: aspect, area fraction, y2 position, box height; (b) image rules: Laplacian variance, Canny edge density, gray std, saturation; (c) two-feature combinations. Hundreds of thresholds swept | n=1744 crops. Median values of tier-2 (good) vs tier-3 (paid) crops: lap 2508 vs 2274, edge 0.239 vs 0.246, gray_std 42.0 vs 42.8, det_conf 0.684 vs 0.700, aspect 0.64 vs 0.67 — indistinguishable. Best rule: 12 VLM calls saved for 20 reads lost. Rule auto-selected under the ≤2-names-lost constraint saved **0** calls | **No filter** | The escalated crops are real Tamil shop boards, not junk. Confirmed visually in cell 48. Junk (tier 0/1) does separate — aspect 0.98 vs 0.64, area_frac 0.0043 vs 0.0146 — but junk is already discarded free at gating, so filtering it saves nothing that costs money |
| Which crop→detection join | (a) cell 34's original: split filename on `_` to get pano id; (b) index-first, validated by filename prefix | n=1744. Original **failed on 548 crops (31%)**, wrong detection on 0. 206 tier-2 reads had no footprint that the robust join can place, across 49 distinct buildings | **(b) index-first** | Google pano ids can contain `_` (e.g. `vlz9f5ex6nRlC4Pr_5MKag`), so `split("_")[0]` returns a truncated id, validation fails, and the crop silently gets `fp=None`. Adopting (b) took named buildings 107 → 146, nothing lost |
| Signboard confidence threshold, 0.30 vs 0.40 | Compared outcome by detection-confidence band, then by defensible-name rate | Junk rate by band: 0.30–0.40 = 70%, 0.40–0.50 = 64%, 0.50–0.70 = 54%, 0.70+ = 34%. But **defensible-name rate**: 0.30–0.40 = 26%, 0.40–0.50 = 11%, 0.50–0.70 = 17%, 0.70+ = 26%. Band added 10 buildings and 229 junk crops | **Keep 0.30** | The first analysis (junk rate) said revert; the name-quality analysis overturned it. The low band produces names as reliably as the top band, and the extra junk costs nothing at gating |
| How many crops reach the VLM | (a) all 145 tier-3 crops; (b) one call per building, skipping buildings already named | n=145 tier-3. 122 belonged to buildings that already had a tier-2 name; 0 had no footprint; 23 would name an unnamed building, spread over 20 distinct buildings | **(b) per building** | 86% of escalations avoided by deduplication alone. Later extended from 20 to 166 so Tier-2 precision could be measured on all OCR names, not only the pre-flagged suspect ones |
| Bedrock region / model id | `ap.amazon.nova-lite-v1:0`, `amazon.nova-lite-v1:0`, `global.…`, plus `us-east-1` with `us.` prefix | `apac.amazon.nova-lite-v1:0` in `ap-south-1` **works**. Base id → AccessDenied. us-east-1 → AccessDenied on `bedrock:InvokeModel` | **`apac.amazon.nova-lite-v1:0`, ap-south-1** | The SSO role is region-scoped. Visible inference profiles also include Claude 3.5/3.7/Sonnet 4, Nova Micro/Pro and `global.amazon.nova-2-lite-v1:0` — unused so far |
| Floor-count reference layer | (a) municipal register (CCMC); (b) OSM `building:levels`; (c) Google Open Buildings 2.5D Temporal; (d) synthetic register | (a) no bulk export, per-assessment-number lookup only. (b) **4 of 5143 buildings tagged (0.1%)**, 3 with `height` — unusable. (c) height in metres, 2016–2023 annual, 4 m effective resolution, covers India, CC-BY/ODbL — too coarse for 1–3 storey buildings but usable for change detection. (d) already built: 362 records, 86 planted errors | **(d) synthetic register, kept; (c) noted as an option** | Organisers confirmed open and generated data may be used. The synthetic register is already scored exactly and satisfies the mandatory matching capability |
| Floors from monocular geometry | `real_height ≈ ray_dist_m × box_height_px / focal`, `/3.2 m` | n=385. 180 (47%) implausible. Spearman: VLM floors vs **estimated height rho −0.09 (p=0.63)**; VLM floors vs **box pixel height rho +0.41 (p=0.024)** | **Rejected** | Multiplying pixel height by `ray_dist_m` destroys the correlation — so `ray_dist_m` is the noise source, not the boxes. Bearing triangulation survives because it uses the box *centre*; height needs an accurate roofline and ground line |
| Floor-count prompt | v1 direct question; v2 "enumerate levels then count" with a worked example; v3 no worked example, temp 0.4, explicit Indian ground-floor convention | v1 (n=120): `{1:10, 2:80, 3:29, 4:1}` — 67% said 2. v2 (n=20): **20/20 identical `levels` output**, all collapsed to 1. v3 (n=30): `{2:6, 3:19, 4:3, 5:1, 6:1}` — 63% said 3, 0 identical descriptions out of 20 | **v3, unvalidated** | v2's failure was mine — a fully-populated example at temperature 0 made Nova copy it verbatim without looking. v3 is grounded (descriptions vary, name real features) but still collapses onto a mode that follows the prompt phrasing |

---

## 4. Datasets used

### 4.1 Ward 29 Street View detections (existing, not rebuilt)
- **Source:** Google Street View Static API, 1043 views from the capture plan.
- **Size:** 4870 detections, 4031 geometry-usable. 1744 of them signboard class.
- **Labels:** none — model output.
- **Created by:** cell 22, YOLOv8s at the production thresholds.
- **Examples:**
  - `{"cls": "signboard", "pano_id": "…", "heading": 115.3, "pitch": 0, "conf": 0.85,
    "x1": …, "y1": …, "x2": …, "y2": …, "W": 640, "H": 640, "footprint_faced": "w1236978266"}`
  - `{"cls": "building", "conf": 0.95, "ray_dist_m": 37.6, "geom_ok": true,
    "footprint_faced": "w1247745080"}` — this one produced a 41.8 m / 13-floor estimate and was
    later flagged as a truncated sliver.

### 4.2 Signboard crop feature table (`ward29_signboard_features_v1.json`, new)
- **Source:** joins detections, crop JPEGs and OCR records.
- **Size:** 1744 rows.
- **Labels:** weak — OCR tier used as a proxy outcome (2 = name read, 3 = escalated, 0/1 = no text).
- **Created by:** cell 46. Geometry from the detection; image features via OpenCV on the crop
  resized to 64 px height (Laplacian variance, Canny edge density, gray std, HSV saturation).
- **Examples:**
  - `{"fp": "w1236978266", "det_conf": 0.84, "bh": 165, "aspect": 0.64, "area_frac": 0.0146,
    "lap": 2508, "edge": 0.239, "tier": 2, "best": "SRIABIRAAMI", "best_conf": 1.00}`
  - `{"fp": "w1236978422", "det_conf": 0.67, "bh": 174, "tier": 2, "best": "STOP",
    "best_conf": 1.00}` — later shown by the VLM to be *Shriram Stationery*.

### 4.3 Tier 3 signboard results (`ward29_vlm_results_v1.json`, new)
- **Source:** Amazon Nova Lite, one call per building.
- **Size:** 50 of 166 done.
- **Labels:** model output, structured JSON.
- **Examples:**
  - `{"fp": "w1236978547", "reason": "suspect_name", "current_name": "MATHS",
    "vlm": {"is_sign": true, "sign_type": "business",
    "business_name": "Sri Ramana Print Centre", "confidence": 0.95}}`
  - `{"fp": "w1247744847", "reason": "unnamed", "box_h": 152,
    "vlm": {"is_sign": false, "sign_type": "none", "business_name": "", "confidence": 0.1}}`
    — a decorative wall panel, a true detector false positive.

### 4.4 Building facade queue and Tier 3 results (`ward29_building_queue_v1.json`, `ward29_floors_v1.json`, `ward29_floors_v3.json`, new)
- **Source:** 1793 building-class detections ray-cast to footprints → 385 distinct footprints.
- **Size:** 385 queued; 248 with a usable box after the sliver gate; 120 v1 results; 30 v3 results.
- **Labels:** model output.
- **Created by:** cells 65, 66, 76. Crops re-fetched from Street View with 35% context padding
  and a **red rectangle drawn on the target building**.
- **Examples:**
  - `{"fp": "w1252505525", "views": 17, "boxes_in_view": 2, "w_frac": 0.65, "h_frac": 0.51,
    "vlm": {"floors_visible": 2, "building_use": "commercial", "shop_units": 2,
    "facade_condition": "fair", "primary_name": "K Style",
    "notes": "shops on ground floor, water tank on roof"}}`
  - `{"fp": "w1236977910", "views": 16,
    "vlm": {"floors_visible": 2, "building_use": "residential", "shop_units": 0,
    "primary_name": "Little Hands Playschool",
    "notes": "residential building with playschool on ground floor"}}`

### 4.5 Hard negatives (`hard_negatives_v1/`, new)
- **Source:** tier-1 crops (OCR found no name) with `det_conf ≥ 0.60`.
- **Size:** 346 crops from 109 distinct source views. `manifest.csv` with an empty
  `label_here` column.
- **Labels:** **none yet — manual step, not done.**
- **Note:** a first version (cell 50) drew from the rejected filter's drops and produced only 9
  crops. Cell 55 replaced it.
- **Examples:** `{"crop_file": "…_115.3_0_37.jpg", "det_conf": 0.78, "aspect": 0.98,
  "reason": "no_text", "label_here": ""}` — and 345 more of the same shape.

### 4.6 OSM building tags (`ward29_osm_levels_v1.json`, new)
- **Source:** Overpass API, bbox derived from camera coordinates in the detections file.
- **Size:** 5143 buildings in the bbox, **7 tagged** (4 `building:levels`, 3 `height`).
- **Levels distribution:** `{'10': 3, '1': 1}`.
- **Verdict:** unusable as a reference layer. Useful only as a motivating statistic — the open
  data is 0.1% complete, which is part of why street-level survey has value.

### 4.7 Synthetic property register (pre-existing, from v4 §8)
- 362 records generated from the footprint layer, with 86 deliberately planted errors.
- Not modified this session. Referenced only to confirm it satisfies the mandatory
  "matching against at least one property or infrastructure reference dataset".

---

## 5. Models

| model | version / id | what it does | training data | metrics (n) |
|---|---|---|---|---|
| YOLOv8s | `training_runs/v8s_640_s2/weights/best.pt`, imgsz 640, TTA off, iou 0.45, agnostic NMS | Tier 1 detector: pole, lamp_head, signboard, building | Cleaned Roboflow merge + corrected Street View auto-labels from Coimbatore wards outside Ward 29 (pre-existing) | Speed measured this session: **17.4 ms/img median on T4** (p90 20.6), **527.6 ms on CPU PyTorch** (p90 885). Detector false-positive rate on the escalated signboard subset: **4/50 = 8%** by VLM judgement |
| PaddleOCR (en + ta) | as configured in cell 34 | Tier 2 text extraction from signboard crops | n/a, pretrained | **Tier-2 precision ≈ 25%** — of 20 buildings where both OCR and the VLM produced a name, OCR agreed on 5. Caveat: biased low, all 20 came from the pre-flagged suspect pile |
| Amazon Nova Lite | `apac.amazon.nova-lite-v1:0`, ap-south-1, Bedrock Converse API | Tier 3: signboard reading, then per-building use / floors / shop units / condition / name | n/a, hosted | Signboard tier: 50 calls, ~690 input + ~44 output tokens each, 0.95–1.04 s/call, $0.0002 for 3 calls. Building tier: 120 v1 results, 1.49 s/call, $0.0023 for 30 v3 calls. **Roofline judgement agrees with the geometric edge gate 113/120 = 94%** |

Not used, but available on the same account: Claude 3.5 Sonnet, 3.7 Sonnet, Sonnet 4, Nova Micro,
Nova Pro, `global.amazon.nova-2-lite-v1:0`.

---

## 6. Failures, fixes and fallbacks

**Overpass 406, then a bad bbox.** Cell 64 first built its bbox from `ward_L.bounds`, which is in
local metres, not lat/lon. Rebuilt from camera coordinates in the detections file. Then Overpass
returned HTTP 406 for the request format. Fixed by sending the body as raw UTF-8 bytes with an
explicit User-Agent, plus fallback to `overpass.kumi.systems` and `overpass.osm.ch`.

**`rows` clobbered.** Cells 46 and 47 both used `rows`, overwriting cell 17's OSM road records
and breaking cell 25 with `KeyError: 'geom'`. Renamed to `feat_rows` and `sweep`. Same class of
problem to watch for with `dets`, `files`, `b`.

**`br` overwritten by a float.** Cell 66 failed 10 times with
`AttributeError: 'float' object has no attribute 'converse'` — a loop variable clobbered the
Bedrock client. Cell 66 now rebuilds the client defensively if `br` lacks `.converse`.

**boto3 not installed.** `!pip install -q boto3` needed in cell 1. Required after every restart.

**19% of Nova responses silently discarded.** `maxTokens: 300` truncated the JSON, so the parser
fell through and stored `is_sign: null`. The truncated text often contained the answer —
`AMBAL DRIVING SCHOOL`, `GMS STEELS`, `Sri Ramana Print Centre`, `Gas Center` were all read
correctly and thrown away. Root cause: `business_name_native` — Nova cannot write Tamil and
emitted repeated `த்த்த்` glyph loops until the budget ran out. **Fix:** dropped the Tamil field,
raised to `maxTokens: 1000`, added a regex salvage path. Truncation went to 0/50.

**`sign_type` echoed the schema.** The first prompt listed options as `business|notice|…` and Nova
returned that literal string. Fixed by enumerating the options as words.

**Building crops were the whole frame.** The first cell 65 picked the largest box, so `box_h_frac`
was 0.83–1.00 on every building and the VLM described whatever was in the view — its own notes
said "wall on left, building on right". **Fix:** rank views to prefer roughly half-frame width
with the roofline in frame, and draw a red rectangle on the target. `wrong_target` then came back
0/120.

**Geometric heights absurd.** 13 buildings estimated at 7+ floors, one at 13, in a ward with a
9.1 m median. First theory (rays overshooting to rear footprints) was wrong — cell 69 showed
**0 rays over 40 m**. Second theory (merged rows of shopfronts) was also wrong — cell 71's images
showed tall narrow strips pinned to frame edges. Cell 72 confirmed: implausible boxes have
median h/w **1.23** and **72% touch a left/right frame edge**, vs **0.73** and **48%** for the
rest. So: side-truncated slivers. Gate rewritten as `side_cut AND aspect ≥ 1.1`.

**Enumerate-then-count prompt returned identical output 20/20.** A fully-populated worked example
at temperature 0 was copied verbatim for every building. Fixed by removing the example and raising
temperature to 0.4.

**Colab `input()` box never rendered.** Three attempts at the hand-labelling cell: `plt.show()`
then `input()` (figure and prompt fought each other), `display(im)` then `input()` (image rendered,
no box — stdin wedged), then an `ipywidgets` form with toggle buttons and a SAVE ALL button.

**Labels lost.** The widget form was filled but the phone lost network before SAVE ALL registered,
and the Colab session closed. `ward29_floors_truth.csv` state unknown — check before re-labelling.

---

## 7. Key numbers and results

**Tier 1**
- 4870 detections over 1043 views; 4031 geometry-usable
- 1744 signboard crops; 1793 building detections → 385 footprints
- v8s: 17.4 ms T4 / 527.6 ms CPU PyTorch. The proposal's "20–30 ms CPU" claim is wrong.
  The 174 ms nano reference was ONNX, so not comparable — ONNX export still owed.
- Detector false-positive rate on escalated signboards: 8% (4/50, VLM-judged)

**Tier 2**
- 1744 crops → tier 0 (watermark) 13 (0.7%), tier 1 (no text) 880 (50.5%),
  tier 2 (name read) 706 (40.5%), tier 3 (escalated) 145 (8.3%)
- Named buildings: 107 → **146** after the join fix (+39, none lost)
- **Only 32 of 146 names pass a structural plausibility test.** 80 flagged fragment-suspect,
  17 lowercase-suspect, 12 too short, 5 not-a-business
- **Tier-2 precision ≈ 25%** (5 agreements in 20 comparable pairs), biased low

**Tier 3**
- Escalation deduplicated: 145 crops → 20 calls (86% avoided); later extended to 166
- Signboard run: 50 done, 20 corrected, 9 newly named, 2 removed as not-a-business,
  names 146 → 153
- Building run: 120 with use / shops / condition / name; `wrong_target` 0/120
- Use: 81 residential, 30 commercial, 4 industrial, 2 mixed, 2 under_construction, 1 institutional
- Condition: 54 fair, 36 good, 30 poor
- **Roofline agreement with the geometric edge gate: 113/120 = 94%**

**Cost**
- Routed: 166 calls ≈ **$0.0066**. All-VLM on 1744 crops ≈ **$0.091**. 93% fewer calls.
- Building tier: $0.0023 for 30 calls
- **385 Street View fetches ≈ $2.69 notional vs ~$0.03 of inference — imagery costs ~100× the
  model.** This is a more interesting finding than "VLMs are expensive" and belongs in the
  cost panel.

**Geometry**
- Sliver gate: 113 side-truncated, 53 roofline/base cut, 35 over the 22 m backstop →
  **248 of 385 (64%) usable boxes**
- Median estimated height 8.1 m, p95 16.9 m
- v3 floors vs geometry, n=30: exact 23%, within 1 83%, MAE 1.03
- Spearman: floors vs estimated height **−0.09 (p=0.63)**; floors vs box pixel height
  **+0.41 (p=0.024)**

**Floor-count distributions (the unresolved problem)**
- v1, n=120: `{1:10, 2:80, 3:29, 4:1}` — 67% exactly 2
- v3, n=30: `{2:6, 3:19, 4:3, 5:1, 6:1}` — 63% exactly 3
- Geometry, n=248: `{1:57, 2:66, 3:60, 4:37, 5:17, 6:11}`
- `floors_confident` returned **true 120/120** — a dead field, must be replaced

**OSM**
- 5143 buildings in bbox, 7 tagged (0.1%)

---

## 8. Concrete examples

**`w1236978422` — OCR read `STOP` at confidence 1.00.** Nova Lite read the same crop as
*Shriram Stationery*. This single case is the clearest statement of the session's main finding:
PaddleOCR confidence measures character certainty on the glyphs it chose to look at, not whether
it read the right text or the right sign.

**Other confident-but-wrong OCR names, all from the same run:**
`MATHS` (1.00) → Sri Ramana Print Centre · `COIMBATORE` (0.99) → Royal Canine ·
`ANTED` (1.00) → Gas Center · `EXCELDEAL` (1.00) → Ambal Driving School ·
`HILOOK` (1.00) → Kitchen Equipment · `YBIKES` (1.00) → Happy Bikes ·
`LRA` (0.65) → Aazha Specialty Clinic · `ALTERING` (1.00) → Goblin ·
`hangam` (0.76) → Bangalore Pawn. In 20 comparable pairs the VLM never once confirmed OCR's
version where it could read the sign itself.

**`w1247744847` — a decorative wall panel with a floral design.** Top of the 20-call Tier 3 queue,
152 px box, `det_conf` 0.85, the single highest-priority escalation. Nova returned
`is_sign: false`. A real detector false positive that the rejected crop filter could not have
caught, identified for about $0.00006.

**`w1247745080` — 37.6 m ray, 356 px box → 41.8 m → 13 floors.** In a ward whose median building
is 9.1 m. Cell 71's image showed a tall narrow strip pinned to the frame edge, not a tower and not
a merged row. This case drove the sliver diagnosis.

**`w1236978470` — VLM said `floors_visible: 2`, and its own `notes` said "single-storey
building".** The only self-contradiction cell 73 could find in 120 results, because the notes are
usually generic enough to fit any count.

**`w1236978266` — `SRIABIRAAMI` vs the VLM's `Sri Abirrami Jewellery`.** Scored WRONG by cell 61's
matcher because OCR dropped the spaces. OCR actually read this sign correctly. The matcher needs
the three-bucket exact/partial/wrong rule, not a substring test.

**`SCANNING` → Richi Biryani Centre and `RICH` → Rich Biryani Centre.** Two different footprint
ids, apparently one business. Either the footprint attachment is splitting one shopfront across
two polygons, or two crops of the same sign are hitting different footprints. Unresolved.

**`w1247745339` — 29 views of the same building.** The extreme case for multi-view aggregation.
Several buildings have 15–19 views. The data for multi-view floor consensus already exists.

**Multi-shop buildings.** 171 of 227 signage-carrying buildings have 2+ signboards. The current
queue sends one crop per *footprint*, so a commercial block with a bakery, a phone shop and a
tailor yields one name and loses two. Cell 63 was written to cluster signs by bearing and measure
how many shops are being lost. Never run.

---

## 9. Decisions left open or changed later

**Open — blocking**

- **Floor-count validation.** Hand labels incomplete or lost. Cell 79 exists and is ready.
  Until it runs there is no referee between v1 (mode 2), v3 (mode 3) and geometry.
  Interpretation rule agreed: bias near +1 with sd under ~0.7 → correctable, subtract and report
  the correction; exact ≥50% and within-1 ≥85% → usable as-is; sd above ~1.0 → noise, keep floors
  as a low-confidence field routed to the review queue.
- **Replace `floors_confident`.** Dead field. The agreed replacement is multi-view agreement —
  query 2–3 views of the same building, agreement → accept, disagreement → review queue. This is
  also what the spec calls for under "Resolve repeated observations of the same building or asset
  across nearby panorama positions and headings". Not built.
- **Finish the runs.** Signboard tier: 116 of 166 remaining. Building tier: 218 of 248 remaining
  on the v3 prompt.
- **Frontage width.** Named in the requirements ("Building use, number of visible floors,
  condition, frontage…") and never built. `frontage_m ≈ ray_dist_m × box_width_px / focal`.
  Width is the axis the detector gets right — the failures were all vertical truncation — so this
  may work where height did not. Untested.
- **Cell 35 re-run** on the corrected 146 names. Dependency chain, no GPU:
  `1 → 2 → 3 → 9 → pano load → 17 → 18 → 19 → 20 → 21 → 23 → 24 → 35`.
- **Patch `crop_to_det` inside cell 34** so the join bug cannot return on a future run. Replacement
  code was given: index-first with a `base.startswith(pano_id)` check, old logic as fallback.

**Open — lower priority**

- Label `hard_negatives_v1/manifest.csv` (346 crops). Deprioritised: the VLM already measures
  detector precision on the real distribution for free. The open question it would answer is
  whether the tier-1 crops are false positives or real but textless signs.
- ONNX export before quoting any CPU latency figure.
- Multi-shop buildings — run cell 63, decide whether the queue should be per sign cluster rather
  than per footprint. Extra cost is about a cent.
- Cell 25 visual check of the 0.30 signboard band. Largely superseded by cell 53's
  confidence-band analysis.
- 7 unnamed streets.
- Street View prototype-compliance question, unanswered since handoff v3.
- Every headline number in v4 §12 is stale and must be rewritten from current data.

**Changed during this chat**

- **The junk-filter plan was abandoned.** It came from advice that assumed all crops reach the
  VLM. They do not — junk is discarded free at gating, so the only crops that cost money are
  tier 3. Once measured on the right metric, the filter saved nothing.
- **Signboard 0.30 was nearly reverted to 0.40, then kept.** The junk-rate analysis argued for
  reverting; the name-quality analysis overturned it.
- **Tier 3 was re-scoped.** It began this session as a way to fix OCR mistakes. Re-reading the
  proposal (page 12: *"façade, floor, object-identity, or contextual reasoning"*; page 14: floor
  counts as an explicit trigger) and the requirements document (*"Invoke a larger vision-language
  model only for low-confidence building use, floor count or complex scenes"*) moved it to
  per-building reasoning. Both uses are legitimate; the priority changed.
- **Monocular height was proposed, built and rejected** within the session. The correlation
  analysis showed `ray_dist_m` is the noise source, which sharpens rather than weakens the
  original "Spatial Triangulation Over Heavy VLMs" argument: bearing survives imprecise boxes
  because it uses the box centre, height does not because it needs an accurate roofline and
  ground line.
- **A claim made mid-session that registry matching was optional was wrong and was retracted.**
  The requirements document lists *"Matching against at least one property or infrastructure
  reference dataset"* as one of seven mandatory capabilities, and *"discrepancy table"* appears
  verbatim under Expected Result on the Screen. The synthetic register and the v4 §8 framing
  stand unchanged.

**Three rejected hypotheses, all with numbers — the strongest methods content from this session**

1. Crop-level junk filtering for VLM cost reduction — no feature separation between junk and
   paid-tier crops (n=1744).
2. OCR confidence as a correctness proxy — 25% agreement with an independent reader (n=20),
   including confidence-1.00 answers that were entirely different businesses.
3. Monocular building height from street-level geometry — rho −0.09 against an independent
   visual count, 47% of estimates implausible (n=385).

Most student projects report only what worked. These three, each with a measured reason for
rejection, are worth more in the report than a filter that happened to succeed.

**Working rules carried forward:** single numbered cells, replacements rather than duplicates,
no full notebook dumps, and every numeric verdict gets an image check before it is believed.