# GEO-CASCADIA: full manual check and study guide

A start-to-end walk through the whole app, in the order of a real demo, for checking every click by hand before the
11 Oct 2026 review. Each check also explains what you are looking at, so you learn the project as you go.

**Where the expected values come from.** Every number and every quoted line below was taken by running the app on
**9 Oct 2026**, on **commit `6673d8c`** (main, the prereview-fixes merge). They came from:

- real calls to the API on the laptop (`http://127.0.0.1:8000`);
- Playwright runs of the web app (`http://localhost:5173`, 1366×768, Night unless stated);
- the downloaded reports (PDF, Excel, GeoJSON, Shapefile).

Nothing is copied from older docs. Where something could not be run today, the check says so (see also the end of
this file). The older short list `docs/P7_MANUAL_CHECKS.md` is unchanged.

**The requirements PDF is not in the repository.** The "Requirement it proves" lines quote the requirement wording
the repo itself records: the example questions in `CLAUDE.md` §10, and the lines quoted from the requirements document
in `docs/history/` (chat 1 and chat 2). Before the review, tick them against your copy of the PDF.

---

## How to read this file

- **Check ID.** S = setup, T = tour, E = Explore, Q = questions, C = charts, R = Review, H = Under the Hood, U = Trust,
  J = Jobs and Analyse, P = reports, K = themes, keyboard and problem states.
- **⚠ = changes data or costs money.** Each one says how to undo it.
- **Google requests on your own key.** Every map load, Street View photo and 360° view is a Google request on the
  owner's personal key. Under Google's India pricing the bill so far is ₹0. The app's own line says "17,747 Street
  View photos billed at ₹0, Sep 7 – Oct 6 2026". Ordinary viewing is not marked ⚠; steps that fetch many photos are.
- **Words used.** A one-line meaning is given the first time a technical word appears. The full glossary is in
  `docs/explainer/00_START_HERE.md` §16.
- **Ward 29** is the main demo area: Ward 29, Coimbatore, the Oct 2026 re-run (D64). The older Sep 2026 run is kept
  as a hidden backup, `ward29_v1`, and never appears in the app.

---

## 0. Setup

### ☐ S-01 · Start the API on the laptop
- **Where:** PowerShell, repo root (`C:\projects\geo-cascadia-app`).
- **Steps:**
  1. Run `backend\.venv\Scripts\python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000`.
  2. In a browser open `http://127.0.0.1:8000/health`.
- **Input:** none.
- **Expected:** the console prints `Uvicorn running on http://127.0.0.1:8000`. `/health` returns JSON with
  `"ok":true`, `"offline":false`, every entry under `configured` `true`, and `"worker_online":false` while no worker
  runs. The first page load after a restart reads every area from the database (about 18 s); after that pages answer
  in under a second.
- **How to confirm it's correct:** open `http://127.0.0.1:8000/docs` (Swagger, the API's own clickable list of
  requests). It lists `/areas`, `/query`, `/review`, `/jobs` and `/worker/...`.
- **Requirement it proves:** extra / not required (the platform the demo runs on).
- **If it looks different:** `"offline":true` means Supabase, the cloud database, was not reachable. The app then
  shows saved data read-only (K-06). `configured.maps_browser_key:false` means `backend/.env` lacks the Google browser
  key, so the map will not show (K-07).

### ☐ S-02 · Start the web app on the laptop
- **Where:** a second PowerShell, folder `web`.
- **Steps:**
  1. For the demo: `npm run build; npx vite preview --port 5173 --strictPort`.
  2. For development or scripts: `npm run dev -- --port 5173 --strictPort`. The values in this file were taken on
     the dev server.
  3. Open `http://localhost:5173/`.
- **Input:** none.
- **Expected:** the dark "Night" map of Ward 29, Coimbatore, the key-number ribbon (E-02), and the top bar showing
  **Ward 29, Coimbatore · Ctrl K · Analyse · Analysis off · 3D**.
- **How to confirm it's correct:** the footer reads "Registers are synthetic demo data. Prototype — imagery ©
  Google." and "Map data © OpenStreetMap contributors · building footprints © Microsoft.", and Google's logo shows
  bottom left.
- **Requirement it proves:** extra (CLAUDE.md §9.6: Google attribution always visible).
- **If it looks different:** use port 5173 exactly. The Google browser key only works on `http://localhost:5173/*`
  and the API only accepts calls from that origin. Any other port gives no map and failing API calls.

### ☐ S-03 · ⚠ Fresh AWS keys for the live server
- **Where:** the AWS access portal, then two key files on the laptop.
- **Steps:**
  1. In the AWS access portal copy new short-lived credentials for the **EC2 role** into `C:\projects\aws_ec2.env`.
     These are used to start, stop and check the server.
  2. Copy new credentials for the **Builder role** into `C:\projects\aws_builder.env`. These are used for Amazon
     Nova, the cloud AI model, and only the worker uses them.
- **Input:** the three values from the portal: access key ID, secret, session token. Never paste them anywhere else.
- **Expected:** nothing visible yet. The keys last a few hours.
- **How to confirm it's correct:** S-04 and S-05 run without "The AWS keys in … are expired".
- **Requirement it proves:** extra (deployment, D63).
- **If it looks different:** "The AWS keys in C:\projects\aws_ec2.env are expired: refresh that file from the AWS
  access portal, then run this again." means the keys are old. Refresh them and repeat.
- **Undo / cost:** none by itself.

### ☐ S-04 · ⚠ Start the live server (`start.ps1`)
- **Where:** PowerShell, repo root.
- **Steps:** run `tools\deploy\start.ps1`.
- **Input:** none.
- **Expected:** these lines, in order:
  - "Instance i-09e10c6bc76bb84dc | Elastic IP 65.1.253.18";
  - "Waiting for the site...";
  - "API ok | database online | analysis worker not connected";
  - "Waiting for the analysis worker (it loads its models, ~1-2 min)...";
  - "API ok | database online | analysis worker online";
  - "Site: http://65.1.253.18/".
- **How to confirm it's correct:** S-06 shows "state running".
- **Requirement it proves:** extra (deployment, D63).
- **If it looks different:** "The server does not answer SSH after 5 minutes" means run `stop.ps1` and try again
  later. "Could not update the SSH rule…" means your home IP changed and the rule could not follow it; SSH may fail
  but the site still works.
- **Cost / undo:** **$0.579 per hour** while running (g4dn.xlarge, AWS list price). It **stops by itself 90 minutes
  after start**; `tools\deploy\extend.ps1` adds 60 minutes. Undo with S-07.
- **Not run today:** the server was stopped and was not started for this guide. The lines above are quoted from the
  script.

### ☐ S-05 · ⚠ Send the Nova keys to the server (`refresh_keys.ps1`)
- **Where:** PowerShell, repo root, server running.
- **Steps:** run `tools\deploy\refresh_keys.ps1`.
- **Input:** none (it reads `C:\projects\aws_builder.env`).
- **Expected:**
  - "Checking the keys with one tiny Amazon Nova call (about $0.000001)...";
  - then "Worker restarted with the new keys. It shows "online" in the app within about 2 minutes (it loads its
    models first)."
- **How to confirm it's correct:** after about 2 minutes the app's top bar shows **Analysis on** instead of
  "Analysis off".
- **Requirement it proves:** extra (deployment).
- **If it looks different:** "The worker is running a job: not restarted." is fine; it picks up the new keys at its
  next job. `-Force` restarts it now, and the job resumes from its saved stages.
- **Cost:** one Nova call, about $0.000001 (AWS).

### ☐ S-06 · Open the live site, then check its status (`status.ps1`)
- **Where:** a browser, then PowerShell.
- **Steps:**
  1. Open `http://65.1.253.18/`.
  2. Run `tools\deploy\status.ps1`.
- **Input:** none.
- **Expected:** the site shows the same Ward 29 numbers as the laptop: 373 / 22 / 54 / 11 / 168. The laptop and the
  server share one database, and the server runs release `a7278ec`, which has the same data as `6673d8c`.
  `status.ps1` prints:
  - "Instance i-09e10c6bc76bb84dc | g4dn.xlarge | state running | Elastic IP 65.1.253.18 | site http://65.1.253.18/";
  - "API ok | database online | analysis worker online";
  - "Worker: connected | GPU | idle".
- **How to confirm it's correct:** the live site's key numbers equal E-02.
- **Requirement it proves:** extra.
- **If it looks different:** no map on the live site means the Google browser key is missing its website rule
  `http://65.1.253.18/*`.
- **Checked today (server stopped):** `status.ps1` printed "Instance i-09e10c6bc76bb84dc | g4dn.xlarge | state
  stopped | Elastic IP 65.1.253.18 | site http://65.1.253.18/" and "Not running (start.ps1 starts it)."

### ☐ S-07 · Stop the server (`stop.ps1`), then confirm (`status.ps1`)
- **Where:** PowerShell, repo root.
- **Steps:**
  1. Run `tools\deploy\stop.ps1`.
  2. Run `tools\deploy\status.ps1`.
- **Input:** none.
- **Expected:** `stop.ps1` prints "i-09e10c6bc76bb84dc: running -> waiting for 'stopped'…" and then
  "…: stopped". `status.ps1` prints "state stopped" and "Not running (start.ps1 starts it)." (the second line was
  seen today).
- **How to confirm it's correct:** `http://65.1.253.18/` no longer answers.
- **Requirement it proves:** extra (money safety).
- **If it looks different:** if the EC2 keys expired during the session, `stop.ps1` cannot run. Refresh the keys
  (S-03) and run it again. The 90-minute auto-stop is the backstop.
- **Cost:** stopped still costs $12.77 a month (disk $9.12 + Elastic IP $3.65).

---

## 1. First open and the guided tour

### ☐ T-01 · The tour opens by itself on the first visit
- **Where:** Explore (the map), a fresh browser profile.
- **Steps:**
  1. Open the app in a private window, or delete `gc.tourSeen` in DevTools → Application → Local storage.
  2. Wait for the opening flight to finish.
- **Input:** none.
- **Expected:** a card "GUIDED TOUR · 1 OF 7", titled "The numbers for this area": "Ward 29, Coimbatore: 373
  buildings checked from Street View photos (+ 9 seen only by camera, with no map outline). 22 are not in the
  property register and 54 differ from it; 11 possible dark stretches have no streetlight seen in 60 m (the detector
  misses some lamps). Click any number to see those places on the map."
- **How to confirm it's correct:** the numbers in the card equal the ribbon (E-02).
- **Requirement it proves:** extra (CLAUDE.md §9.5 demo mode).
- **If it looks different:** no card means `gc.tourSeen` is already set. Use the **?** (Tour) button at the bottom of
  the left rail.

### ☐ T-02 · Step through all seven steps
- **Where:** the tour card.
- **Steps:** press → (or Enter, or Next) six times.
- **Input:** none.
- **Expected step titles:**
  1. "The numbers for this area".
  2. "Why a building is flagged". The map flies to a not-in-register building and its drawer opens.
  3. "A person has the last word". The Review page.
  4. "Analyse a new street". With the worker offline it says "The analysis computer is off right now, so a new
     street would wait in the queue."
  5. "Every analysis in one list". Jobs.
  6. "How far to trust it". Trust: "Building positions (FarmwiseAI Gate 1, within 3.5 m) are marked Not verified".
  7. "That's the tour", with a **Finish** button.
- **How to confirm it's correct:** the counter reads "N OF 7" at every step, and ← goes back one step.
- **Requirement it proves:** extra (§9.5).
- **If it looks different:** with the worker online, step 4 does not mention the queue. That is correct.

### ☐ T-03 · Esc closes it, and it never reopens by itself
- **Where:** the tour card.
- **Steps:**
  1. Press Esc.
  2. Reload the page.
  3. Click **?** (Tour) on the rail.
- **Input:** none.
- **Expected:** Esc closes the card. After the reload no card appears (checked: 0 cards). **?** starts it again at
  step 1.
- **How to confirm it's correct:** the `gc.tourSeen` key equals `1` in Local storage.
- **Requirement it proves:** extra.
- **If it looks different:** a card that reopens after every reload means the browser blocks local storage (a
  private window with storage blocked).

---

## 2. Explore

### ☐ E-01 · Area picker
- **Where:** top bar, the area name ("Switch area"), or Ctrl K → Areas.
- **Steps:**
  1. Click **Ward 29, Coimbatore ▾**.
  2. Read the list.
  3. Pick Sanganur Road.
  4. Pick Ward 29 again.
- **Input:** none.
- **Expected:** 10 areas. As listed in Ctrl K, building count first, then buildings seen only by camera:

  | Area | Buildings | Seen only by camera |
  |---|---|---|
  | Rathinapuri (Sanganoor) Main Road | 51 | +1 |
  | Sanganur Road | 52 | +2 |
  | Uthukuli Road, Tiruppur | 1 | +11 |
  | Bharathidasan Salai, Tiruchirappalli | 66 | +79 |
  | Unnamed road between Bharathiar Road and Sankara Linganar Street | 10 | — |
  | Unnamed road near 5th Street | 5 | — |
  | 3rd Street, Sridevi Nagar | 25 | — |
  | Kattabomman Street Extention | 8 | — |
  | Vadakku Masi Veethi | 49 | +4 |
  | Ward 29, Coimbatore | 373 | +9 |

  Picking an area flies the map there and changes every number.
- **How to confirm it's correct:** `http://127.0.0.1:8000/areas` lists the same 10 slugs (short IDs), and no
  `ward29_v1`.
