# GEO-CASCADIA — Chat Handoff: Pipeline Build, Comparisons and Tier 2 OCR

Project: FarmwiseAI Campus Product Challenge, Task 5 — Google Street View urban asset
and property intelligence. Study area: Ward 29, Coimbatore, Tamil Nadu.
Team: Praga (doing both halves; teammate Sriram not delivering).

---

## 1. Scope of this chat

**Approximate dates:** mid-to-late September 2026 (memory files updated 2026-09-16
through 2026-09-27). Exact start date uncertain.

**Phase covered:** everything between "geometry/triangulation is validated" and
"ready for Tier 3 VLM". Specifically:

- Section 11 added to the existing progress handoff (where work happens: Colab vs VS Code)
- Street selection and the smart capture plan (cells 17, 19)
- Building-footprint coverage validation (cell 18)
- Building register + synthetic property register (cell 20)
- The asset locator: rough distance → DBSCAN → triangulation → merge (cell 21)
- Running the trained detector over the whole capture plan (cell 22)
- Located asset inventory, streetlight recovery (cells 23, 24)
- Accuracy studies, visual evidence galleries (cells 25–31)
- Model comparison vs stock YOLO and YOLO-World (cell 32)
- Tier 2 OCR: crop audit, EasyOCR, then PaddleOCR (cells 33, 34, 43)
- Matching and discrepancy detection, ideal and realistic modes (cells 35, 36)
- Confidence calibration and review-queue efficiency (cell 37)
- Method comparisons: clustering, triangulation, footprint sources (cells 38–41)
- Capture plan vs naive sweep (cell 42)
- Narrow-FOV re-shot cell written but NOT run (cell 44)
- New training notebook built and YOLOv8s trained and adopted

**Out of scope in this chat:** Tier 3 Nova Lite (needs AWS credentials), cost benchmark,
PostGIS, FastAPI backend, React UI. All not started.

---

## 2. What was built

### Notebooks
| file | what it is |
|---|---|
| `geo_cascadia_fixed.ipynb` | the main pipeline notebook; cells 17–44 were all added in this chat |
| `geo_cascadia_tier1_v3_comparison.ipynb` | NEW — built in this chat; restores all training datasets from Drive and runs the v8n / v8s / imgsz / TTA comparison |
| `geo_cascadia_tier1_v2.ipynb` | pre-existing training notebook from another chat; read here to reproduce its dataset build exactly |

### Cells added to the pipeline notebook
| cell | purpose |
|---|---|
| 17 | OSM roads via Overpass (mirrors, retry, Drive cache) → 10-street shortlist |
| 18 | OSM building footprints + ray-cast coverage test |
| 19 | capture plan: per-carriageway pano assignment, smart headings, tilt views |
| 20 | building register + SYNTHETIC property register with planted errors |
| 21 | the locator: `rough_distance`, `det_to_ray`, `locate_assets`, `fuse_streetlights`, self-test |
| 21b | honest locator evaluation: truth-matched error, eps and noise sweeps |
| 22 | run the detector over the capture plan → detections + signboard crops; resumable |
| 23 | detections → located assets, signboards attached to footprints |
| 24 | streetlight recovery (direction-only) + inventory quality audit |
| 25 | visual review: detections, one pole triangulated step by step, ward map, distributions |
| 26 | lamp/streetlight visual check + building ray-hit evidence |
| 27 | building error study, triangulation vs OSM — flattered, superseded |
| 28, 29 | evidence galleries: photo + map, predicted vs actual, grouped by camera count |
| 30 | honest per-detection distance error |
| 31 | camera calibration attempt — rejected |
| 32 | model comparison: ours vs stock YOLOv8n vs YOLO-World |
| 33 | signboard crop quality audit |
| 34 | Tier 2 OCR — rewritten several times, final = PaddleOCR en+ta on GPU |
| 35 | matching + discrepancy detection scored against planted truth |
| 36, 36b | realistic matching with no shared key + pin-noise stress test |
| 37 | confidence calibration + review-queue efficiency |
| 38, 38b | clustering comparison + residual test that rejected HDBSCAN |
| 39 | triangulation comparison: least squares vs RANSAC |
| 40, 41 | Microsoft ML footprints vs OSM; full building-pipeline comparison |
| 42, 42b, 42c | plan vs naive 12-heading sweep; road-parallel headings; pole-range diagnostic |
| 43 | manual OCR verification gallery, 6 sections at readable size |
| 44 | narrow-FOV re-shot — WRITTEN, NOT RUN |

Deleted/dead: 19b (one-off diagnostic), 31 (rejected calibration), 27 (flattered numbers).

### Handoff documents produced in this chat
- `GEO_CASCADIA_PROGRESS_HANDOFF.md` — section 11 appended
- `GEO_CASCADIA_HANDOFF_v2.md`
- `GEO_CASCADIA_HANDOFF_v3.md`
- `GEO_CASCADIA_COMPLETE_EXPLAINER.md` — 19-part human-readable explainer
- `GEO_CASCADIA_HANDOFF_v4_continuation.md` — continuation of v3, not a replacement