- **Requirement it proves:** extra ("Ward 29 is the pre-computed showcase; any other street can be analysed on
  demand", CLAUDE.md §1).
- **If it looks different:** an 11th entry "ward29_v1" means the hidden backup lost its `hidden.json`. It must stay
  hidden.

### ☐ E-02 · Key-number cards (KPI ribbon) and More
- **Where:** Explore, the strip under the top bar.
- **Steps:**
  1. Read the five cards.
  2. Click **More**.
- **Input:** none.
- **Expected:**
  - Cards: **373 BUILDINGS CHECKED** with "+ 9 seen only by camera" under it · **22 NOT IN REGISTER** · **54
    DIFFER FROM REGISTER** · **11 POSSIBLE DARK STRETCHES** · **168 USE NOT KNOWN**.
  - More: Streetlights 38 · Poles, no lamp seen 224 · Shop names read clearly 87 · Also on Google Maps 21 · Signs to
    double-check 61 · Waiting for review 221 · Businesses with no analysed building 23 · Streets 10.
- **How to confirm it's correct:**
  - 22 + 54 + 297 matched = 373.
  - 38 + 224 = 262 poles and streetlights, the same as Under the Hood step 08 (19 + 243).
  - The rail badge on **Review** shows 221.
  - The PDF page 1 shows 373 / 22 / 54 / 11 / 221 (P-01).
- **Requirement it proves:** "unmatched properties" KPI cards (Expected Result on the Screen, quoted in
  `docs/history/chat1.md`).
- **If it looks different:** 381 / 27 / 50 / 139 are the old Sep 2026 run (`ward29_v1`); the switch to the re-run
  was rolled back. "+ 47 seen only by camera" is the pre-D65 count.

### ☐ E-03 · Click a card: the list behind the number
- **Where:** the ribbon, then the right-hand panel.
- **Steps:**
  1. Click **22 NOT IN REGISTER**.
  2. Scroll to the bottom of the list.
  3. Press Esc.
  4. Repeat with 54 and with 168.
- **Input:** none.
- **Expected:**
  - **22:** a panel "22 buildings are not in the register". Top streets: 2nd Street, Ganapathy Gardens (approx.) 4 ·
    Ganapathy - Avarampalayam Road 3 · Sathy Main Road 3. Tabs List / By street. The footer says "22 buildings".
    Rows include "anna bakery · Ganapathy - Avarampalayam Road" and "MACAOECATMA · 2nd Cross Road, Gandhi Nagar
    (approx.)". The map dims everything else.
  - **54:** "54 buildings differ from the register". Top streets: 2nd Street, Gandhi Nagar 10 · 2nd Street,
    Ganapathy Gardens (approx.) 7 · Korathottam Road 7. Tabs List / How they differ. Footer "54 buildings".
  - **168:** "Use not known for 168 buildings". Top streets: 2nd Street, Ganapathy Gardens (approx.) 27 ·
    Korathottam Road 26 · 4th Street, Tatabad / Vinobaji Street 21.
- **How to confirm it's correct:** each footer count equals its card. Esc closes the panel and the map un-dims.
- **Requirement it proves:** "discrepancy table" and "matched record" table column (Expected Result on the Screen).
- **If it looks different:** a footer that differs from its card means the panel's filter and the dashboard
  disagree. Write down which card.

### ☐ E-04 · "What stands out" panel
- **Where:** Explore, the **What stands out** button (top right of the map).
- **Steps:** click it.
- **Input:** none.
- **Expected:**
  - "Download report: PDF Excel GeoJSON Shapefile".
  - Sentences:
    - "22 buildings are not in the register — 4 of them on 2nd Street, Ganapathy Gardens (approx.)";
    - "54 buildings differ from the register — most often: record pinned in the wrong place (18)";
    - "2,487 m of road has no visible streetlight — 11 stretches; longest 600 m on Sathy Main Road";
    - "23 businesses have no analysed building";
    - "Use not known for 168 buildings — of 373: no clear photo of the front";
    - "221 items are waiting for a person to check".
  - BY STREET: Sathy Main Road "3 not in register · 6 differ · 600 m dark · 46 bldg", and nine more streets.
- **How to confirm it's correct:** the by-street numbers equal the Under the Hood street table (H-09).
- **Requirement it proves:** "discrepancy table" (Expected Result on the Screen).
- **If it looks different:** "most often: bigger than recorded (18)" is not wrong. Wrong pin and bigger than recorded
  are tied at 18 each, and the tie can show either.

### ☐ E-05 · Map layers and the Key
- **Where:** Explore, the layers button (top bar, stacked-squares icon), and **Key** (bottom left).
- **Steps:**
  1. Open Layers.
  2. Close it (Esc).
  3. Open Key at area zoom (about 16).
  4. Turn **Possible dark stretches** off and back on in Layers.
- **Input:** none.
- **Expected:**
  - Layers, under FINDINGS: Buildings · Streetlights and poles · Approximate positions ("Dashed circle = seen from
    one camera only") · Possible dark stretches · Businesses with no analysed building · In the register, not seen ·
    Buildings seen by camera only · Waiting for review.
  - Layers, under EXTRA CONTEXT (OFF BY DEFAULT): Where findings cluster · Road colour by findings · Street View
    coverage.
  - Layers, under VIEW: Minimap. Base map note: "Night uses the dark map. Satellite is available in Daylight."
  - Key at area zoom: Analysed road, lit · Possible dark stretch, high / medium / low priority · Possible dark
    stretch to check (road bends) · Streetlight · Not in the register · Differs from the register · Building seen by
    camera only, no map outline · 9 (street zoom) · "REGISTERS ARE SYNTHETIC (DEMO)".
- **How to confirm it's correct:** turning a layer off removes exactly those marks from the map; the Key lists only
  what is on screen.
- **Requirement it proves:** extra (§9.3 layer switcher, legend).
- **If it looks different:** Key items change with zoom. That is by design.

### ☐ E-06 · 3D and the zoom levels
- **Where:** Explore, the zoom pills OBJECT / STREET / AREA / CITY (bottom right) and **3D** (top bar).
- **Steps:**
  1. Click CITY.
  2. Click AREA.
  3. Click STREET.
  4. Click OBJECT.
  5. Toggle **3D** off and on.
- **Input:** none.
- **Expected:**
  - **CITY** (below zoom 13.5): every analysed area as an orange glow with a badge.
  - **AREA** (13.5–16.5): glowing analysed roads, black bands for dark stretches, only finding dots (pink = not in
    register, glacier blue = differs).
  - **STREET** (16.5–18.5): tilts to about 40°. Buildings are raised by floors × 3.2 m; buildings with unknown floors
    stay flat and hatched; poles are small dots, single-camera ones with a dashed circle.
  - **OBJECT** (from 18.5): closest.
  - 3D off flattens everything.
- **How to confirm it's correct:** the label under the pills shows the zoom ("zoom 15.8" at start).
- **Requirement it proves:** extra (§9.3 zoom-driven map).
- **If it looks different:** if nothing is raised in 3D, the Map ID is missing (`GOOGLE_MAP_ID`).

### ☐ E-07 · Click a street: the street panel
- **Where:** Explore, area zoom.
- **Steps:**
  1. Click the glowing line of **Sathy Main Road** (the long road on the west side).
  2. Read the panel and the ribbon.
- **Input:** none.
- **Expected:**
  - Panel "STREET · Sathy Main Road · 951 m analysed" with the lines:
    - "Sathy Main Road: 3 buildings not in the register";
    - "Sathy Main Road: 6 buildings differ from the register";
    - "600 m of Sathy Main Road has no visible streetlight";
    - "46 buildings checked · 13 streetlights and 46 poles seen".
  - Buttons **Drive this street** and **Street report**.
  - Tabs **Buildings 46 · Lights & poles 59 · Businesses 17**.
  - The ribbon switches to the street: 46 / 3 / 6 / 1 / 14, and "+ 9 seen only by camera" disappears (camera-only
    points have no street).
- **How to confirm it's correct:** Lights & poles 59 = 13 + 46. The ribbon's 3 / 6 equal the panel lines. Hood's
  street table row for Sathy Main Road reads 951 m / 46 / 3 / 6 / 14 / 13 / 1 / 600 (H-09).
- **Requirement it proves:** "Selecting a street … filters map, table and charts together" (CLAUDE.md §9.4).
- **If it looks different:** clicking the same street again clears it. That is by design.

### ☐ E-08 · The full list beside the street panel
- **Where:** the street panel.
- **Steps:**
  1. Click the tab **Lights & poles 59**.
  2. Scroll.
  3. Press Esc once.
- **Input:** none.
- **Expected:**
  - A larger "FULL LIST · Sathy Main Road" opens beside the panel, with columns SEEN / POSITION / REGISTER / REVIEW /
    ID and the footer "59 poles & streetlights".
  - The first rows are asset-0000 (Pole, no lamp seen, approximate, Seen once, waiting), asset-0006 (Streetlight),
    asset-0007 (Pole, approximate, In register).
  - Esc closes only the full list; the street panel stays open (checked).
- **How to confirm it's correct:** the row count equals the tab number (59).
- **Requirement it proves:** extra (D59 usability).
- **If it looks different:** if Esc closes the street panel too, that is the D59 bug coming back.

### ☐ E-09 · Building drawer: photo, tags, orange box, photo key
- **Where:** Explore. Type the ID in the ask bar.
- **Steps:**
  1. Click the ask bar ("Ask about this area…").
  2. Type the ID and press Enter.
- **Input:** `w1252503923` (hitech gears, Sathy Main Road).
- **Expected:**
  - The map flies to object zoom and the drawer opens: "BUILDING · hitech gears · Not in the register".
  - The Street View photo is labelled "Front · 75°" with an orange box (this building) and small tags B1 B2 L P
    S1…S12.
  - The key reads: "Orange = this building · S = part of this building · B building · P pole · S sign · L
    streetlight". It lists lines such as "S1 = shop sign "BICA", part of this building · 33%", "S9 = shop sign
    "GEARS", part of this building · 81%", "S12 = shop sign "sIW 39W" · 78%" (not part of it), and "L = streetlight
    lamp · 25%".
  - Under the photo: "1 building · 38 sign boxes in 8 photos linked to it (light-orange S tags…)".
  - Hovering a tag or a key line highlights that box.
- **How to confirm it's correct:**
  - S1–S11 say "part of this building" and S12 does not.
  - Second example `w1236978266` (sri abiraami jewellery): tags B1 B2 P1 P2 S1–S9 (S5–S8 part of the building), and
    "1 building · 32 sign boxes in 8 photos linked to it".
- **Requirement it proves:** "Click any building/asset → Street View evidence at the stored heading with its box"
  (CLAUDE.md §10 test 5). Also detection of buildings, poles, streetlights and signs.
- **If it looks different:** a black or grey photo means Google no longer serves that panorama (D60). The drawer
  then says "Current photo · no boxes". Today every Ward 29 example showed "Photo from Feb 2026" with boxes.

### ☐ E-10 · "How do we know? (everything the detector found)" and "Which box"
- **Where:** the same drawer, under the photo.
- **Steps:** click **How do we know? (everything the detector found)**.
- **Input:** none.
- **Expected:** for hitech gears:
  - "The detector marked 17 things in this photo, now all drawn." Counts: building 3, pole 1, lamp 1, sign 12.
  - "This photo: The same photo the analysis used: facing 75°, tilted 0°, 90° wide."
  - "Which box: The orange box is the building box that best covers the part of this building the camera can see
    (other outlines on the map hide the rest). It is also the box the analysis used."
  - "Taken: Feb 2026 · panorama capture month (Google)" and "Photo ID J7KedfQcUwzHQb3E13az9g".
- **How to confirm it's correct:** 3 + 1 + 1 + 12 = 17. "It is also the box the analysis used" holds for every Ward
  29 building, because the re-run uses M3 at level 2: the box shown is the box used (D64).
- **Requirement it proves:** extra (transparency).
- **If it looks different:** "the analysis used a different box" can only appear on areas analysed before D64 (for
  example Trichy).

### ☐ E-11 · "Can't tell which box is this building"
- **Where:** Explore, area **Unnamed road between Bharathiar Road and Sankara Linganar Street**.
- **Steps:**
  1. Pick the area (E-01).
  2. Type the ID in the ask bar.
- **Input:** `ms_11.047564_76.969306` (kk odaam).
- **Expected:** the Front photo has **no orange box**, and the line under it reads "Can't tell which box is this
  building in this photo." The other boxes and tags stay. (Checked through the API: the Front view's `box_choice` is
  `cant_tell`.)
- **How to confirm it's correct:** How do we know? → "Which box" explains the 0.4 overlap rule.
- **Requirement it proves:** extra (honest evidence, D62).
- **If it looks different:** none in Ward 29, by construction (D64). Use this area.

### ☐ E-12 · Photo date and "Imagery may be outdated"
- **Where:** a building drawer.
- **Steps:** type `w1252504670` (a building on 8th Street, Ganapathy) in the ask bar.
- **Input:** `w1252504670`.
- **Expected:**
  - At the top: "Imagery may be outdated. The newest Street View photo of this spot is from Jul 2018, more than 3
    years ago. The street may have changed since, so check before acting on this."
  - The photo is labelled "Nearest camera · 172°", because no clear photo of this building was matched.
- **How to confirm it's correct:** Under the Hood → Coverage says "8 missing or not-in-register findings marked
  'imagery may be outdated'". The API's `imagery.outdated_findings` gives building 3, asset 3, gap 1, missing 1 = 8.
- **Requirement it proves:** extra (P8).
- **If it looks different:** most Ward 29 photos are "Photo from Feb 2026". The note shows only on older ones.

### ☐ E-13 · Front / Sign buttons and Live 360°
- **Where:** hitech gears drawer (E-09).
- **Steps:**
  1. Click **Sign**.
  2. Click **Live 360°**.
  3. Drag to look around.
  4. Press Esc.
- **Input:** none.
- **Expected:**
  - **Sign:** the photo changes to "Sign · 110°", key "Orange = this building's sign", tags S1–S5.
  - **Live 360°:** the map fades into Google's panorama. The top reads "Back to map · Live Street View · drag to look
    around · Esc to return". Pins in the panorama: "Differs 14 m", "This building 14 m", "Streetlight · approx. 10 m".
  - **Esc:** back to the map (checked: the 360° mode ended).
- **How to confirm it's correct:** the Google logo and "© 2026 Google" stay visible in the panorama.
- **Requirement it proves:** "the map cross-fades into an embedded StreetViewPanorama at the stored
  pano_id/heading/pitch" (§9.3) and Google attribution (§9.6).
- **If it looks different:** a black panorama means the browser key lacks the Street View API.
- **Cost:** one dynamic Street View load (Google, your key).

### ☐ E-14 · What we saw: use, floors and floor confidence
- **Where:** building drawers, section WHAT WE SAW.
- **Steps:** open each ID below in turn.
- **Input:**
  - `w1252503923`;
  - `w1236978266`;
  - `w1252504103`;
  - `w1247745270`.
- **Expected:**
  - hitech gears: Use Commercial · Floors "2 floors · High confidence: counted from the photo, roof line visible".
  - sri abiraami jewellery: "3 floors · Medium confidence: counted from the photo; taller buildings tend to be
    under-counted a little".
  - Prevent (`w1252504103`): "2 floors (estimate) · Low confidence: an estimate: the roof was not visible in the
    photo".
  - anna bakery (`w1247745270`): "1 floor · High confidence…" and "OpenStreetMap says 10 floors (volunteer map, a
    cross-check)".
- **How to confirm it's correct:**
  - The Excel sheet "Buildings with findings" has "Floor-count confidence" Medium for w1236978266 and Low for
    w1252504103 (P-02).
  - Trust → OpenStreetMap cross-checks lists "w1247745270 … OpenStreetMap 10, ours 1".
- **Requirement it proves:** building attributes (use, visible floors).
- **If it looks different:** "Floors not known · no usable photo of the building to count floors" is correct for
  buildings without a clear photo (197 of 373).

### ☐ E-15 · Frontage, position and the Gate 1 line
- **Where:** WHAT WE SAW → Frontage and Position, then How do we know? → Position check and Front wall.
- **Steps:** open each ID and read the Position row.
- **Input:** `w1236978266`, `w1252503923`, `w1247745084`, `w1252504103`.
- **Expected:**
  - sri abiraami jewellery: "Frontage 14.8 m along the street, from the map outline". Position "2.3 m from the
    middle of the front wall on the map (target ≤ 3.5 m) · within". How do we know? → Position check: "The
    predicted point (where camera views cross) is 2.33 m … this area's camera-derived row is n = 240, median
    2.52 m, 67.5% within 3.5 m. Gate 1 status on Trust: not verified."
  - hitech gears: 8.7 m frontage. Position 0.7 m, within, "measured from where 5 camera views cross".
  - UberMato (`w1247745084`): 19.8 m frontage. Position "4.8 m … outside", "Front wall chosen: the one facing
    Korathottam Road (a corner building: another wall faces a street too)".
  - Prevent (`w1252504103`): "Position taken from the map outline — error not measured."
- **How to confirm it's correct:** Trust → Building position (Gate 1) → "Ward 29, Coimbatore · All camera-derived
  positions … 240 · 2.52 m · 6.79 m · 67.5%" is the same n / median / % quoted in the drawer.
- **Requirement it proves:** FarmwiseAI Gate 1, "predicted building position … ≤ 3.5 m"
  (`docs/explainer/01_WHAT_AND_WHY.md` §2.2).
- **If it looks different:** "0 m" anywhere for a building placed from the map would be a bug. Map-placed buildings
  must say "error not measured".

### ☐ E-16 · What the register says, and "Reviewer says"
- **Where:** drawer section WHAT THE REGISTER SAYS, then REVIEW.
- **Steps:** open `w1247745084`, then `w1236978266`, then `w1252504103`.
- **Input:** those IDs.
- **Expected:**
  - **UberMato:** "synthetic register (demo) · Listed as a home with 1 floor." and "The register says 1 floor; the
    photo shows 2." How do we know? → Record number **P-0259**; "Paired by Location: the record's pin is 0 m from
    this building, so the pairing is clear (the next building would fit 24.5 m worse)… match confidence high";
    Record says "residential · 1 floor · 263 m²"; Result "Differs from the register: more floors than recorded".
    REVIEW: "Waiting for review · THE QUESTION: The register says 1 floor, the photo suggests 2 floors. Is the photo
    right?" with Yes / No / "Not sure? Send back with a note".
  - **sri abiraami jewellery:** "No record for this building." Question: "Is there a building here that's missing
    from the register?"
  - **Prevent:** record P-0051 "residential · 2 floors · 135 m²". Question: "The register says residential, the
    photo suggests commercial. Is the photo right? Also, if you can tell: Does this building have 2 floors? (after
    No you can give the right value)".
  - "Reviewer says: …" appears in orange under Floors only after a No with a value (R-05); today none is stored.
- **How to confirm it's correct:** the Excel row for w1247745084 reads "P-0259 · Residential · 1 floor · 263 m² ·
  pin 0 m away" and "Differs from the register: more floors than recorded" (P-02).
- **Requirement it proves:** "Matching against at least one property or infrastructure reference dataset" (one of
  the seven mandatory capabilities) and the "matched record" column.
- **If it looks different:** the "synthetic register (demo)" tag must be on every register block. If one is
  missing, report it.

### ☐ E-17 · Drawer extras: sign, name check, cost, condition withheld
- **Where:** a building drawer → How do we know?.
- **Steps:** open `w1236978266` and expand the first How do we know?.
- **Input:** `w1236978266`.
- **Expected:**
  - Use: "Decided by a small built-in model (no cloud AI)… On 30 of this run's buildings: 77% routed, 73% with the
    AI check on every building. · T1 · local CLIP router".
  - Floors: "T3 · VLM few-shot". Sign / name: "T3 · VLM + OCR gate".
  - Sign text read: ""STOP", the text reader was 100% sure".
  - Door numbers: "1000/3 (not confirmed)".
  - Condition: "Not shown: our condition check was not accurate enough (see Trust) · withheld".
  - Google check: "The sign name is not on Google Maps within 40 m".
  - AI checks: "1 AI image check, cost $0.0002".
- **How to confirm it's correct:** the route badges T1 / T2 / T3 match Under the Hood step 06 (109 local / 67 cloud /
  29 from a sign for use).
- **Requirement it proves:** "attributes each with a route badge (Tier 1 … Tier 3)" (§9.4) and routing to the VLM
  "only for low-confidence building use, floor count or complex scenes".
- **If it looks different:** a "Condition: good / poor" value shown as a finding would break the rule that condition
  is withheld.

### ☐ E-18 · Pole and streetlight drawers
- **Where:** Explore, ask bar.
- **Steps:** type each ID and press Enter.
- **Input:** `asset-0007`, `asset-0000`, `asset-0002`.
- **Expected:**
  - **asset-0007:** "POLE, NO LAMP SEEN · Sathy Main Road · In the register". "1 pole on the map · seen in 3 photos
    (the same pole in several photos, merged into one)". Position "Approximate: about ±2.6 m (one camera, 6 m
    away)". How far off: "8 in 10 single-camera estimates of poles that two cameras pinpointed were within 2.6 m (a
    consistency check)". Register "Listed as EB-0003". The photo line: "No box was found in the aimed direction: the
    cross marks where the camera was aimed, not a detection."
  - **asset-0000:** "Seen in one photo only: needs a second look". "Approximate: about ±5 m (one camera, 9 m away)…
    about half of such poles fall inside this circle". Question "Is there a pole in the orange box?".
  - **asset-0002:** "STREETLIGHT · 2nd Street, Ganapathy Gardens (approx.) · Differs from the register". "Pinpointed:
    seen from 2 camera positions", "±0.5 m". Register "Listed as EB-0001, but it differs: recorded as a different
    type" (listed as pole). "Not waiting for review."
- **How to confirm it's correct:** Trust → Pole & light positions shows the circles ±2.6 m (0–8 m) and ±5 m (8–15 m)
  used here.
- **Requirement it proves:** detection of poles and streetlights, positions on the map, and matching an
  infrastructure reference (asset register, synthetic).
- **If it looks different:** "±2.4 m" is the pre-D65 circle.

### ☐ E-19 · Business with no analysed building (sign drawer)
- **Where:** ask bar.
- **Steps:** type each ID and press Enter.
- **Input:** `ub-0001`, `ub-0000`.
- **Expected:**
  - **ub-0001:** "BUSINESS WITH NO ANALYSED BUILDING · ponmani steel house · Sathy Main Road", photo "Sign · 272°",
    "Orange = this sign". "A shop sign was read here, but the map has no building outline at this spot, so it can't
    be matched to the register." Seen in 5 photos; "Sign text read "PONMANI" · OCR"; position "About 12 m from the
    camera, along its line of sight".
  - **ub-0000:** "dsk associates · 2nd Street, Gandhi Nagar", "on a building outline that is not one of the analysed
    buildings… (w1236978188)", seen in 2 photos.
- **How to confirm it's correct:** the More menu shows "Businesses with no analysed building 23"; Hood step 05 says
  "23 businesses were found on no analysed building".
- **Requirement it proves:** detection of shop signs (OCR).
- **If it looks different:** ub-0000's "How do we know?" also says "OpenStreetMap has no building outline here",
  although it sits on outline w1236978188. This wording mismatch was seen today; it is cosmetic.

### ☐ E-20 · Building seen by camera only
- **Where:** Explore at street zoom near the Sathy Main Road flyover (around 11.0297, 76.9752).
- **Steps:**
  1. Zoom to STREET near the flyover.
  2. Click an orange diamond.
- **Input:** none (the example is cb-004).
- **Expected:**
  - Drawer "BUILDING SEEN BY CAMERA ONLY · No map outline here · Not an analysed building (no register check)".
  - "Lines of sight to a shop sign from 4 camera positions cross here, but the map has no building outline at this
    spot."
  - "No map outline for this building — error can't be measured."
  - "About ±2.3 m: every camera line of sight passes within that of this point".
- **How to confirm it's correct:** the Key at street zoom lists "Building seen by camera only, no map outline · 9";
  the ribbon says "+ 9 seen only by camera".
- **Requirement it proves:** extra (coverage honesty).
- **If it looks different:** 47 diamonds means the D65 "inside the area only" rule was lost.

### ☐ E-21 · Possible dark stretches: the list, priority, Fix first / Longest first
- **Where:** ribbon → **11 POSSIBLE DARK STRETCHES**.
- **Steps:**
  1. Click the card.
  2. Read the order.
  3. Click **Longest first**.
  4. Click **Fix first**.
- **Input:** none.
- **Expected:**
  - Heading "11 stretches of road with no visible streetlight · 2,487 m in 11 stretches: High 5 · Medium 1 · Low 5."
  - The caution "Possible, not certain: the detector finds about 43% of lamp heads in a photo (checked by hand on 49
    lamps)…"
  - **Fix first** order: 600 m Sathy Main Road (High, "600 m on a main road, 47 shops and businesses along it") ·
    193 m Ganapathy - Avarampalayam Road (High) · 142 m Sakthi Main Road (High) · 414 m 8th Street, Ganapathy (High)
    · 275 m 2nd Cross Road, Gandhi Nagar (approx.) (High) · 218 m 2nd Street, Ganapathy Gardens (approx.) (Medium) ·
    171 m 4th Street, Tatabad / Vinobaji Street (Low) · 118 m 2nd Street, Gandhi Nagar · 166 m Sri Ganapathy Gardens
    3rd Street (approx.) ("Needs checking on the ground: the road bends here…") · 99 m and 91 m Korathottam Road.
  - **Longest first:** 600, 414, 275, 218, 193, 171, 166, 142, 118, 99, 91.
- **How to confirm it's correct:**
  - The lengths add up: 600 + 414 + 275 + 218 + 193 + 171 + 166 + 142 + 118 + 99 + 91 = 2,487 m, matching Hood step
    10's "2,487 m".
  - Points (length + road + shops, each 0–3): Sathy 3 + 3 + 3 = 9; the Excel sheet "Possible dark stretches" row 1
    says "3 + 3 + 3 = 9".
- **Requirement it proves:** "Show streets where no streetlight is detected within 60 m → gap segments highlighted,
  list sorted by length" (CLAUDE.md §10 test 2).
- **If it looks different:** 2,019 m / High 3 · Medium 3 · Low 5 / "376 m on Sathy Main Road" is the old Sep run.

### ☐ E-22 · Click a stretch card: highlight on the map, and the stretch drawer
- **Where:** the dark-stretch list.
- **Steps:**
  1. Click the **600 m of Sathy Main Road** card.
  2. Click it again.
  3. Click it once more and press Esc.
  4. Close the list, then click the black band on Sathy Main Road on the map.
- **Input:** none.
- **Expected:**
  - Step 1: the card shows "Shown on the map · click again or press Esc to clear"; the map frames that stretch with
    an orange outline and the others fade.
  - Steps 2–3: the highlight clears and the list stays open.
  - Step 4: the drawer "POSSIBLE DARK STRETCH · 600 m of Sathy Main Road has no visible streetlight · High priority".
    "34 poles stand here, but no lamp was seen on them." How do we know? → "Along the bends ≈ 660 m following the
    road: within 10% of the straight-line length"; "Priority High: length 3 + road 3 (OpenStreetMap: trunk) + shops
    and businesses within 30 m 3 = 9 of 9 points"; ID gap60-001.
- **How to confirm it's correct:** the same 9 points appear in the Excel stretch sheet (P-02).
- **Requirement it proves:** §10 test 2 (gap segments highlighted).
- **If it looks different:** if the list closes when you click a card, D57 regressed.

### ☐ E-23 · Drive the street
- **Where:** street panel → **Drive this street**.
- **Steps:**
  1. Select Sathy Main Road (E-07).
  2. Click **Drive this street**.
  3. Step forward a few stops.
- **Input:** none.
- **Expected:**
  - "DRIVE THE STREET · Sathy Main Road · 803 m · 34 camera stops", pieces "Main line · 803 m" and "Side piece 1 ·
    111 m".
  - "stop 1/34 · 16 m", a Left / Forward / Right photo, and the strip "Possible dark stretch: no streetlight seen ·
    600 m of this road".
  - "so far: 0 streetlights · 4 poles · 0 buildings with a finding".
  - The cost line "Each stop you stop at loads one Street View image (≈ $0.007)…"
- **How to confirm it's correct:** the stop count matches the camera stops for this street in Hood (the street table
  lists 40 cameras for all of Sathy Main Road; the drive uses the main line's 34).
- **Requirement it proves:** extra.
- **If it looks different:** a black stop photo means a retired panorama. It should show "Current photo · …"
  instead.
- **⚠ Cost:** one Street View image per stop you stop on ($0.007 list price, Google).

---

## 3. Questions (the ask bar)

The ask bar does **not** use an AI model. It reads the question with fixed rules (QueryEngine) and shows what it
understood as editable **chips** (small filter buttons). The same question always gives the same answer.

### ☐ Q-01 · Example questions on focus
- **Where:** Explore, ask bar.
- **Steps:** click the ask bar.
- **Input:** none.
- **Expected:** six examples:
  - "Commercial buildings with more than 2 floors and no record";
  - "Streets where no streetlight is detected within 60 m";
  - "High priority dark stretches";
  - "Chart of unmatched buildings by street";
  - "Low-confidence floor counts for review";
  - "Not-in-register buildings within 50 m of a possible dark stretch".
- **How to confirm it's correct:** Ctrl K → "Example questions (spec)" lists the four spec sentences (K-03).
- **Requirement it proves:** plain-English queries.
- **If it looks different:** fewer examples means the area's streets did not load.

### ☐ Q-02 · Spec question 1: commercial, more than two floors, no matching record
- **Where:** ask bar → result panel.
- **Steps:** paste the sentence and press Enter. Repeat with each variation.
- **Input:**
  - "Show commercial buildings with more than two visible floors that do not have a matching property record."
  - Variation: "Commercial buildings with more than 2 floors and no record"
  - Variation: "Show all the commercial buildings that are more than 2 floors and have no record"
- **Expected:**
  - Chips: **Show Buildings · Use shops & businesses · Floors more than 2 · Register not in the register**.
  - "1 building": **sri abiraami jewellery · Sakthi Main Road · Not in register** (w1236978266, 3 floors, measured).
  - All three wordings give the same chips and the same 1 row, with nothing ignored.