### Files on Drive (`/content/drive/MyDrive/alldataset/`)
    LIVE (v8s):
      ward29_detections_v8s.json          4870 detections
      crops_signboard_v8s/                1744 signboard crops
      ward29_ocr_v8s.json                 706 reads
      ward29_assets.json                  224 poles / 34 streetlights
      ward29_signboards_by_building.json  1293 signs -> 227 buildings
      ward29_building_names.json          107 named buildings
      ward29_matches.json, ward29_review_queue.json, ward29_matches_realistic.json
    BASELINE (keep for comparison):
      ward29_detections.json              nano, 4514
      ward29_ocr3.json                    PaddleOCR on nano crops, 700 reads
      ward29_ocr2.json                    EasyOCR, 208 reads
      nano_ward29_*.json                  nano backups
    REJECTED (ignore):
      ward29_detections_v2.json, crops_signboard_v2/
    OTHER:
      ward29_panos.json, ward29_selected_streets.geojson, ward29_capture_plan.json,
      ward29_anomalies.json, ward29_buildings.json,
      ward29_property_register_SYNTHETIC.json, ward29_discrepancy_truth.json,
      ward29_building_error.json, model_comparison.csv,
      wheels/paddlepaddle_gpu-3.2.2-*.whl (1.9 GB cached),
      v2/s1_roboflow_clean.zip (rebuilt stage-1 cache)

---

## 3. Methods and options compared

| decision | options tried | results (numbers + n) | chosen | why |
|---|---|---|---|---|
| **Building location method** | (a) multi-view triangulation from pole pipeline (b) ray-cast to OSM footprint | n=671 buildings. 1-camera median err 1.16 m; 2-camera 2.07 m; 7+ cameras 0% inside footprint. Method agreement 88.3% | **ray-cast to footprint** | a facade is an extended object, not a point; more cameras made triangulation worse. Footprint also gives identity free |
| **Footprint source** | OSM (2183) vs Microsoft Global ML Buildings (1942) | ray-hit 79.0% vs 79.5%; buildings faced 381 vs 363; signboards attached 1149 vs 1127; unmapped rate 4.7% vs 6.1%; source agreement 95.8% (1073/1120) | **OSM** | equal coverage, better downstream, and OSM has persistent way IDs — Microsoft has no stable identifier across releases |
| **Google Open Buildings** | attempted as a third source | covering tile is several GB; crashed Colab RAM twice | **abandoned** | Microsoft was sufficient for the validation purpose |
| **Monocular distance cap** | 40 m / 12 m / 15 m | 40 m → 303 poles, 1 per 16 m; 12 m → 183 poles, 1 per 26 m, only 13 multi-cam; 15 m → 214 poles, 1 per 23 m, 27 multi-cam | **15 m** | real pole spacing is 25–30 m; 40 m was physically implausible, 12 m lost triangulation |
| **Camera calibration from data** | fit effective height + horizon on 1469 surveyed distances | fit returned 4.51 m camera height (real ≈2.5 m) and horizon 111 px off centre; held-out median 3.62→3.34 m (8%), mean 5.49→5.70 and 90th 14.77→15.88 both WORSE | **rejected** | the fit was absorbing the compound-wall bias into fake camera parameters |
| **Clustering** | DBSCAN 3 m + merge 6 m / merge-only 6 m / DBSCAN no merge / HDBSCAN + merge | assets 203 / 199 / 248 / 149. Pairs under 5 m: 0 / 0 / 66 / 0. HDBSCAN gave 47 multi-cam vs 29 but ray residual 90th 5.00 m vs 1.72 m, worst 12.97 m vs 2.91 m | **DBSCAN 3 m + merge 6 m** | HDBSCAN's extra confirmations were fake — it forced unrelated rays together. Also learned DBSCAN is nearly redundant; the merge pass does the work |
| **Merge radius** | 2 / 5 / 8 m at 12 px noise | duplicates 23 / 14 / 4; wrong merges 0 / 0 / 1 | **6 m** | a wrong merge is an invisible undercount; a duplicate is caught by the review queue. Asymmetric cost |
| **Triangulation estimator** | least squares with guards vs RANSAC | synthetic ~3.3 rays/asset: LS median 3.29 m, 90th 5.95, worst 18.89. RANSAC 2.71 / 9.70 / 38.03. RANSAC kept 2.5 of 3.3 rays. Real data: 100% agreement, 0.00 m shift, n=52 groups | **least squares** | RANSAC has a far fatter tail and discards correct rays; not enough multi-view redundancy for it to help |
| **Confidence tiers** | residual-threshold based vs confirmation-count based | residual vs error correlation −0.182; every triangulated asset had residual <0.5 m so the 1.5 m cutoff discriminated nothing. Old tiers non-monotonic (medium 0.85 m worse than low 0.65 m) | **confirmation count only** | monotonic after the change: high 0.55/1.34/1.91 m, low 0.65/2.36/4.22 m, n=240 |
| **Detector threshold experiment** | pole 0.30 vs 0.15 + TTA | raw poles 765→2679; confident inventory 106→208; BUT figure showed 4–6 stacked boxes per pole; full spacing 1 per 14 m. With NMS iou 0.45 + agnostic: 1445 poles, spacing 1 per 15 m, still stacked | **rejected, kept 0.30 for nano** | caught visually, not numerically. Spacing inconsistent with real 25–30 m |
| **OCR engine** | EasyOCR vs PaddleOCR 3.x (en + ta) | same 1562 crops: tier-2 reads 208 (19.5%) vs 700 (87.9%); buildings named 56 vs 108; mean conf 0.807 vs 0.882; 40–70 px read rate 14% vs 86% | **PaddleOCR en+ta on GPU** | 3.4× more reads and a working Tamil model |
| **OCR line ranking** | conf × length vs text-box height + structural penalties | conf×length picked URLs and garbage over headlines. Scored 9 random crops by eye: ~5 wrong / 2 partial / 2 correct. After height ranking + pooled engines: visibly better (BLESSING INDIA read correctly, CHITRATEX Tamil read at 0.96) | **height-weighted structural ranking** | the business name is the biggest text on a shopfront; structural, no wordlist |
| **VLM escalation gating** | escalate everything unreadable vs discard no-text and digit-only crops | tier 3 fell 858 → 393 → 96 (nano) / 145 (v8s). Gating avoided 51% of crops | **gate on text-detector output** | a VLM reads the same phone number; zero-text crops are detector false positives |
| **Tier 1 model** | YOLOv8n (shipped) vs YOLOv8s vs YOLO11n vs stock COCO YOLOv8n vs YOLO-World | Ward 29 n=658 objects: v8n F1 0.571, v8s F1 0.608, y11n F1 0.529. v8s pole recall 0.584 vs 0.459, lamp recall 0.469 vs 0.347. TTA rejected (precision 0.63→0.51, 4.3× slower) | **YOLOv8s @ 640** | wins on every recall class; downstream +48% streetlights, zero duplicates |
| **Signboard threshold for v8s** | 0.40 vs 0.30 | 0.40: 1037 signs attached, 197 buildings with signage. 0.30: 1293 attached, 227 buildings, 171 with 2+ | **0.30** | tuned against downstream inventory quality, not per-box F1 |
| **Matching mode** | ideal (shared building_id) vs realistic (spatial + attributes only) | 361 pairs, 353 correct = 97.8% precision. Geometry-only F1 identical at 0.88 both modes | **report both** | a real municipal register has no building_id; realistic mode is the deployment case |
| **Name matching in the cost function** | implemented and tested | 0 pairs helped — the synthetic register carries placeholder owner names ("Owner 0001") | **implemented, unevaluable** | would require regenerating the register with OCR-derived trade names, which re-seeds all 86 planted errors |
| **use_change detection** | 6 variants tried (see §6) | precision stuck at 0.02–0.04 in every variant, n=10 planted | **stop tuning, report the limitation** | the synthetic register assigns use types at random — being graded against a coin flip |

---

## 4. Datasets used

### 4.1 Street View panoramas (Ward 29)
- **Source:** Google Street View Metadata + Static API. Google Cloud project has **no
  billing account**, so usage can never be charged — dollar figures printed by the cells
  are notional list-price values only.
- **Size:** 733 camera positions in the ward; 184 selected for capture; 1043 planned views.
- **Labels:** none (raw imagery, kept in memory, not archived except signboard crops).
- **How created:** grid inside the ward polygon, snapped to nearest outdoor pano via the
  Metadata API, saved as `ward29_panos.json` (built before this chat).
- **Example records:**
  - `pano_id t6lTBswCjpZpElD-qvHVEA`, Sathy Main Road, heading 176°, pitch 0, fov 90
  - `pano_id ep17uUff`, Sathy Main Road, heading 210°, pitch 0 — used in the 2-camera
    evidence figure

### 4.2 OSM road network
- **Source:** Overpass API (free, no key; mirrors + retry + Drive cache in cell 17).
- **Size:** 366 ways in the bbox; 145 streets clipped to the ward, 21,210 m total.
- **Labels:** OSM `highway` tags; bridges/tunnels excluded.
- **Example records:**
  - `Sathy Main Road`, trunk, 951 m in-ward, 46 panos, coverage 0.97, 4 POIs, commercial;
    stored as 3 separate carriageways because it is `oneway=yes`
  - `(unnamed residential #29810143)`, residential, 672 m, 46 panos, coverage 1.00,
    0 POIs, residential

### 4.3 OSM building footprints
- **Source:** Overpass, ways + relations tagged `building`.
- **Size:** 2183 in the ward; built area 404,183 m² = 36.0% of ward; median footprint 126 m².
- **Labels:** geometry only; essentially no `name`, `address` or `building:levels` tags.
- **Example records:**
  - `w1247745341` — the building whose sign reads L.G.BALAKRISHNAN & BROS
  - `w1252503924` — the building whose sign reads RICH (biryani centre)

### 4.4 Microsoft Global ML Building Footprints
- **Source:** `minedbuildings.z5.web.core.windows.net` dataset-links.csv, quadkey
  `123321101`, India tile, 34 MB download.