- **How to confirm it's correct:**
  - Open the row: its drawer says Commercial, "3 floors · Medium confidence", "Not in the register" (E-14, E-16).
  - Change the Floors chip to "more than 1" → 2 rows (adds hitech gears, 2 floors). The API gave the same 1 and 2.
- **Requirement it proves:** "Show commercial buildings with more than two visible floors that do not have a matching
  property record" (§10 test 1).
- **If it looks different:**
  - 0 rows with the funnel 381 → 27 → 5 → 2 → 0 is the old Sep run.
  - The list footer says "1 buildings" (a plural slip seen today); it is cosmetic.

### ☐ Q-03 · An empty answer explains itself (the why-empty funnel)
- **Where:** ask bar.
- **Steps:** paste and press Enter.
- **Input:** "Show commercial buildings with more than two visible floors that differ from the register"
- **Expected:**
  - Chips: Buildings · shops & businesses · more than 2 · differs from it.
  - "No buildings match — here is why": All buildings checked 373 → differ from the register 54 → shops & businesses
    (incl. shop + home) 13 → floors could be counted 5 → more than 2 floors 0.
  - "None of the 5 left after "floors could be counted" are "more than 2 floors"."
- **How to confirm it's correct:** 54 equals the Differ card. Remove the Floors chip → 13 rows.
- **Requirement it proves:** §10 test 1 ("or why_empty funnel").
- **If it looks different:** a blank panel with no funnel is a bug.

### ☐ Q-04 · Spec question 2: no streetlight within 60 m
- **Where:** ask bar.
- **Steps:** paste and press Enter, then try the variations.
- **Input:**
  - "Show streets where no streetlight is detected within 60 m"
  - Variation: "Show street segments where no streetlight was detected within 60 metres."
  - Variation: "Which streets have no streetlight within 60 metres?"
- **Expected:** chips **Show Possible dark stretches · Within 60 m**. "11 possible dark stretches · 2,487 m in 11
  stretches: High 5 · Medium 1 · Low 5." The same Fix first order as E-21; the bands are outlined on the map.
- **How to confirm it's correct:** 11 equals the ribbon card; the Longest first button gives 600, 414, 275….
- **Requirement it proves:** "Show streets where no streetlight is detected within 60 m" (§10 test 2).
- **If it looks different:** a different count for the variations means a synonym rule broke (`docs/QUERY.md`).

### ☐ Q-05 · Other distances (computed by the app)
- **Where:** ask bar.
- **Steps:** paste and press Enter.
- **Input:** "Streets where no streetlight is detected within 100 m"
- **Expected:** 7 stretches, labelled "computed by the app with the pipeline's method". The first is gap100-002 Sathy
  Main Road 571 m (High), then 8th Street, Ganapathy 414 m.
- **How to confirm it's correct:** fewer than at 60 m (11), as expected for a longer distance.
- **Requirement it proves:** extra (the spec asks only 60 m).
- **If it looks different:** "can't be computed" appears only for areas with no camera plan.

### ☐ Q-06 · Spec question 3: low-confidence floor counts → review queue
- **Where:** ask bar, then **Send 3 to Review**.
- **Steps:**
  1. Paste the sentence and press Enter.
  2. Click **Send 3 to Review**.
- **Input:**
  - "Display only low-confidence floor-count predictions and create a review queue."
  - Variation: "Low-confidence floor counts for review"
- **Expected:**
  - Chips **Show Review items · Reason low-confidence floor count**.
  - "3 review items": Prevent · 4th Street, Tatabad / Vinobaji Street (Differs, P2) · Commercial · Korathottam Road
    (Matches, P4) · Commercial · Sathy Main Road (Matches, P4).
  - The button opens Review with only those 3.
- **How to confirm it's correct:**
  - Review → Reason filter "Floor count is an estimate (roof not visible) (3)" (R-01).
  - Hood step 07 "Floors … estimated for 3".
  - The building IDs are w1252504103, w1247745169 and w1252504900.
- **Requirement it proves:** "Display only low-confidence floor-count predictions and create a review queue" (§10
  test 3).
- **If it looks different:** 4 items is the old Sep run.

### ☐ Q-07 · Spec question 4: chart of unmatched buildings by street
- **Where:** ask bar.
- **Steps:** paste and press Enter, then try the variations.
- **Input:**
  - "Chart of unmatched buildings by street"
  - Variation: "Generate a chart of unmatched buildings by street."
  - Variation: "Create a bar chart of the unmatched buildings by street"
- **Expected:**
  - Chips **Buildings · not in the register · Chart by street**.
  - "22 buildings on 10 streets · Click a street to zoom the map to it. Synthetic register (demo)."
  - Bars: 2nd Street, Ganapathy Gardens (approx.) 4 · Ganapathy - Avarampalayam Road 3 · Sathy Main Road 3 · 4th
    Street, Tatabad / Vinobaji Street 2 · 2nd Street, Gandhi Nagar 2 · Sri Ganapathy Gardens 3rd Street (approx.) 2 ·
    Korathottam Road 2 · Sakthi Main Road 2 · 8th Street, Ganapathy 1 · 2nd Cross Road, Gandhi Nagar (approx.) 1.
- **How to confirm it's correct:** the bars add up to 22 = the Not in register card. Each bar equals the "not in
  reg." column of Hood's street table (H-09).
- **Requirement it proves:** "Chart of unmatched buildings by street" (§10 test 4) and "database-match status"
  charts.
- **If it looks different:** a bar above 4 on Korathottam Road (9) is the old run.

### ☐ Q-08 · The 50 m question (distance to a dark stretch)
- **Where:** ask bar.
- **Steps:**
  1. Paste and press Enter.
  2. Change the "Dark stretch" chip to 100 m.
- **Input:** "Show not-in-register buildings within 50 m of a possible dark stretch"
- **Expected:**
  - Chips **Register not in the register · Dark stretch within 50 m**.
  - "15 buildings". "Kept the buildings whose outline lies within 50 m of a possible dark stretch as the map draws it…
    15 of 22 matching buildings are that close."
  - Rows include sri abiraami jewellery and hindustan (Sakthi Main Road), and MACAOECATMA.
  - At 100 m: 20 (API: "within 100 m … 20").
- **How to confirm it's correct:** 22 = the Not in register card, and 15 ≤ 22.
- **Requirement it proves:** extra (spatial question, D53).
- **If it looks different:** "partly understood" means the database (PostGIS) part is off. It needs the database,
  not offline mode.

### ☐ Q-09 · High-priority dark stretches
- **Where:** ask bar.
- **Steps:**
  1. Paste and press Enter.
  2. Change the Priority chip to Low.
- **Input:** "High priority dark stretches"
- **Expected:** chips **Possible dark stretches · Within 60 m · Priority High**. "5 possible dark stretches · 1,624 m
  in 5 stretches: High 5." The rows: Sathy Main Road 600, Ganapathy - Avarampalayam Road 193, Sakthi Main Road 142,
  8th Street, Ganapathy 414, 2nd Cross Road, Gandhi Nagar (approx.) 275. Low gives 5.
- **How to confirm it's correct:** 600 + 193 + 142 + 414 + 275 = 1,624 m.
- **Requirement it proves:** extra (D54).
- **If it looks different:** 3 high stretches is the old run.

### ☐ Q-10 · Businesses near an OpenStreetMap point
- **Where:** ask bar.
- **Steps:**
  1. Paste and press Enter.
  2. Then ask the second question.