- **Size:** 1942 footprints inside the ward; built area 433,412 m² = 38.6%; median 143 m².
- **Labels:** geometry only, no identifiers.
- **How created:** downloaded and clipped to the ward polygon in cell 40.
- **Example records:** polygons are anonymous (no IDs) — uncertain how to cite individual
  records. Aggregate: covers 2084 of 2183 OSM footprints (95%), adds 110 OSM lacks.

### 4.5 Building register (derived, real geometry)
- **Source:** cell 20, from the OSM footprints the capture plan actually faces.
- **Size:** 381 buildings. Median area 157 m², median frontage 16.1 m, 185 with a tilted
  view, 110 seen from 2+ cameras.
- **Labels:** `building_id` = OSM way id (stable identity), lat/lon, area, frontage,
  street, n_views, n_signs.
- **Example records:**
  - `w1247745341` — Sathy Main Road area, multi-sign commercial building
  - `w1252504450` — 290 m² footprint; the register lists 174 m², flagged as
    area_understated

### 4.6 Synthetic property register
- **Source:** generated in cell 20 with `random.seed(42)`. FarmwiseAI confirmed in writing
  that open/generated data may be used; no municipal register exists or is public.
- **Size:** 362 records for 381 buildings, with **86 deliberately planted errors**:
  location_shift 21, area_understated 20, missing_record 19, extra_floor 16, use_change 10.
- **Labels:** the planted errors ARE the ground truth, saved to
  `ward29_discrepancy_truth.json`.
- **Known weakness:** `use_type` is assigned at random, and `owner_name` is a placeholder
  ("Owner 0001"). Record pins sit exactly on the footprint centroid (0.0 m), which real
  registers never do.
- **Example records:**
  - `W29-0016` — record pin 19 m from its building → correctly flagged location_shift
  - `W29-0044` — plinth area 174 m² vs 290 m² footprint → correctly flagged
    area_understated

### 4.7 Ward 29 detector test set
- **Source:** built in the training chat; rebuilt and verified here from
  `v2/cvat_export_W29.zip`.
- **Size:** 150 hand-labelled Street View images, 658 objects. Never used in training.
- **Labels:** pole 209, lamp_head 49, signboard 104, building 296. Verified to match the
  v2 notebook exactly.

### 4.8 Stage-1 training data (Roboflow, rebuilt in this chat)
- **Source:** six Roboflow zips on Drive (Pole.v1-new, Pole.v1-preproc, Streetlight.v1i,
  StreetLight.v4i, building detection.v5i, Modern Building Detection.v1i).
- **Size:** 6534 rows → **2737 duplicate groups** after perceptual-hash dedup →
  2277 train / 401 val.
- **How created:** rebuilt in the v3 comparison notebook using the saved `v2/rf_groups.csv`
  grouping and the same seed 42 split, then cached to `v2/s1_roboflow_clean.zip`.
- **Notable:** `Pole.v1-preproc` contributed **0 images** — it was 99% duplicate of
  `Pole.v1-new`. This leakage is what inflated the original model's 0.935 pole mAP.
- **Example split counts:** Pole.v1-new 593 train / 99 val; StreetLight.v4i 613 / 106.

### 4.9 Stage-2 training data (CVAT, hand-corrected Street View)
- **Source:** `v2/cvat_export_A.zip` + `cvat_export_B.zip`.
- **Size:** 817 images, boxes: signboard 1751, building 2110, pole 974, lamp_head 352.
  Split spatially (seed 3, 0.0015° grid cells) into 712 train / 105 val = `S2B`.
- **How created:** 840 Street View images from four Coimbatore areas OUTSIDE Ward 29
  (town hall, RS Puram, Saibaba Colony, Peelamedu), auto-labelled with Grounding DINO +
  Gemini, then hand-corrected in CVAT.

### 4.10 Signboard crops
- **Source:** cell 22 saves a crop for every signboard detection.
- **Size:** 1562 (nano) / 1744 (v8s @ 0.30).
- **Quality audit (cell 33, nano set):** width median 73 px, height median 63 px.
  82% are ≥40 px tall; 5.2% under 25 px.
- **Example records:** a 277×192 px crop reading "BALAKRISHNAN & BROS LIMITED";
  a 25×25 px crop that is the Google attribution watermark.

---

## 5. Models

### 5.1 YOLOv8n — the shipped baseline (trained in another chat, evaluated here)
- **Weights:** `training_runs/v8n_s2_noreplay/weights/best.pt`, 3.0M params, imgsz 640
- **Classes (index order):** `0 pole, 1 lamp_head, 2 signboard, 3 building`
- **Training:** stage 1 on 2277 cleaned Roboflow images (60 epochs), stage 2 fine-tune on
  712 CVAT Street View images, no replay (100 epochs), SGD, lr0 0.01/0.002
- **Ward 29 metrics, n=658 objects, 150 images, IoU 0.5:**

      class        gt     P       R       F1
      pole        209   0.649   0.459   0.538
      lamp_head    49   0.315   0.347   0.330
      signboard   104   0.457   0.510   0.482
      building    296   0.672   0.659   0.666

  mAP50 ≈ 0.50. Speed 174 ms/img CPU (ONNX), ~5 ms T4.
  **The proposal PDF's "20–30 ms CPU" claim is wrong and must be corrected.**

### 5.2 YOLOv8s — trained in this chat, ADOPTED
- **Weights:** `training_runs/v8s_640_s2/weights/best.pt`, 11.1M params, imgsz 640
- **Training:** identical data and recipe to v8n (same seeds, same S1F/S2B, same epochs,
  lr, optimizer, augmentation). Only capacity differs. Batch 16/8 vs nano's 32/16.
  81 minutes on a T4.
- **Ward 29 metrics, n=658, at thresholds `{pole 0.25, lamp 0.20, sign 0.40, bldg 0.30}`:**

      class        gt     P       R       F1
      pole        209   0.678   0.584   0.627
      lamp_head    49   0.411   0.469   0.438
      signboard   104   0.455   0.490   0.472
      building    296   0.626   0.723   0.671

  Support-weighted P 0.634, R 0.591, **F1 0.608**. ~15 ms/img GPU.
  CPU speed not measured — expect 2–3× nano's 174 ms.
- **Production config adopted:**

      imgsz 640, TTA off, iou 0.45, agnostic_nms True
      CONF_TH = {"pole": 0.25, "lamp_head": 0.20, "signboard": 0.30, "building": 0.30}
      BASE_CONF = 0.20

  Note: signboard 0.30 differs from the training chat's recommended 0.40 — theirs was
  tuned on per-box F1, this on downstream buildings-with-signage.

### 5.3 YOLO11n — benchmarked, lost
- Ward 29 F1 0.529, worse than both v8n and v8s. Previously noted lamp_head recall 0.12.

### 5.4 Stock YOLOv8n (COCO) and YOLO-World — comparison baselines (cell 32)
- Stock COCO has no pole/signboard/building class; finds motorcycles and cars.
  That comparison **is** the argument for training a custom model.
- YOLO-World (`yolov8s-worldv2.pt`) is the fair zero-shot competitor, prompted with the
  four class names. Results not recorded in this chat — **uncertain**.

### 5.5 EasyOCR — replaced
- English only. Tamil model is broken upstream: checkpoint has 143 output classes, the
  code builds 127 → `state_dict` size mismatch. Open GitHub issue since 2023.
- Best result on 1562 nano crops: **208 tier-2 reads (19.5%)**, 56 buildings named,
  mean confidence 0.807.

### 5.6 PaddleOCR 3.x (en + ta) — ADOPTED
- Models: `PP-OCRv6_medium_det/rec` (English), `ta_PP-OCRv5_mobile_rec` (Tamil),
  `PP-OCRv5_server_det`.
- GPU build `paddlepaddle-gpu==3.2.2` from Paddle's own index. 0.13 s/crop on T4
  vs 6.5 s/crop on CPU.
- **Results on 1744 v8s crops:** 706 tier-2 reads (**83.0%** of name-bearing signs),
  145 escalated (17.0%), 893 discarded (51% of crops never reach the VLM),
  mean confidence 0.878, 107 buildings named.
- Engine that won: English 435, **Tamil 271**. Crops containing Tamil script: 170 (10%),
  87% of those read.
- Read rate by crop height: 0–40 px 76%, 40–70 px 78%, 70–120 px 86%, 120+ px 92%.

---

## 6. Failures, fixes and fallbacks

### Geometry and capture
| broke | fix |
|---|---|
| Fixed-offset footprint coverage test gave 31–40%, looked like failure | it sampled points at 8/12/20 m from the road centreline, which lands in the street with varying setbacks. Replaced with a ray-cast test → **79%** |
| Sathy Main Road had 12 cameras for 951 m | OSM stores `oneway=yes` roads as two parallel centrelines; the code kept only the longest. Rewrote to handle each carriageway separately → **32 cameras** |
| 13 cameras sat inside a building polygon; every ray "hit" at 0.0 m | bad GPS or badly drawn OSM polygon. Detect and drop, but **log as anomalies** |
| 43 of 52 "3+ ray" clusters came from a single panorama | multiple boxes on one pole in one image → no baseline, "0.00 m residual" was the giveaway. Added same-camera ray dedup (one ray per pano+heading per 3°). 42 duplicate rays collapsed |
| `linemerge` crashed on single-LineString streets | Shapely 2.x rejects a bare LineString. Guard: use the part directly when there is only one |
| `ex` undefined in cell 18 after a restart | it was defined in cell 17's plotting section. Inlined the ward exterior |

### Accuracy measurement
| broke | fix |
|---|---|
| First building-accuracy study reported a flattering 1.12 m | it scored against the **nearest** footprint; in dense rows almost any wrong answer lands inside *a* building. Caught by eye when two clearly different houses appeared as one asset. Replaced with per-detection scoring pinned to the ray → **3.91 m** |
| Synthetic locator test scored against the nearest truth point | a badly placed asset could be graded against a different pole. Fixed to match by truth id, and added an 8 m minimum spacing between synthetic truths |
| `cell 39` synthetic outlier test printed nothing | the 3–15 m camera window left most assets with <3 cameras. Widened to 30 m |
| `tab.gt` AttributeError in the comparison notebook | `gt` collides with pandas' `DataFrame.gt()` method. Renamed the column to `n_gt` |