- **Input:** "Businesses near an OpenStreetMap point", then "Businesses not in OpenStreetMap"
- **Expected:**
  - First question: **10 businesses**, with the note "Our camera found 141 businesses here; OpenStreetMap lists 14
    along these streets: 10 near each other (location only; names didn't match), 131 seen by our camera only, 4 in
    OpenStreetMap only."
  - Example rows: "hindustan · Sakthi Main Road · OpenStreetMap: KR Restarunt, 0 m, names don't match"; "Gowra · Sathy
    Main Road · OpenStreetMap: Kannan Departmental Stores, 1 m, names don't match".
  - Square tags on the map are OpenStreetMap's points.
  - Second question: **131**.
- **How to confirm it's correct:** 10 + 131 = 141. Hood → Businesses vs OpenStreetMap shows 141 / 14 / 10 / 131 / 4 /
  4 (H-12).
- **Requirement it proves:** extra (OpenStreetMap as an outside reference).
- **If it looks different:** "Matched (same place)" anywhere would be the old wording (D59 removed it).

### ☐ Q-11 · Tamil questions
- **Where:** ask bar.
- **Steps:** paste each and press Enter.
- **Input:**
  - "பதிவேட்டில் இல்லாத கடைகள்" (shops not in the register)
  - "60 மீட்டருக்குள் தெருவிளக்கு இல்லாத தெருக்களைக் காட்டு" (streets with no streetlight within 60 m)
  - "இரண்டு மாடிகளுக்கு மேல் உள்ள பதிவேட்டில் இல்லாத கடைகள்" (shops with more than two floors not in the
    register)
  - "குறைந்த நம்பகத்தன்மை மாடி மறுஆய்வு" (low-confidence floors, review)
  - "பதிவேட்டில் இல்லாத கட்டிடங்கள் தெரு வாரியாக" (buildings not in the register, by street)
- **Expected:**
  1. 6 buildings: Commercial · 2nd Street, Gandhi Nagar; MACAOECATMA; anna bakery; sri abiraami jewellery; hindustan;
     hitech gears.
  2. 11 possible dark stretches.
  3. 1 building (sri abiraami jewellery), the same as Q-02.
  4. 3 review items, the same as Q-06.
  5. The by-street chart of 22, the same as Q-07.
  - Nothing is ignored; each Tamil phrase is shown as a rewrite (e.g. "பதிவேட்டில் இல்லாத → no record").
- **How to confirm it's correct:** each answer equals its English twin.
- **Requirement it proves:** extra (P8).
- **If it looks different:** "partly understood" with a Tamil word ignored means a stem rule is missing
  (`docs/QUERY.md`).

### ☐ Q-12 · A question it only partly understands
- **Where:** ask bar.
- **Steps:** paste and press Enter.
- **Input:** "high priority commercial buildings"
- **Expected:** ""high priority commercial buildings" · I understood only part of this question. Understood: shops &
  businesses · Ignored: 'high priority' · Show the 83 buildings for what I understood". Nothing changes on the map
  until you accept.
- **How to confirm it's correct:** "show trees" gives "not understood", with 'trees' ignored.
- **Requirement it proves:** extra (honest query parsing).
- **If it looks different:** if the map filters before you accept, the safety step is broken.

### ☐ Q-13 · Other useful questions
- **Where:** ask bar.
- **Steps:** paste each and press Enter.
- **Input:**
  - "Poles on Sathy Main Road"
  - "Buildings that differ from the register on Korathottam Road"
  - "Show shops not on Google"
- **Expected:**
  - 46 poles.
  - 7 buildings (first: UberMato).
  - 36 buildings, with the note "36 shops & businesses (commercial or mixed use) have a sign name that was not found
    on Google within 40 m. In the whole area 66 named buildings are not on Google…".
- **How to confirm it's correct:** 46 = the street panel's poles (E-07); 7 = Korathottam Road's "differ" in Hood's
  street table.
- **Requirement it proves:** extra.
- **If it looks different:** a loose street name such as "sathy road" must still map to Sathy Main Road.

---

## 4. Charts

### ☐ C-01 · Building use chart
- **Where:** ribbon → **373 BUILDINGS CHECKED** → tab **Use**.
- **Steps:** click the card, then **Use**.
- **Input:** none.
- **Expected:** Not known (no clear photo) 168 · Residential 107 · Commercial 82 · Other 10 · Institutional 3 ·
  Industrial 2 · Shop + home 1.
- **How to confirm it's correct:** the bars add up to 373. "Not known" equals the Use not known card (168). Hood step
  07's line "Use: not classified 168 · residential 107 · commercial 82…" matches.
- **Requirement it proves:** "Charts: building use" (§9.4).
- **If it looks different:** "Not known" must be shown, never hidden.

### ☐ C-02 · Floors chart
- **Where:** same panel → tab **Floors**.
- **Steps:** click **Floors**.
- **Input:** none.
- **Expected:** "Only buildings whose floors could be counted (173 of 373)." 1 floor 39 · 2 floors 111 · 3 floors 21 ·
  4 floors 2.
- **How to confirm it's correct:** 39 + 111 + 21 + 2 = 173 = Hood step 07 "Floors were measured for 173".
- **Requirement it proves:** "floor distribution [measured only, note n]" (§9.4).
- **If it looks different:** if estimated floors (3) are included, n would read 176.

### ☐ C-03 · How they differ (difference types)
- **Where:** ribbon → **54 DIFFER FROM REGISTER** → **How they differ**.
- **Steps:** click the card, then the tab.
- **Input:** none.
- **Expected:** "A building can differ in more than one way." Record pinned in the wrong place 18 · bigger than
  recorded 18 · more floors than recorded 11 · used differently than recorded 8.
- **How to confirm it's correct:**
  - Review reason counts: Extra floor vs register (11), Use differs from register (8) (R-01).
  - Trust register test, Ward 29 row: planted 78 (22 missing + 19 location + 18 area + 8 use + 11 floor).
- **Requirement it proves:** "discrepancy types" chart (§9.4).
- **If it looks different:** the sum (55) is above 54 because one building has two differences. That is expected.

### ☐ C-04 · Unmatched by street → click a bar → the map zooms
- **Where:** Q-07's chart (or ribbon → 22 → **By street**).
- **Steps:**
  1. Ask "Chart of unmatched buildings by street".
  2. Click the **Korathottam Road** bar.
- **Input:** "Chart of unmatched buildings by street"
- **Expected:** the map flies to Korathottam Road (checked: zoom 16.05 → 16.4, centre moved to 11.0338, 76.9878),
  the street becomes the selected street, the ribbon shows **40 / 2 / 7 / 2 / 26**, and the bar is highlighted.
- **How to confirm it's correct:** the ribbon's 2 equals the bar's 2; the street table row for Korathottam Road (H-09)
  reads 40 buildings / 2 / 7 / 26.
- **Requirement it proves:** "Chart of unmatched buildings by street → bar chart; clicking a bar zooms the map to
  that street" (§10 test 4).
- **If it looks different:** if the map doesn't move, the bar's click handler broke.

### ☐ C-05 · Use not known by street
- **Where:** ribbon → **168 USE NOT KNOWN** → **By street**.
- **Steps:** click the card, then the tab.
- **Input:** none.
- **Expected:** 2nd Street, Ganapathy Gardens (approx.) 27 · Korathottam Road 26 · 2nd Street, Gandhi Nagar 21 · 4th
  Street, Tatabad / Vinobaji Street 21 · 8th Street, Ganapathy 18 · Sri Ganapathy Gardens 3rd Street (approx.) 16 ·
  2nd Cross Road, Gandhi Nagar (approx.) 15 · Sathy Main Road 14 · Ganapathy - Avarampalayam Road 10.
- **How to confirm it's correct:** these equal Hood's "use ?" column; Sakthi Main Road (0) has no bar.
- **Requirement it proves:** extra.
- **If it looks different:** —

---

## 5. Review

Review is where a person answers each uncertain item. **Yes** (key A) means the finding is right. **No** (key R)
means it is wrong. **E** sends it back with a note. **U** undoes the last decision. Decisions never change the
model's values, the register or the numbers on the map; they are stored next to them.

### ☐ R-01 · The queue and its filters
- **Where:** left rail → **Review**.
- **Steps:**
  1. Open Review.
  2. Read the header.
  3. Open each filter (Status, Priority, Street, Reason).
- **Input:** none.
- **Expected:**
  - "REVIEW · MOST URGENT FIRST · 221 waiting · Reviewing as <your name> · This session: 0 decisions".
  - Priority: P1 (23) · P2 (19) · P3 (3) · P4 (2) · P5 (16) · P6 (158).
  - Street: Sathy Main Road (50) · Korathottam Road (28) · 2nd Street, Gandhi Nagar (27) · 2nd Street, Ganapathy
    Gardens (approx.) (25) · 2nd Cross Road, Gandhi Nagar (approx.) (20) · Ganapathy - Avarampalayam Road (17) · 4th
    Street, Tatabad / Vinobaji Street (16) · Sri Ganapathy Gardens 3rd Street (approx.) (16) · 8th Street, Ganapathy
    (13) · Sakthi Main Road (9).
  - Reason: Seen in one photo only (158) · Seen from one camera position only (27) · Not in the register (22) · Extra
    floor vs register (11) · Use differs from register (8) · Floor count is an estimate (roof not visible) (3) · Shop
    name read by the AI model only (3) · Bigger than recorded (1) · Register pin in the wrong place (1).
  - The first item: "Building on 8th Street, Ganapathy · P1 · Not in the register · Seen from one camera position
    only".
- **How to confirm it's correct:**
  - The priorities add up: 23 + 19 + 3 + 2 + 16 + 158 = 221 = the rail badge = the More menu's "Waiting for review".
  - The streets add up to 221.
  - The Sathy Main Road street PDF lists 50 review items (P-03).
- **Requirement it proves:** "Review — full-screen queue (priority, reasons, filters)" (§9.4) and the human review
  workflow (CLAUDE.md §1).
- **If it looks different:** "218 waiting" is the old run. The first visit asks for your name: "Your name is saved
  with each decision (asked once, no login)".

### ☐ R-02 · Each reason asks its own question
- **Where:** Review → Reason filter → pick each reason → click the first item → right column "THE QUESTION".
- **Steps:** pick each reason in turn.
- **Input:** none.
- **Expected:**
  - Seen in one photo only → "Is there a pole in the orange box?"
  - Seen from one camera position only / Not in the register → "Is there a building here that's missing from the
    register? Seen from one camera position only, so look closely."
  - Extra floor vs register → "The register says 1 floor, the photo suggests 2 floors. Is the photo right?"
  - Use differs from register → "The register says residential, the photo suggests commercial. Is the photo right?"
  - Floor count is an estimate → "Does this building have 1 floor?" (Korathottam Road item) or, for Prevent, the
    use question plus "Also, if you can tell: Does this building have 2 floors?"
  - Shop name read by the AI model only → "Does the sign say "car care"?"
  - Bigger than recorded / Register pin in the wrong place → "The photo and the register differ. Is the photo
    right? • The register's pin for this building is 25 m away from it. • The register says 74 m², the map outline
    is 128 m²."
- **How to confirm it's correct:** each question matches the reason in the item's list line.
- **Requirement it proves:** human review workflow.
- **If it looks different:** "Why a person should check" instead of "THE QUESTION" is pre-D59 wording.

### ☐ R-03 · ⚠ Answer Yes, read the saved line, then Undo
- **Where:** Review, filter Reason = "Floor count is an estimate (roof not visible) (3)", second item (Commercial on
  Korathottam Road, w1247745169).
- **Steps:**
  1. Click the item.
  2. Press **A** (or click Yes).
  3. Read the result.
  4. Press **U** (or click Undo).
- **Input:** none.
- **Expected:**
  - After A: "Answered Yes ✓ · Undo U · Saved: reviewer confirmed 1 floor. · Commercial on Korathottam Road · Show its
    history". The header says **220 waiting** and the queue moves to the next item.
  - After U: "Undone: Commercial on Korathottam Road is back to how it was." The header says **221 waiting**. The
    item's HISTORY shows "Answered Yes by <you> · just now (undone)" and "Undo · back to waiting for review".
- **How to confirm it's correct:** `http://127.0.0.1:8000/review?area=ward29&page_size=500` → `total` 221, all
  `pending`. That was checked after this exact round trip today.
- **Requirement it proves:** "Status persists via API and updates the map" (§9.4 Review).
- **If it looks different:** if Undo is refused, a later decision is live; undo that first.
- **⚠ Data:** it writes two history entries (decision + undo) that stay in the history. The item itself goes back
  to exactly how it was.

### ☐ R-04 · Keyboard keys
- **Where:** Review.
- **Steps:** press **?**.
- **Input:** none.
- **Expected:** "Keyboard shortcuts":
  - J / K next / previous item;
  - A Yes: answer the question with yes;
  - R No (a value question then asks for the right value);
  - Enter save the No box;
  - E not sure: send back with a note (and a photo);
  - U or Ctrl+Z undo the last decision;
  - ? show or hide this list;
  - Esc close this list, or leave Live 360°.
  - "Keys pause while you type in a box."
- **How to confirm it's correct:** press J and K: the selected item moves down and up.
- **Requirement it proves:** "Keyboard: A approve, R reject, E appeal (note + photo upload), J/K next/prev" (§9.4).
- **If it looks different:** —

### ☐ R-05 · ⚠ No with a corrected value and a note, then Undo
- **Where:** the same item as R-03.
- **Steps:**
  1. Press **R**.
  2. Type 3 in "Actual floors".
  3. Type a note.
  4. Press Enter.
  5. Open the building on the map (Show on the map) and look under Floors.
  6. Back in Review, press **U**.
- **Input:** Actual floors `3`; note `manual check, will undo`.
- **Expected:**
  - After R: a box "Actual floors (we have 1 floor; optional)", "Saved with your answer; our value and the register
    are not changed.", Cancel / **Save answer: No**.
  - After Enter: "Answered No ✓ · Saved: reviewer says it has 3 floors, not 1." The header says 220 waiting.
  - In the drawer: "Reviewer says: 3 floors" under our "1 floor".
  - After U: 221 waiting, and the History shows "Answered No … (undone) "manual check, will undo" Reviewer says: 3
    floors".
- **How to confirm it's correct:**
  - Before you undo, download the Excel (P-02). The building's Review cell should read "Rejected — reviewer says: 3
    floors". That is the D59 wording; the Excel was not downloaded during today's No.
  - After undo, the API shows `corrected: null` for every item (checked today).
- **Requirement it proves:** human review workflow (correction captured).
- **If it looks different:** on a question with no value ("missing from the register?"), R saves at once without a
  box. That is correct.
- **⚠ Data:** same as R-03. Always finish with U.

### ☐ R-06 · ⚠ Not sure: send back with a note (and a photo)
- **Where:** Review, any item.
- **Steps:**
  1. Press **E**.
  2. Type a note.
  3. Optionally add a photo.
  4. Save.
  5. Press U.
- **Input:** note `checking on site`; any small JPEG.
- **Expected:** the item turns "Sent back" with the note; the photo is stored privately and opens through a link
  that expires after 10 minutes. U restores it.
- **How to confirm it's correct:** the item's History lists the photo link.
- **Requirement it proves:** "E appeal (note + photo upload)" (§9.4).
- **If it looks different:** a photo over 8 MB, or not JPEG / PNG / WebP, is refused.
- **Not run today:** the appeal path (no photo was uploaded for this guide). The wording comes from the Review page.
- **⚠ Data:** it uploads a photo to Supabase Storage; Undo restores the item but the uploaded file stays in storage.

---

## 6. Under the Hood

Under the Hood explains how one area's results were produced, step by step, with real examples. Every number is
counted from the area's saved run files.

### ☐ H-01 · Coverage and the run in brief
- **Where:** rail → **Hood**, Ward 29 tab.
- **Steps:** read the top card.
- **Input:** none.
- **Expected:**
  - "Map coverage: full — 11% of photos face no mapped building".
  - "Photos taken Jun 2018 to Feb 2026 · 39 camera positions of 201 with photos more than 3 years old · 8 missing or
    not-in-register findings marked "imagery may be outdated"."
  - "Map data: OpenStreetMap snapshot 2 Oct 2026 · Microsoft footprints 23 Feb 2026, held in the app's database for
    Coimbatore. This analysis read them from that copy…", with both © lines.
- **How to confirm it's correct:** 119 of 1,132 photos face no outline = 10.5%, shown as 11%.
- **Requirement it proves:** "coverage verdict banner" (§9.4 Under the Hood).
- **If it looks different:** "Ward 29 shows no "analysis photos still served" line" is expected today. The monthly
  photo check (`tools\check_photos.py`) has not been run since the re-run. Trichy shows "2 of 223 analysis photos
  are no longer served by Google…", and Sanganur Road "All 130 analysis photos are still served by Google (checked
  2026-10-07)".

### ☐ H-02 · The run in 9 sentences (story)
- **Where:** same card.
- **Steps:** read the sentences.
- **Input:** none.
- **Expected:**
  1. "Found 742 Street View panoramas (13 user photospheres, excluded from geometry)."
  2. "Planned 201 camera stops and 1,132 views…"
  3. "119 views face frontage with no building outline in OSM…"
  4. "The detector drew 5,418 boxes; 4,489 were usable for positioning."
  5. "Located 262 poles/streetlights; 19 triangulated from 2+ cameras, 243 approximate (single camera)."
  6. "373 buildings registered; 176 had a usable view for use/floors, 57 had no building box at all."
  7. "2,031 sign crops: 802 read locally, 188 escalated; 148 buildings named, 21 confirmed by Google."
  8. "23 businesses found with no analysed building…"
  9. "221 items sent to human review."
- **How to confirm it's correct:** sentences 5 and 6 differ from what the pipeline stored. Trust → Stored vs computed
  lists both versions, with the reason (H-13).
- **Requirement it proves:** "hero story (the story[] sentences)" (§9.4).
- **If it looks different:** —

### ☐ H-03 · Steps 01–05: streets, cameras, photos, boxes, signs
- **Where:** Hood, STEP 01–05.
- **Steps:** scroll; click one "See real examples" in each step.
- **Input:** none.
- **Expected:**
  - **01:** 10 streets, 4,829 m.
  - **02:** 201 camera positions; 448 not on an analysed street; 77 thinned; 16 dropped (inside a building outline).
  - **03:** 1,132 photos; 1,013 face a mapped building; 119 (11%) don't.
  - **04:** 5,418 boxes (2,369 buildings, 2,031 signs, 890 poles, 128 lamp heads), "merged into 262 poles and
    streetlights"; 4,489 usable, 831 tilted, 98 public photosphere.
  - **05:** 2,031 crops; 802 read directly; 188 to the cloud; 1,029 no readable name; 148 named; 87 clearly; 21 on
    Google; 23 businesses on no analysed building; 386 signs moved by their own line of sight.
  - An example sheet opens with real photos.
- **How to confirm it's correct:** 2,369 + 2,031 + 890 + 128 = 5,418; 4,489 + 831 + 98 = 5,418.
- **Requirement it proves:** the Sankey and sign funnel (§9.4).
- **If it looks different:** —
- **Cost:** each example photo is a Street View request (Google).

### ☐ H-04 · Step 06: local or cloud AI
- **Where:** Hood, STEP 06.
- **Steps:** read it.
- **Input:** none.
- **Expected:**
  - "109 / 67 local / cloud". Building use decided by: 109 local model · 67 cloud model (VLM) · 29 shop sign (no clear
    photo) · 168 not known.
  - Names kept from signs: 66 OCR alone · 79 cloud model, OCR agrees · 3 cloud model only (to review).
- **How to confirm it's correct:** 109 + 67 + 29 + 168 = 373. 66 + 79 + 3 = 148 named. The 3 equals Review's "Shop
  name read by the AI model only (3)".
- **Requirement it proves:** "model-route donut (local vs VLM for use; OCR vs VLM for names)" (§9.4) and "Invoke a
  larger vision-language model only for low-confidence building use, floor count or complex scenes" (requirements
  document, quoted in `docs/history/chat2.md`).
- **If it looks different:** 163 / 58 is the old run.

### ☐ H-05 · Steps 07–10: floors and use, positions, matching, findings
- **Where:** Hood, STEP 07–10.
- **Steps:** read them.
- **Input:** none.
- **Expected:**
  - **07:** 176 of 373 had a clear photo; 140 failed the quality check; 57 never seen; floors measured 173, estimated
    3, not known 197.
  - **08:** 19 pinpointed / 243 approximate, "128 stand within 8 m of their camera"; buildings 35 front-wall corners ·
    205 sight line meets the wall · 133 front-wall centre · 0 middle of the outline; 6 camera results rejected.
  - **09:** "373 buildings compared (+ 9 seen only by camera, not compared)"; 297 entry, no difference · 54 differ · 22
    not in the register; "For 135 of the 297 the use could not be compared".
  - **10:** 22 / 54 / 168 / 11 / 2,487 m.
- **How to confirm it's correct:** 176 + 140 + 57 = 373; 35 + 205 + 133 = 373; 297 + 54 + 22 = 373.
- **Requirement it proves:** "buildings (usable view / no box / rejected by quality gate with reasons)" (§9.4).
- **If it looks different:** —

### ☐ H-06 · The whole pipeline in one picture, and what got dropped
- **Where:** Hood, "The whole pipeline in one picture" and "What got dropped, and why".
- **Steps:** click a hatched (dropped) segment.
- **Input:** none.
- **Expected:**
  - Columns: panoramas → photos → boxes → results, with the same numbers as H-03 to H-05.
  - Dropped list: 1,029 sign crops (no readable text) · 243 poles and streetlights (approximate) · 140 buildings (box
    failed the quality gate) · 57 buildings (no building box) · 24 signs (not a business) · 16 panoramas (camera
    inside a building outline) · 12 sign crops (Google watermark).