### OCR
| broke | fix |
|---|---|
| `paddleocr==2.7.3` + `paddlepaddle==2.6.1` would not install on Python 3.13, and **downgraded opencv to 4.6 breaking ultralytics** | unpinned PaddleOCR 3.x works. Repair: `pip install "opencv-python>=4.7.0"` |
| EasyOCR Tamil crashed | upstream bug, two attempts (cache clear + upgrade). Fell back to English only, then switched engine entirely |
| PaddleOCR CPU: 6.5 s/crop = 2.7 h | installed `paddlepaddle-gpu==3.2.2` from Paddle's index → 0.13 s/crop |
| `paddlepaddle-gpu` reported `cuda: False` after installing | the CPU `paddlepaddle` package was still present and won the import. Uninstall **both** first |
| Paddle install broke torch: `undefined symbol: ncclCommShrink` | paddle downgrades `nvidia-cudnn-cu12`, `nvidia-nccl-cu12`, `nvidia-cusparselt-cu12`. Restore with `--no-deps` pins, then **restart the runtime** |
| `RuntimeError: PDX has already been initialized` | `paddleocr` cannot be imported twice in one kernel. One run of cell 34 per session |
| oneDNN `ConvertPirAttribute2RuntimeAttribute` crash on CPU | set `use_textline_orientation=False`; on GPU the flag issue disappears |
| Cached wheel was corrupt (3.3.1, truncated) | 2 GB Drive writes can truncate silently. Deleted and re-downloaded, then verified the size is ~1.9 GB |
| OCR named 8 different buildings "Gcogle" | the detector boxes the Google attribution watermark. Filter by **content**, not box position |
| "ROSE" appeared as the name of 8 buildings | crops were matched to buildings by pano_id alone, so every sign in a view was assigned to every building in it |
| 485 crops silently skipped | the crop→detection index lookup failed on resumed runs. Added a pano-based fallback that never drops a file |
| "95008", "90922" read as business names | phone numbers are often the biggest text. Reject digit-dominant lines, fall back to the best alphabetic line |
| "BLESSING INDIA" lost to its URL; "FOOTBALL COACHING" lost to garbage | ranking was `conf × length`. Replaced with **text-box height** as the dominant term |
| Tamil rendered as boxes in matplotlib | install `fonts-noto-unhinted fonts-lohit-taml`, rebuild the font cache with `_load_fontmanager(try_read_cache=False)`, put the family first in `rcParams` |
| 676 matplotlib font warnings buried the output | silence `matplotlib.font_manager` logger |

### Matching
| broke | fix |
|---|---|
| use_change flagged 142 of 381 buildings | rule was "any signboard ⇒ commercial"; on residential streets a detected sign is a house plate, a poster, or a false positive |
| "no signage ⇒ residential" made it worse | signboard recall is 0.51 — absence proves nothing |
| Garbage OCR names ("Gccgle", "dea") triggered use_change at 0.7 confidence | the broken first OCR run's names file was still on Drive. Moved to `ward29_building_names_OLD.json` — do not restore |
| Cell 34 overwrote `ward29_building_names.json` with an empty dict | added a guard: never write an empty names result |

### Process
| broke | fix |
|---|---|
| Cell 22 and 34 "ran" in seconds and changed nothing | both are resumable; they saw the output file complete and skipped. **Delete the output file to force a real re-run** |
| Accepted the lowered-threshold experiment on numbers alone | the figure showed 4–6 stacked boxes per pole. **New working rule: every numeric verdict gets an image check before acceptance** |
| Accidental "Run all" wiped outputs | nothing lost — all results live in Drive JSONs. Re-running 1→3→9→pano-load→17–24→35 reproduces every number in ~5 min |

---

## 7. Key numbers and results

### Study area and capture
- **10 streets, 4829 m** (company rule: ≥2 km). 3 commercial + 7 residential.
- **184 cameras, 1043 image requests.** 32 cameras dropped: 19 no-footprint-within-40 m,
  13 camera-inside-footprint, both logged.
- Commercial/residential classified by **OSM road class**, not POIs — only 7 POIs exist in
  the entire ward.

### Capture plan vs naive sweep (cell 42, n=15 cameras)
- **60% fewer requests at 48.3% recall** (72 vs 180 requests; 80 vs 145 distinct objects)
- By class: building 63%, signboard 55%, **pole 27%**
- With road-parallel headings added: 43% fewer requests at **58.6% recall**
- Diagnostic: within the 15 m usable range, plan found 27 poles vs naive 83; but the
  plan's aim is better (47% of its pole detections in range vs 24%, median 13.2 m vs 20.2 m)

### Footprints
- OSM: 2183 in ward, 36.0% built area, median 126 m²
- **Ray-cast coverage 79.0%** (710/899 test rays), median hit distance 6.9 m, 90th 24.7 m
- 444 footprints reachable from the 10 streets