- **How to confirm it's correct:** the same numbers as the steps above.
- **Requirement it proves:** "what got dropped and why" list (§9.4).
- **If it looks different:** —

### ☐ H-07 · Routing and cost
- **Where:** Hood → **Routing and cost**.
- **Steps:** read it; hover a number to see its source.
- **Input:** none.
- **Expected:**
  - Cost lines:
    - "Street View photos (Google): $9.40 — 1,343 photos at Google's global list price."
    - "Billed under Google's India pricing: ₹0 so far — within the free monthly allowance (17,747 Street View photos
      billed at ₹0, Sep 7 – Oct 6 2026)."
    - "Cloud AI (Amazon Nova Lite, AWS): $0.061. Floor counting is the largest AI cost; it isn't routed yet."
  - Route table:

    | Task | How many | Route | Time each | Cost |
    |---|---|---|---|---|
    | Find objects | 1,132 photos | YOLOv8s | 0.010 s | $0 |
    | Read shop signs | 2,031 | PaddleOCR (local) | 0.140 s | $0 |
    | Read shop signs | 162 | Nova name check (cloud) | 0.580 s | $0.0089 measured |
    | Building use | 128 | CLIP (local) | 0.008 s | $0 |
    | Building use | 83 | Nova (cloud) | 0.920 s | $0.0082 measured |
    | Number of floors | 211 | Nova | 1.09 s | $0.039 measured |
    | Shop signs with no analysed building | 78 | Nova | — | $0.0042 derived |
- **How to confirm it's correct:**
  - 1,343 × $0.007 = $9.40.
  - The cloud costs add up: 0.0089 + 0.0082 + 0.039 + 0.0042 = $0.0603 ≈ $0.061 (rounding).
- **Requirement it proves:** cost per route; Street View vs cloud AI shown separately.
- **If it looks different:** "every photo ≈ $0.112" or "no router $0.089" are the old estimates, replaced by the
  measurement (H-08).

### ☐ H-08 · Measured: cloud model on everything vs routed (n = 30), and time per step
- **Where:** Hood → Routing and cost → "Cloud model on everything vs routed · measured, n = 30 buildings" and "Time
  per item, by route".
- **Steps:** read both tables.
- **Input:** none.
- **Expected:**

  | Measured on 30 buildings | As run (routed) | Cloud model on everything |
  |---|---|---|
  | Building use right | 77% (23 of 30) | 73% (22 of 30) |
  | Floors exactly right | 73% | 73% |
  | Floors within one | 100% | 100% |
  | Cloud cost per building | $0.000227 | $0.000271 |
  | Time per building | 1.21 s | 1.98 s |
  | Cloud calls for the sample | 44 | 60 |

  - "16 of 30 decided by the local model."
  - Note: "Small sample: one building moves a result by about 3 points…"
  - Time per item (AWS g4dn.xlarge, NVIDIA T4): YOLOv8s 10 ms per photo (n 30) · PaddleOCR 140 ms per sign crop (n
    72) · CLIP 8 ms per building (+ 3.354 s to load once per run) · Nova use 890 ms · Nova floors 1.09 s.
  - "The measurement cost 90 Street View photos (Google, $0.63 at list price) and 60 Nova Lite calls (AWS, $0.0081)."
  - Below that: earlier labelled photos, use n = 31: cloud only 90% · local only 94% · routed 90%; shop names n = 31:
    cloud only 65% · OCR only 71% · routed 74%.
- **How to confirm it's correct:** Trust → "Cost and accuracy: routed vs all-VLM" shows the same $0.000227 /
  $0.000271, 77% / 73% and 1.21 s / 1.98 s (U-06).
- **Requirement it proves:** the cost benchmark against all-VLM (recorded in `docs/history/chat1.md` as an "explicit
  company requirement": cost and accuracy) and showing latency (D65).
- **If it looks different:** an "estimate" label instead of "measured, n = 30" means `routing_measured.json` is
  missing.
- **Labels:** the labels are an AI check (Claude Code), not a person's. Say so if asked.

### ☐ H-09 · Street by street
- **Where:** Hood → **Street by street**.
- **Steps:** click a street row.
- **Input:** none.
- **Expected:**

  | Street | m | cameras | buildings | not in reg. | differ | use ? | lights | dark | dark m |
  |---|---|---|---|---|---|---|---|---|---|
  | Sathy Main Road | 951 | 40 | 46 | 3 | 6 | 14 | 13 | 1 | 600 |
  | 2nd Street, Ganapathy Gardens (approx.) | 672 | 32 | 54 | 4 | 7 | 27 | 6 | 1 | 218 |
  | 2nd Street, Gandhi Nagar | 548 | 26 | 63 | 2 | 10 | 21 | 8 | 1 | 118 |
  | Sri Ganapathy Gardens 3rd Street (approx.) | 485 | 21 | 34 | 2 | 6 | 16 | 2 | 1 | 166 |
  | Korathottam Road | 462 | 18 | 40 | 2 | 7 | 26 | 4 | 2 | 190 |
  | 8th Street, Ganapathy | 441 | 13 | 36 | 1 | 5 | 18 | 0 | 1 | 414 |
  | 4th Street, Tatabad / Vinobaji Street | 398 | 10 | 31 | 2 | 5 | 21 | 2 | 1 | 171 |
  | 2nd Cross Road, Gandhi Nagar (approx.) | 394 | 19 | 36 | 1 | 1 | 15 | 1 | 1 | 275 |
  | Ganapathy - Avarampalayam Road | 323 | 15 | 29 | 3 | 7 | 10 | 2 | 1 | 193 |
  | Sakthi Main Road | 155 | 7 | 4 | 2 | 0 | 0 | 0 | 1 | 142 |

  Clicking a row shows the street on the small plan.
- **How to confirm it's correct:** the columns add up to the cards: buildings 373, not in register 22, differ 54,
  use not known 168, lights 38, dark stretches 11, dark metres 2,487.
- **Requirement it proves:** "per-street breakdown table" (§9.4).
- **If it looks different:** —

### ☐ H-10 · Street names
- **Where:** Hood → **Street names**.
- **Steps:** read the section.
- **Input:** none.
- **Expected:** for Ward 29: "No name list for this area yet (run tools/street_name_candidates.py)." So there is no
  picker for Ward 29 today.
- **How to confirm it's correct:** the street names everywhere else are the ten in H-09.
- **Requirement it proves:** extra.
- **If it looks different:** if you run `backend\.venv\Scripts\python tools\street_name_candidates.py`, a picker
  appears. ⚠ Choosing another name changes the names shown in the app; choosing the default again undoes it.

### ☐ H-11 · Time and cost
- **Where:** Hood → **Time and cost**.
- **Steps:** read the card.
- **Input:** none.
- **Expected:**
  - "Took 9.8 min on a GPU."
  - "Street View (Google): 1,343 photos, about $9.40 at list price."
  - "Cloud AI (Amazon Nova Lite, AWS): 534 calls, $0.06."
  - "Google business look-ups: 137 look-ups (price not recorded)."
  - The same India billing line as H-07.
  - Stage bars: Finding Street View 36 s · Reading the map 1.2 s · Planning photos 0.2 s · Looking at photos 59.2 s ·
    Placing objects 21.8 s · Reading signs 265 s · AI check 136.6 s · Google check 67.9 s · Register check 0.2 s ·
    total 9.8 min.
- **How to confirm it's correct:** the stage seconds add up to about 588 s ≈ 9.8 min.
- **Requirement it proves:** "stage timeline (Gantt from stage_seconds), cost waterfall" (§9.4).
- **If it looks different:** Trichy and Tiruppur are greyed "resumed run, not representative". That is correct.

### ☐ H-12 · Businesses vs OpenStreetMap
- **Where:** Hood → **Businesses vs OpenStreetMap**.
- **Steps:** read the section.
- **Input:** none.
- **Expected:** "Our camera found 141 businesses; OpenStreetMap lists 14 along these streets." Near each other (within
  25 m, location only) 10 (names didn't match) · seen by our camera, not in OpenStreetMap 131 · in OpenStreetMap, not
  seen 4 · other OSM points left out 4. Last line: "OpenStreetMap has floor counts for 2 of 373 buildings — too few to
  compare."
- **How to confirm it's correct:** the same as Q-10, and the PDF page 1 "131 Businesses not on OpenStreetMap of the
  141".
- **Requirement it proves:** extra (an outside reference next to the synthetic register).
- **If it looks different:** —

### ☐ H-13 · Compare runs and the other areas
- **Where:** Hood → the area tabs and **Compare all 10**.
- **Steps:**
  1. Click Bharathidasan Salai, Tiruchirappalli, then Uthukuli Road, Tiruppur.
  2. Click Compare all 10.
- **Input:** none.
- **Expected:**
  - Every area's Hood opens (all 10 returned HTTP 200 from the API today).
  - Trichy: "partial: 33% of views face no mapped building"; Tiruppur: "partial: 90%…", 1 building (+ 11 seen only
    by camera).
  - Compare shows one card per area.
- **How to confirm it's correct:** Tiruppur's card reads 1 building, 20 poles and lights, 3 possible dark stretches.
  That is the same as Jobs → Pre-computed runs.
- **Requirement it proves:** "Under the Hood renders all sections for all three areas" (§10 test 7) and "Compare
  runs" (§9.4).
- **If it looks different:** —

---

## 7. Trust

Trust shows every accuracy figure with how many examples were checked (n). All of it comes from
`data/model_card.json`.

### ☐ U-01 · What each result is worth (cards)
- **Where:** rail → **Trust** → "What each result is worth".
- **Steps:** read each card.
- **Input:** none.
- **Expected:**
  - **Building use, N=31:** 90% routed vs 90% every building to the VLM (earlier labelled photos); this run 77%
    routed vs 73% VLM on everything (n=30); local only 94%; 23% sent on to the VLM; Trichy 92% (n=12).
  - **Number of floors, N=36:** 61% exact vs 42% plain prompt; within one 100%; this run 73% exact, 100% within one
    (n=30); Trichy 50% (n=6).
  - **Shop names, N=31:** 74% OCR first vs 65% every crop to the VLM; OCR only 71%; whole photos 56% (n=16); "names
    also found on Google (Ward 29) 21 of 148".
  - **Building use from a shop sign:** "not measured".
  - **Possible dark stretches, N=49:** lamp heads found 43%, precision 50%, poles found 58% (n=209).
  - **Building position, N=240:** 2.52 m median vs the outline middle 7.25 m; 67.5% within 3.5 m; status **not
    verified**.
- **How to confirm it's correct:** "More detail" on each card shows the model-card key it reads.
- **Requirement it proves:** "every measured number with its n from model_card.json" (§9.4 Trust).
- **If it looks different:** 23 of 116 names on Google is the old run.

### ☐ U-02 · Gate 1: building position (not verified)
- **Where:** Trust → **Building position (Gate 1)**.
- **Steps:** read the badge and the tables.
- **Input:** none.
- **Expected:**
  - "STATUS: NOT VERIFIED" and "No reference accurate to ~1 m is available, so a 3.5 m result can't be confirmed or
    ruled out."
  - Method per building, Ward 29 (373): cameras cross 35 · line of sight on the wall 205 · front-wall centre 133 ·
    middle of the outline 0 · rejected 6.
  - Versus the OSM front-wall centre, Ward 29:
    - where camera views cross: 35, median 4 m, 48.6%;
    - line of sight on the wall: 205, 2.39 m, 70.7%;
    - front-wall centre: 133, 0.01 m, 100% ("this is the reference point itself (0 m by construction)");
    - **all camera-derived: 240, 2.52 m, p90 6.79 m, 67.5%**;
    - baseline middle of outline: 373, 7.25 m, 7%.
  - "No pooled "all buildings" figure is shown…" The Google-pin table says "not run for this Ward 29 analysis (it
    needs paid Google look-ups)".
- **How to confirm it's correct:** the drawer's position check quotes the same 240 / 2.52 m / 67.5% (E-15).
- **Requirement it proves:** Gate 1, predicted building position ≤ 3.5 m.
- **If it looks different:** 260 / 2.80 m / 60.4% is the old run.

### ☐ U-03 · Register test: planted mistakes and pairing by location
- **Where:** Trust → **Register tests (planted mistakes)**.
- **Steps:** read both tables.
- **Input:** none.
- **Expected:**
  - All areas: record missing 32 planted / 29 caught / 3 missed / 4 false alarms · pin in the wrong place 31 / 25 / 6
    / 3 · area too small 26 / 25 / 1 / 1 · wrong use 19 / 19 / 0 / 1 · too few floors recorded 12 / 12 / 0 / 1.
  - "600 of 608 records (98.7%); of the 31 records whose pin was planted 15–40 m away, 24 (77.4%)."
  - Ward 29 row: 351 records, 346 paired right (98.6%), 15 of 19 moved pins, 78 planted, 72 caught, 5 false alarms.
- **How to confirm it's correct:** the planted counts add up to 78 for Ward 29, and the Differ chart shows the same
  kinds (C-03).
- **Requirement it proves:** "Matching against at least one property or infrastructure reference dataset" (scored on
  planted mistakes).
- **If it looks different:** 68 of 78 caught / 11 false alarms is the old run.

### ☐ U-04 · Detector checks and tried-and-dropped
- **Where:** Trust → **Detector** and **Tried and dropped**.
- **Steps:** read both sections.
- **Input:** none.
- **Expected:**
  - Detector on 150 hand-labelled images: pole found 58% / right 74% (n=209) · lamp head 43% / 50% (n=49) · signboard
    56% / 40% (n=104) · building 71% / 68% (n=296).
  - Benchmark: YOLOv8n F1 0.582 · YOLOv8s ★ 0.625 · YOLO26n 0.626 · YOLO26s 0.624. "Why YOLO26s was not adopted: full
    Ward 29 run: 28 streetlights vs 38 with v8s, +45 unverified poles".
  - The sign-box sentence: "In a 20-photo check, 8 of the 20 boxes counted as signs weren't shop signs… AI visual
    check (Claude Code), not a human check".
  - Tried and dropped: floors 3-example 56%, zoom re-shoot 44% → 22%, prompt v4 49%; Google Places type as use 66%
    (n 29); every photo to the VLM (13x cost); VLM-only names 0 of 8; VLM lamp check 0 of 20; withheld: facade
    condition 53% vs 66% baseline (n=38), door numbers.
- **How to confirm it's correct:** the lamp 43% equals the dark-stretch caution text (E-21).
- **Requirement it proves:** "detector per-class P/R + benchmark chart … and why v8s stays" and "rejected
  experiments" (§9.4 Trust).
- **If it looks different:** in the Building use lane, "cloud $ per building 0" shows for both rows instead of
  $0.000227 / $0.000271. This is a rounding display slip seen today; the correct values are in U-06 and H-08.

### ☐ U-05 · Which building a sign belongs to (sign rule)
- **Where:** Trust → **Which building a sign belongs to**.
- **Steps:** read the section; open the spot-check.
- **Input:** none.
- **Expected:**
  - The rule: a sign moves off the aimed building only when its line of sight, and the lines 4° either side, all
    reach the same other building.
  - "Ward 29 sign boxes 2,031, of which 523 moved to another building (or to / from none)".
  - "29 moved signs whose name matches a Google Maps business: the new building is closer to Google's pin for 8,
    further for 6, the same for 1; 14 moved to or from no building… Median change: 1.7 m closer."
  - Box "AI VISUAL CHECK (CLAUDE CODE), NOT A HUMAN CHECK": "20 random sign moves (of 386) looked at once each: 11 move
    looks right · 1 looks wrong · 8 can't tell. 8 of the boxes are not shop signs at all…"
- **How to confirm it's correct:** 386 equals Hood step 05's "386 signs moved that way".
- **Requirement it proves:** extra (sign linking, D44).
- **If it looks different:** 2,065 / 570 is the old run.

### ☐ U-06 · Cost and accuracy: routed vs all-VLM (the cost panel)
- **Where:** Trust → **Cost: routed vs all-VLM**.
- **Steps:** read the panel.
- **Input:** none.
- **Expected:**
  - Building use cloud $ per building (n=30): routed $0.000227 vs all-VLM $0.000271.
  - Right: 77% vs 73%. Seconds per building: 1.21 s vs 1.98 s. "Cloud calls for the 30: 44 routed vs 60."
  - Shop names VLM spend $0.0079 vs $0.105; accuracy 74% vs 65%.
  - The time-per-item list (same as H-08).
  - "WARD 29 FULL RUN (SERVER GPU) 9.8 min · 1,343 photos"; "CLOUD AI $0.061 534 calls"; "STREET VIEW IMAGE $0.007
    each".
- **How to confirm it's correct:** the numbers equal Hood's measured table (H-08).
- **Requirement it proves:** "Cost panel shows routed vs all-VLM cost and accuracy from model_card.json" (§10 test 6).
- **If it looks different:** "$0.056 / $0.089" or "11.5 GPU min" are the old Sep run (removed in D65).

### ☐ U-07 · Limits, gap checks, OpenStreetMap cross-checks, how questions work
- **Where:** Trust, last sections.
- **Steps:** read each.
- **Input:** none.
- **Expected:**
  - **Gap length checks:** gap60-008 275 m vs ≈ 367 m along the road · gap60-006 218 vs ≈ 287 · gap60-007 "Street
    bends: 4 lit camera stops lie on the road between these ends…".
  - **OSM cross-checks:** "2 of 373 analysed buildings carry OpenStreetMap's building:levels tag", w1247745270 "OSM
    10, ours 1".
  - **Limits:** "Use not classified: 168 of 373…"; "Positions: 243 of 262 … seen from one camera only…"; "Registers:
    synthetic"; "Withheld: facade condition and door numbers".
  - **How questions are answered:** "rules, not an AI model … Deterministic … Offline … Explainable".
- **How to confirm it's correct:** gap60-007 is the stretch marked "Needs checking on the ground" in E-21.
- **Requirement it proves:** honest limits (CLAUDE.md §2 "Never invent numbers").
- **If it looks different:** the Limits line "Timings: the stored runs were resumed…; Ward 29's full-run GPU time
  comes from the model card" is a little stale for the re-run, which has its own measured timing. Mention it if asked.

---

## 8. Jobs and Analyse a new street

### ☐ J-01 · Jobs page
- **Where:** rail → **Jobs**.
- **Steps:** read the page; click one job.
- **Input:** none.
- **Expected:**
  - "Analysis computer: not connected — new streets wait in the queue until it connects." (while no worker runs).
  - Pre-computed runs: Uthukuli Road, Tiruppur ("1 building (+ 11 seen only by camera) · 20 poles & lights · 3
    possible dark stretches · few buildings on the map here") and Bharathidasan Salai, Tiruchirappalli ("66 buildings
    (+ 79 seen only by camera) · 87 poles & lights · 8 possible dark stretches…").
  - Started from this app, 8 jobs, all **Done**: Ward 29, Coimbatore (re-run, Oct 2026) · Unnamed road near 5th
    Street (50 m) · Rathinapuri (Sanganoor) Main Road (549 m) · Unnamed road between Bharathiar Road and Sankara
    Linganar Street (276 m) · Kattabomman Street Extention (172 m) · Vadakku Masi Veethi (338 m) · 3rd Street, Sridevi
    Nagar (232 m) · Sanganur Road (302 m).
  - The Ward 29 job's detail: "Finished 8 Oct, 06:01 pm · took 10 minutes on a fast computer", 10 stages, "No street
    geometry stored for this job".
- **How to confirm it's correct:** `http://127.0.0.1:8000/jobs` lists 8 jobs.
- **Requirement it proves:** "Jobs — history of analyses with status, duration, cost, link to area and to Under the
  Hood" (§9.4).
- **If it looks different:** the Ward 29 re-run shows here as a job ("No street geometry stored") because it was a
  whole-area job, not a street click. That is expected.

### ☐ J-02 · Analyse: pick a street (free)
- **Where:** top bar → **Analyse**.
- **Steps:**
  1. Click **Analyse**.
  2. Move over the map. Blue lines (Street View coverage) appear near the pointer.
  3. Pan to Pioneer Mills Cross Street (around 11.0265, 77.0047, east of Ward 29).
  4. Click the blue line.
- **Input:** none.
- **Expected:**
  - The hint "Analyse a new street: move the pointer over the map. Blue lines near the pointer are Google Street View
    coverage; click one to pick that street. Esc leaves."
  - Then a sheet "ANALYSE THIS STREET? · Pioneer Mills Cross Street · 291 m · highlighted on the map", with "Drag the
    orange end dots on the map to analyse only part of it."
- **How to confirm it's correct:** API `POST /jobs/preview {lat 11.0265337, lon 77.0047134}` gave "Pioneer Mills
  Cross Street", 291 m, in 0.8 s (local map data).
- **Requirement it proves:** "Click a new street → job queued" (§10 test 8), part 1.
- **If it looks different:** "Map server is busy — try again in a minute." can only happen outside Coimbatore,
  Trichy, Tiruppur and Madurai (K-05).

### ☐ J-03 · The estimate: Street View (Google) and Amazon Nova (AWS) separately
- **Where:** the confirm sheet.
- **Steps:** wait a few seconds for the numbers.
- **Input:** none.
- **Expected:**
  - Pioneer Mills Cross Street: "STREET VIEW ≈ 63 images · ≈ $0.44 (Google list price)"; "TIME ≈ 3 minutes"; "Cloud AI
    (Amazon Nova, AWS) ≈ $0.0031".
  - "Cost cap $ 2.00 · Above it, the analysis waits for your approval."
  - "An estimate, not a measurement. How is this estimated?"
- **How to confirm it's correct:**
  - 63 × $0.007 = $0.44.
  - "How is this estimated?" says "0.44 s per image from the Ward 29 full run (1,343 images in 9.8 min on the server
    GPU…)".
  - The API estimate: 11 cameras, 51 views, 12 buildings faced, 7 Places look-ups, 3.4 GPU minutes.
- **Requirement it proves:** cost shown before anything is bought (§9.4 "estimated time/cost").
- **If it looks different:** "Estimate slow (map server busy) — you can still start; the cost cap protects you."
  appears after 90 s with a slow map server.

### ☐ J-04 · Cost cap and approval
- **Where:** the confirm sheet, field "Cost cap $".
- **Steps:**
  1. Type 0.10 in the cap field.
  2. Read the line under it.
  3. Put it back to 2.
- **Input:** `0.10`, then `2`.
- **Expected:** with 0.10: "Above the cap: it will wait for your approval before any photo is bought." in orange.
  Starting then would make the job **Needs approval**, and Jobs would show **Approve and run** / Cancel.
- **How to confirm it's correct:** a long street over the default cap is over it without editing. Dr Alagesan Road is
  1,201 m, 314 images, $2.20 + Nova $0.0153 > $2 (API: `over_cap: true`).
- **Requirement it proves:** extra (money safety, P7.2).
- **If it looks different:** —
- **Not run today:** the 0.10 edit in the browser (the field has no label for Playwright). The over-cap wording is
  quoted from the app's code; the API's `over_cap` was checked.

### ☐ J-05 · "Continues outside this area" and "already analysed"
- **Where:** Analyse, inside Ward 29.
- **Steps:**
  1. Click Sakthi Main Road inside Ward 29.
  2. Read the sheet.
  3. Click **Analyse anyway**.
  4. Pick another street: Rathinapuri (Sanganoor) Main Road, west of Sanganoor Road.
  5. Click **Analyse anyway**.
  6. Turn on the switch.
- **Input:** none.
- **Expected:**
  - **Sakthi Main Road:** "142 m · This street continues outside this area (544 m) — include it?"; "Already analysed
    in Ward 29, Coimbatore. The same road. Open · Analyse anyway"; then ≈ 70 images ≈ $0.49, Nova ≈ $0.0034.
  - **Rathinapuri:** "327 m · This street continues outside this area (222 m) — include it?", ≈ 141 images ≈ $0.99,
    Nova ≈ $0.0069. Switch on: "549 m in 2 separate pieces", "Trimming is off while the rest of the street is
    included.", ≈ 191 images ≈ $1.34, Nova ≈ $0.0093. Switch off goes back to 327 m.
- **How to confirm it's correct:** 327 + 222 = 549 m.
- **Requirement it proves:** extra (D57, D58).
- **If it looks different:** "This street continues elsewhere (N m)" is the wording when the other piece is not in an
  analysed area. No such street was produced today; both examples are now inside analysed areas, so they say
  "outside this area".

### ☐ J-06 · Start with the worker offline: an honest "Queued"
- **Where:** the confirm sheet → **Start analysis**, with no worker running.
- **Steps:**
  1. With "Analysis off" in the top bar, click **Start analysis** on Pioneer Mills Cross Street.
  2. Open Jobs.
  3. Cancel the job, then **Remove from list**.
- **Input:** none.
- **Expected:**
  - The job shows "Queued. The analysis computer is not connected yet; it starts as soon as it is."
  - A still dashed line on the map; the job in Jobs.
  - After cancel + remove, Jobs is back to 8.
- **How to confirm it's correct:** today a job was created through the API for this street (`POST /jobs`, 201,
  slug `pioneer_mills_cross_street_816bef`), then cancelled (200) and deleted (200); the job count went back to 8.
  The Queued wording and the dashed line are quoted from the app's code; the UI was not opened on that job.