### Distance accuracy (cell 30, n=1469 detections)
- Median absolute error **3.91 m**, signed **−1.09 m** (systematic under-estimate)
- By range: **0–8 m → 1.64 m median, 86% within 3.5 m**; 8–15 m → 4.55 m;
  15–25 m → 12.52 m, 0% within 3.5 m
- Detector confidence is **uncorrelated** with distance error
- Cause of the bias: box bottoms land on compound walls, parked vehicles and kerbs

### Locator validation (synthetic, truth-matched, 8 m min truth spacing)
| detector pixel noise | median | 90th pct |
|---|---|---|
| 6 px | 0.31 m | 0.88 m |
| **12 px (realistic)** | **0.67 m** | **2.33 m** |
| 20 px | 1.11 m | 3.65 m |

- **Method agreement: 88.3%** — triangulation and ray-casting pick the same building
- Confidence tiers after recalibration (n=240): high 0.55/1.34/1.91 m,
  low 0.65/2.36/4.22 m, **100% of all assets within 5 m**

### Final inventory (v8s, signboard 0.30)
- **4870 detections** from 1043 images; 4031 geometry-usable, 839 tilt-only
- **224 poles located**, 27 high / 71 medium / 126 low confidence
- **1 pole per 22 m of street** (real spacing 25–30 m)
- **0 assets closer than 5 m** — the merge pass works on real data
- **34 of 224 poles carry a lamp (15%)**; 61 lamp detections unassociated
- **1293 signboards attached to 227 distinct buildings**, 171 with 2+ signs
- **91 building rays (5.1%) hit no footprint** = candidate unmapped structures
- **27 assets (12%) confirmed from 2+ distinct camera positions**

### Unmapped structures — validated
- Of 82 building rays hitting no OSM footprint, **only 6 (7%) appear in Microsoft's
  independently-derived dataset. 76 appear in neither.** Two datasets built by completely
  different methods both lack these buildings.

### OCR (v8s crops, n=1744)
- **706 read (83.0% of name-bearing signs)**, 145 escalated, 893 discarded
- **51% of crops never reach the VLM**
- 107 buildings with a read business name
- Tamil won 271 of 706 reads (38%)

### Matching and discrepancies (n=381 buildings, 362 records, 86 planted errors)
| detector | planted | found | P | R | F1 |
|---|---|---|---|---|---|
| location_shift | 21 | 21 | 1.00 | 1.00 | 1.00 |
| area_understated | 20 | 20 | 1.00 | 1.00 | 1.00 |
| missing_record | 19 | 19 | 1.00 | 1.00 | 1.00 |
| use_change | 10 | 83 | 0.02 | 0.20 | 0.04 |

- **Geometry-only: P 1.00, R 0.79, F1 0.88** — the headline number
- Realistic mode (no shared key): **97.8% match precision**, geometry F1 unchanged at 0.88
- Pin-noise stress test: 0 m → 97.8%, 5 m → 94.5%, **10 m → 72.2%**, 20 m → 40.1%,
  30 m → 27.7%. The cliff sits at the median inter-building spacing (~15 m)

### Review queue
- **291 items**: 139 single-view buildings, 126 single-detection assets,
  26 high-severity discrepancies
- **A reviewer checking 48% of items sees 62% of planted errors**
- **The 26 high-severity items are 100% genuine**; geometry-only flags 60/60 genuine;
  medium severity 41% genuine

---

## 8. Concrete examples

**House 87, Ganapathy** — the one validated Gate-1 case, 1.30 m error from hand-read
pixels. Gate 1 was closed at n=2 and superseded by the n=60 synthetic validation and the
n=671 building study.

**`w1247745341` — L.G.BALAKRISHNAN & BROS** — a large green multi-tenant board listing
eight companies. The Tamil engine picked a smaller sub-line and returned
"SILENT CHAIN INDIA PYLIMITED" instead of the header. This drove the fix to pool both
engines' lines and rank by text height. Multi-tenant boards have no single right answer.

**`w1252503924` — RICH** — a biryani centre. PaddleOCR read "RICH" at 0.94 confidence
from a crop where EasyOCR had also succeeded. One of the cleanest reads in the set.

**BLESSING INDIA (acting drivers agency)** — the first ranking rule picked
`infoactingdriversindiacom` (the URL, longest line, 0.99 confidence). After height-based
ranking it correctly returned "BLESSING INDIA". This single case is the clearest
demonstration of why size beats confidence×length.

**CHITRATEX / சித்ரா டெக்ஸ்** — a bilingual textile shop board. The Tamil model read
"சித்ரா டெக்ஸ்" at 0.96, which no other engine could do. Also appears in the matching
sample as building `w1251626159`, flagged use_change with 3 signs.

**`w1252504807` — "dea" / "hea 4G 4G"** — an "Idea 4G" telecom advert painted on a
residential compound wall. Read as a business name and used as commercial evidence.
Telecom wall adverts across the ward are a systematic false signal for use_change.