- **Requirement it proves:** "With worker offline: honest queued state" (§10 test 8).
- **If it looks different:** if a worker is online it starts within seconds. Do J-07's cost check first.
- **⚠ Data:** it creates a job row; cancel and remove it. Nothing is bought while no worker runs, because the worker
  buys the photos.

### ☐ J-07 · ⚠ Run a short street end to end (worker online)
- **Where:** live server (S-04, S-05) or Colab, then Analyse.
- **Steps:**
  1. With **Analysis on**, pick Pioneer Mills Cross Street (or drag the end dots to shorten it).
  2. Read both estimates.
  3. Click **Start analysis**.
  4. Watch the progress.
- **Input:** none.
- **Expected:**
  - Progress through the 10 stages (Finding Street View → Reading the map → Planning photos → Looking at photos →
    Placing objects → Reading signs → AI check → Google check → Register check → Saving results).
  - The map animates along the street; "Done. The new area is ready."
  - The area appears in the area picker and Under the Hood. The API log shows "box choice (D62) for <slug>".
- **How to confirm it's correct:**
  - The new area's Hood "Time and cost" photo count is close to the estimate (63).
  - The last live run for comparison (D63, 50 m): 20 photos $0.14, Nova $0.0008, 2 min 19 s.
- **Requirement it proves:** "Click a new street → job queued → (with worker online) progress → new area appears"
  (§10 test 8).
- **If it looks different:** "Paused: key expired" means run S-05 with fresh keys; the job continues. "No Street
  View" means Google has no imagery there.
- **⚠ Cost:** about **$0.44 Street View (Google, list price; ₹0 so far under India pricing)** + **$0.0031 Amazon
  Nova (AWS)** + server time ($0.579/h) for Pioneer Mills Cross Street. Choose a short street.
- **Undo:** photos bought can't be un-bought. To remove the new area: Jobs → the job → **Delete this analysed
  area…** (this deletes data).
- **Not run today:** the server was stopped and no paid run was made for this guide.

---

## 9. Reports

### ☐ P-01 · Area report: PDF
- **Where:** Explore → **What stands out** → Download report: **PDF**.
- **Steps:**
  1. Click PDF.
  2. Open the file.
- **Input:** none.
- **Expected:**
  - File `geo-cascadia_report_ward29_<today>.pdf`, **19 pages**, landscape.
  - Page 1 "AT A GLANCE": the SYNTHETIC banner; cards 373 (+ 9 seen only by camera) · 22 · 54 · 11 (High 5 · Medium
    1 · Low 5) · 221 review items · 131 Businesses not on OpenStreetMap of the 141.
  - "What matters most": "1. 22 of the 373 buildings… most are on 2nd Street, Gandhi Nagar (12)"; "2. … check Sathy
    Main Road first (600 m)".
  - Page order: 2 all key numbers · 3 map (© OpenStreetMap contributors, no Google imagery) · 4 what to do next · 5–6
    method, limits, confidence · 7–19 appendix (buildings, assets, review queue (221), businesses vs OSM (145)).
  - "Cost of this run": Street View $9.40 — 1,343 photos; India billing ₹0; Cloud AI $0.061.
  - "Not verified" appears (Gate 1).
- **How to confirm it's correct:** page 1 equals the ribbon (E-02). "2nd Street, Gandhi Nagar (12)" = 2 not in
  register + 10 differ (H-09).
- **Requirement it proves:** extra (report for officials, D55 / D58).
- **If it looks different:** a Google map or photo inside the PDF would break the Google terms. There must be none.