**XXXX (balcony railing) and bRd (electrical meter box)** — two crops the signboard
detector produced that are not signboards at all. Drove the junk-rejection rules
(repeated glyphs, short mixed-case). Roughly half of all crops are like this;
signboard precision is 0.457.

**Sathy Main Road** — a `oneway=yes` trunk road stored as three separate OSM carriageways.
The first capture plan version merged them and kept only the longest, giving 12 cameras
for 951 m. After the per-carriageway fix: 32 cameras. Still the most detection-dense
street in the ward (28 detections in one view).

**Sakthi Main Road** — shrank from 178 m to 155 m and from 10 cameras to 4 because
way `1303123647` is `bridge=yes` and was correctly excluded. Contributes little; could be
dropped from the selection.

**19.21 m worst-case distance error** — a house set well back behind a long compound wall.
The detection box bottom sits on the wall, not on the house, so the ground-contact
distance measures to the wrong surface. Estimated 38.6 m for a building actually 3.7 m
away, because the base was near the horizon and `d = h/tan θ` explodes as θ → 0.

**`W29-0026`** — synthetic register record whose pin sits 24 m from its building.
Correctly flagged as location_shift. In the realistic-matching stress test, records like
this are the ones that mis-pair first as pin noise rises.

**`w1252503733` ↔ `w1252504576`** — a pair of neighbouring buildings that swapped partners
in realistic matching (14 m and 17 m apart). Illustrates why precision collapses at
σ=10 m pin noise: once the error approaches the gap between neighbours, adjacent plots
are indistinguishable on position alone.

---

## 9. Decisions left open, or changed later

### Resolved during this chat (changed from earlier positions)
- **Tier 1 model:** nano → **YOLOv8s adopted**, with signboard threshold 0.30 not 0.40
- **OCR engine:** EasyOCR → **PaddleOCR 3.x en+ta on GPU**
- **Tamil:** "impossible" → **works**, 271 of 706 reads
- **"88% fewer requests":** an unverified claim → **measured at 60% fewer at 48% recall**
- **82 unmapped structures:** unvalidated → **76 confirmed genuine**
- **`building` class:** considered for deletion → **kept**, as an unmapped-structure flag
  and a portability fallback. Do not label more of it, do not tune for it
- **Confidence tiers:** residual-based → **confirmation-count based**

### Open
1. **Cell 25 visual check on the final v8s detections at signboard 0.30** — not yet run.
   More boxes at the lower threshold; confirm they are on real signs, not railings.
2. **Tier 3 Nova Lite** (`apac.amazon.nova-lite-v1:0`, role `FAI-TCE-Builder-StreetView`,
   ap-south-1). Blocks: floor counts, building use (which would replace the dead
   use_change heuristic and unlock extra_floor scoring), and "does this pole carry a
   light?" for the ~190 poles with no detected lamp. AWS credentials expire in hours.
3. **Cost benchmark vs all-VLM** — explicit company requirement, needs Tier 3 first.
4. **Name matching in cell 36** — implemented, unevaluable until the synthetic register is
   regenerated with OCR-derived trade names. That would re-seed all 86 planted errors and
   change every downstream number. Recommendation was to report the limitation instead.
5. **`v8n_960` and `v8s_960`** — queued in the comparison notebook, never run. Higher input
   resolution may help small objects (lamp_head) more than capacity did.
6. **MiDaS / Depth Anything vs ground-contact distance** — best remaining methods-section
   material; attacks the weakest measured number (3.91 m). Not started.
7. **Narrow-FOV re-shot (cell 44)** — written, never run. Less valuable now OCR reads 83%.
8. **The 7 unnamed streets** — still need real names from Google Maps, keyed by OSM way id.
9. **Proposal corrections** — the "20–30 ms CPU" claim is wrong (174 ms nano CPU / ~5 ms
   T4; v8s CPU not yet measured). Also the PDF's stated order "triangulate then DBSCAN" is
   reversed in the implementation.
10. **Whether to drop Sakthi Main Road** from the 10 streets — 4 cameras / 155 m
    contributes almost nothing.
11. **PostGIS, FastAPI, React UI, cost panel, review-queue UI** — not started; all
    underlying numbers exist.

### Requirement clarification settled at the end of this chat
Another chat claimed registry matching was not a company requirement and came only from
the team's own proposal. **That is false.** The requirements document lists
*"Matching against at least one property or infrastructure reference dataset"* among the
seven mandatory capabilities, and the phrase *"discrepancy table"* appears verbatim under
Expected Result on the Screen, alongside "unmatched properties" KPI cards,
"database-match status" charts, a "matched record" table column, and the query
*"Show commercial buildings with more than two visible floors that do not have a matching
property record."* **Keep the matching and discrepancy layer.** Report the synthetic
register honestly: no municipal register exists, FarmwiseAI approved generated data, and
the planted errors make discrepancy detection exactly scoreable.

### Working rule adopted in this chat, worth carrying forward
**Every numeric verdict gets an image check before acceptance.** This came from two
failures where the numbers looked fine and the images did not: the flattered 1.12 m
building accuracy, and the lowered-threshold experiment whose plausible spacing hid
4–6 stacked boxes per pole.