### ☐ P-02 · Area report: Excel
- **Where:** same, **Excel**.
- **Steps:** download and open it.
- **Input:** none.
- **Expected:** `geo-cascadia_report_ward29_<today>.xlsx` with 6 sheets:

  | Sheet | Rows (with header) | Means |
  |---|---|---|
  | About | 50 | key numbers |
  | Buildings with findings | 77 | 76 buildings = 22 + 54 |
  | Assets | 263 | 262 |
  | Possible dark stretches | 12 | 11 |
  | Review items | 222 | 221 |
  | OSM shops | 146 | 145 |

  - Row w1247745084: "Residential · 2 floors · High … · Differs from the register: more floors than recorded · P-0259 ·
    Residential · 1 floor · 263 m² · pin 0 m away · Waiting for review".
  - Stretches row 1: "High · 600 m on a main road, 47 shops… · gap60-001 · 3 + 3 + 3 = 9".
- **How to confirm it's correct:** the same building shows the same floors and register record in the drawer (E-14,
  E-16), the Excel and the PDF appendix.
- **Requirement it proves:** "discrepancy table" (Expected Result on the Screen), exportable.
- **If it looks different:** —

### ☐ P-03 · Single-street reports
- **Where:** select Sathy Main Road → **Street report** → PDF / Excel / GeoJSON / Shapefile.
- **Steps:** download all four.
- **Input:** none.
- **Expected:**
  - PDF `geo-cascadia_report_ward29_sathy_main_road_<today>.pdf`, **8 pages**. Page 1: 46 / 3 / 6 / 1 (High 1) / 50
    review items / 42 of 47 businesses not on OpenStreetMap. Cost "(whole area)".
  - Excel: Buildings with findings 10 rows (9), Assets 60 (59), stretches 2 (1), Review items 51 (50), OSM shops 49
    (48).
  - GeoJSON 167 features (59 poles and streetlights, 50 review items, 48 businesses, 9 buildings, 1 dark stretch).
- **How to confirm it's correct:** 46 / 3 / 6 / 1 equal the street ribbon (E-07); 50 equals Review → Street "Sathy
  Main Road (50)".
- **Requirement it proves:** extra.
- **If it looks different:** —

### ☐ P-04 · GeoJSON and Shapefile (area)
- **Where:** What stands out → **GeoJSON** and **Shapefile**.
- **Steps:**
  1. Download both.
  2. Open the GeoJSON in geojson.io or QGIS.
  3. Unzip the Shapefile.
- **Input:** none.
- **Expected:**
  - `geo-cascadia_gis_ward29_<today>.geojson`: 715 features, layers poles_streetlights 262 · review_items 221 ·
    businesses_vs_osm 145 · buildings 76 · dark_stretches 11.
  - `…shp.zip`: buildings, poles_streetlights, dark_stretches, review_items, businesses_vs_osm (each .shp .shx .dbf
    .prj .cpg), plus `fields.csv` and `README.txt`.
- **How to confirm it's correct:** the counts equal the Excel rows (P-02). In QGIS the layers sit on the right streets
  (WGS84).
- **Requirement it proves:** extra (GIS export, D58).
- **If it looks different:** —

---

## 10. Themes, keyboard, and what the app shows when something is off

### ☐ K-01 · Night / Daylight
- **Where:** rail, bottom: **Daylight** (in Night) / **Night** (in Daylight).
- **Steps:**
  1. Click Daylight.
  2. Look at the map and the ribbon.
  3. Reload.
  4. Click Night.
- **Input:** none.
- **Expected:** a paper-coloured map with dark ink stretches and the same numbers (373 / 22 / 54 / 11 / 168). The
  choice survives a reload (stored as `gc.mode`).
- **How to confirm it's correct:** every page (Review, Hood, Trust, Jobs) is readable in Daylight.
- **Requirement it proves:** "Calm dark theme by default (light theme toggle)" (§9.1).
- **If it looks different:** —

### ☐ K-02 · Tab and Esc
- **Where:** Explore.
- **Steps:**
  1. Press Tab repeatedly.
  2. Open a drawer and a panel.
  3. Press Esc.
- **Input:** none.
- **Expected:** a visible focus ring moves through the rail, top bar and ribbon. Esc closes the topmost thing first:
  the full list, then the drawer, then the panel.
- **How to confirm it's correct:** `npx tsx scripts/audit.ts` (web) checks the same in both themes.
- **Requirement it proves:** "Everything keyboard-accessible" (§9.1).
- **If it looks different:** —

### ☐ K-03 · Ctrl K command palette
- **Where:** anywhere.
- **Steps:**
  1. Press Ctrl K.
  2. Read the list.
  3. Press Esc.
- **Input:** none.
- **Expected:**
  - "Example questions (spec)" with the four spec sentences.
  - Areas (the 10 of E-01).
  - Go to City / Area / Street / Object level.
  - Pages: Explore, Review, Under the hood, Trust, Jobs.
  - Actions: Analyse a street…, What stands out, Build a question by clicking, Clear filters and question, Toggle 3D /
    2D, Switch to Daylight, Minimap.
  - Layers with on / off.
  - Esc closes it (checked: 0 palettes open after Esc).
- **How to confirm it's correct:** typing a place name shows Google Places results ("powered by Google").
- **Requirement it proves:** "command palette (⌘K / Ctrl+K)" (§9.4).
- **If it looks different:** —

### ☐ K-04 · Worker offline
- **Where:** top bar and Jobs, with no worker running (today's state).
- **Steps:** look at the top bar; open Jobs.
- **Input:** none.
- **Expected:** "Analysis off" in the top bar; Jobs says "Analysis computer: not connected — new streets wait in the
  queue until it connects." A new street waits as "Queued. The analysis computer is not connected yet; it starts as
  soon as it is." (J-06).
- **How to confirm it's correct:** `http://127.0.0.1:8000/worker/status` → `"connected":false`.
- **Requirement it proves:** "if no worker is online the UI says 'queued — analysis worker offline' (honest, not an
  error)" (CLAUDE.md §5).
- **If it looks different:** —

### ☐ K-05 · Map server busy
- **Where:** Analyse, a street outside the four covered cities (for example in Erode, around 11.3410, 77.7172) while
  OpenStreetMap's servers are slow.
- **Steps:** click such a street.
- **Input:** none.
- **Expected:** "Finding street…", then, if the servers don't answer, "Map server is busy — try again in a minute."
  Inside Coimbatore, Trichy, Tiruppur and Madurai this never happens (map data from the database).
- **How to confirm it's correct:** `/health` → `map_servers` shows which servers are resting.
- **Requirement it proves:** extra (P7 states).
- **If it looks different:** —
- **Not reproduced today:** the servers were answering. The wording is quoted from the app.

### ☐ K-06 · Database unreachable (offline, read-only)
- **Where:** any page, if Supabase can't be reached.
- **Steps:** (only if it happens) look at the top bar and Review.
- **Input:** none.
- **Expected:** an "Offline" badge. Everything is readable from the saved files; Review buttons and new analyses say
  "Offline — read-only".
- **How to confirm it's correct:** `/health` → `"offline":true`.
- **Requirement it proves:** extra.
- **If it looks different:** —
- **Not reproduced today:** the database was online.

### ☐ K-07 · API stopped, or no map key
- **Where:** any page.
- **Steps:**
  1. Stop the API (Ctrl C in its window).
  2. Click Jobs.
  3. Start the API again.
  4. Click Review.
- **Input:** none.
- **Expected:** an orange banner "The API isn't answering (…). What is on screen stays; new data loads once it is
  back." It clears on the next call after the restart. With no Google browser key: "The map can't be shown", with
  working links to Review, Under the Hood, Trust and Jobs.
- **How to confirm it's correct:** —
- **Requirement it proves:** extra (P7 R3 states).
- **If it looks different:** —
- **Not reproduced today.** The wording is quoted from the app's code.

---

## Requirements coverage

The left column uses the requirement wording recorded in the repo. Tick it against the PDF.

| Must demonstrate | Proved by |
|---|---|
| Detect buildings, poles, streetlights and shop signs from Street View | E-09, E-10, E-18, E-19, H-03 |
| Building attributes: use and visible floors | E-14, E-17, C-01, C-02, H-04, H-05 |
| Positions on a map (and Gate 1, predicted building position ≤ 3.5 m) | E-15, E-18, E-20, H-05, U-02 |
| "Matching against at least one property or infrastructure reference dataset" | E-16, E-18, U-03, C-03 |
| "Invoke a larger vision-language model only for low-confidence building use, floor count or complex scenes" | E-17, H-04, H-07 |
| Cost and accuracy vs sending everything to the VLM; show latency | H-07, H-08, U-06 |
| "Discrepancy table", "unmatched properties" KPI cards, "database-match status" charts, "matched record" column | E-02, E-03, E-04, C-03, C-04, P-02 |
| "Show commercial buildings with more than two visible floors that do not have a matching property record" | Q-02, Q-03, Q-11 |
| "Show streets where no streetlight is detected within 60 m" | Q-04, E-21, E-22, Q-11 |
| "Display only low-confidence floor-count predictions and create a review queue" | Q-06, R-01, Q-11 |
| "Chart of unmatched buildings by street" (+ bar click zooms the map) | Q-07, C-04, Q-11 |
| Click any object → Street View evidence with its box, route badges, register record | E-09 – E-19 |
| Human review (approve / reject / appeal, keyboard) | R-01 – R-06 |
| Under the Hood for every area | H-01 – H-13 |
| Analyse a new street on demand (queued / progress / new area) | J-02 – J-07, K-04 |
| Google attribution; synthetic-register labels | S-02, E-13, E-16, P-01 |

---

## Known limits to explain if asked

- **Synthetic register.**
  - There is no open municipal register, so each area's property and asset register is made up. It copies what the
    photos show, except planted mistakes: 78 in Ward 29.
  - Records are paired with buildings by location only, never by ID.
  - Ward 29: 72 of 78 planted mistakes caught, 5 false alarms, and 346 of 351 records paired with their own building
    (98.6%) (U-03).
  - So "not in register" and "differs" test the comparison logic end to end; they say nothing about the city's real
    records. A real register can be loaded with `tools/import_register.py` (`docs/REGISTER_IMPORT.md`).
- **Gate 1 is measured against OpenStreetMap, not a survey.**
  - The organisers accepted OSM outlines as the reference, and the position as the centre of the building's front.
  - Ward 29's camera-derived positions are a median 2.52 m from the OSM front-wall centre, and 67.5% are within
    3.5 m (n = 240).
  - The wall-hit method uses the same OSM wall, so this is partly circular. The status stays **Not verified** until
    surveyed points exist (U-02).
- **Use not known (168 of 373): a trade-off.**
  - Since D64 the box the model reads must be the right building's box.
  - Where that box is a sliver at the photo edge or has its roof cut off, the quality gate rejects it (140
    buildings), and 57 were never seen as a building. Before D64 the model read a wrong, bigger box instead.
  - So this is "not known" rather than a confident wrong answer. It is shown on the map, never hidden.
- **The M3 box rule.**
  - The orange box is the building box that best covers the part of the building the camera can actually see (lines
    of sight checked against every outline).
  - Below 0.4 overlap it picks none: "can't tell", or no camera position from that photo (153 of 1,282
    photo–building pairs in the Ward 29 re-run, as recorded in D64).
  - The experiment it came from: 84.8% right vs 75.8% for the old rule, on a small test set (n = 33, from D62).
  - In Ward 29 the box shown is the box used for use, floors and position (level 2). Older areas only draw it (level
    1).
- **Building condition is withheld.** The condition check scored 53% against a 66% "always good" baseline (n = 38), so
  it is never shown as a finding. Door numbers are shown only as "not confirmed".
- **Analyse works per street in the app.** You click one street (optionally trimmed, or with its other pieces). Whole
  areas such as Ward 29 were run as area jobs by a tool (`tools/ward29_rerun.py`), not from the app.
- **Personal Google key.**
  - Maps, Street View and Places run on the owner's own Google key.
  - The browser key is limited to `http://localhost:5173/*` and `http://65.1.253.18/*`.
  - Street View costs $0.007 a photo at list price, but India pricing has billed ₹0 so far (17,747 photos, Sep 7 –
    Oct 6 2026). A heavy public demo could leave the free allowance.
- **Small measurement samples.** Routed vs cloud-on-everything is n = 30, one building ≈ 3 points. Its labels are an
  AI check (Claude Code), not a person's.

---

## 5-minute demo path

Ward 29, Night, worker not needed. About 30–40 s each.

1. **E-02:** the key numbers, 373 / 22 / 54 / 11 / 168. "Registers are synthetic."
2. **Q-02:** paste spec question 1 → chips → **sri abiraami jewellery** → open it.
3. **E-09 + E-15 + E-16:** photo with the orange box and tags; 3 floors (Medium); position 2.3 m (within); "No record"
   (synthetic); the review question.
4. **Q-04 + E-22:** spec question 2 → 11 stretches, Fix first → click the 600 m Sathy Main Road card (High, 9 of 9
   points).
5. **Q-07 + C-04:** spec question 4 → click the Korathottam Road bar → the map zooms there.
6. **Q-06 + R-03:** spec question 3 → Send 3 to Review → press A, read "Saved: …", press U.
7. **H-08:** Under the Hood → Routing and cost → measured 77% vs 73%, $0.000227 vs $0.000271, 1.21 s vs 1.98 s; time
   per step.
8. **U-02:** Trust → Gate 1 → 2.52 m median, 67.5%, **Not verified**, and why.
9. **J-02 + J-03:** Analyse → Pioneer Mills Cross Street → 63 photos ≈ $0.44 + Nova ≈ $0.0031 → Cancel (or Start, if
   the server is running and you accept the cost).
10. **P-01:** What stands out → PDF → page 1 equals the ribbon.

---

## What could not be verified today

- **Live server (S-04 to S-07, J-07):** the server was stopped. `status.ps1` was run and printed "state stopped".
  Nothing was started, so the start, refresh-keys and live-site outputs are quoted from the scripts, and no paid
  analysis was run.
- **Appeal with a photo (R-06), the cost-cap edit in the browser (J-04), map server busy (K-05), database offline
  (K-06), API stopped and no map key (K-07):** these were not reproduced. The wording is quoted from the app's code.
- **"Continues elsewhere":** no example street was found today (J-05).
- **Requirements PDF:** not in the repository. Requirement quotes come from `CLAUDE.md` and `docs/history/`.
- **Small display slips seen while checking** (not fixed; no app code was changed):
  - Trust → Tried and dropped shows "cloud $ per building 0" (U-04).
  - The spec question 1 list footer says "1 buildings" (Q-02).
  - The ub-0000 drawer says "OpenStreetMap has no building outline here" though it sits on outline w1236978188 (E-19).
  - Trust → Limits still calls Ward 29's timing "from the model card" (U-07).
  - Ward 29 has no street-name list and no photo-check line on Under the Hood (H-01, H-10).
