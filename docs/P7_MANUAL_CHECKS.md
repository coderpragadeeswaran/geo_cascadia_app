# P7 manual checks (browser only)

Things only a person in a browser can confirm. Start the API (:8000) and web (:5173); test at 1366×768 and once in
Daylight. Each line: what to do → what you should see. Round 3 appends below.

## Round 1
1. **Zoom once per street.** Analyse → click a street → the map frames it once. Then scroll, pan, double-click, click the same street again → the map never jumps back; only a *different* street re-frames.
2. **Tilt never fights your zoom.** Scroll in past street zoom and keep scrolling → the map tilts to 3D while the zoom follows your wheel smoothly (no snap-back).
3. **Two end handles, never overlapping.** Pick a very short street, a loop / cul-de-sac, and zoom far out on a street → exactly 2 orange handles, always apart; no other dots on the line. Drag each → it follows the pointer without a jump.
4. **Short street.** Pick a street under 40 m → 2 fixed end markers, "too short to trim" in the sheet; markers can't be dragged.
5. **"< 1 minute".** Confirm sheet / job card / Jobs on a tiny street → never "0 minutes".
6. **Slow OSM.** Click a new street while OpenStreetMap is slow → within ~5 s a sodium "OSM lookup slow…" line with Retry; map still pans/zooms; Retry a few seconds later answers at once.
7. **Planner estimate.** New street → "Planning camera stops… N s", then images / $ / minutes; drag a handle → numbers dim and update.
8. **Cost cap.** Edit the "Cost cap $" field (e.g. 0.10) → "Above the cap…" in sodium when the total is higher; start → job pauses as Needs approval (worker online).
9. **Hood photo cost.** Under the Hood → Ward 29 → Time and cost: "about $9.94 … (1,420 photos)" with the source caption; hover shows it too.

## Round 2
10. **Estimate gives up after 90 s.** With Overpass slow, keep the confirm sheet open > 90 s → "Estimate slow (map server busy) — you can still start; the cost cap protects you." + Check again; Start still works.
11. **Street names.** Map labels, Analyse box, Jobs and Hood for the 4th Street area all read "3rd Street, Sridevi Nagar"; Kattabomman area reads "Kattabomman Street Extention" (Google's spelling).
12. **Camera-only buildings layer.** Ward 29 at street zoom → sodium diamonds where the camera saw a building with no map outline; Key lists "Building seen by camera only … 9"; Layers toggle hides them; check Night and Daylight.
13. **Linked boxes.** Click a building with shops (e.g. w1247744676) → photo shows light-orange boxes labelled "part of this building"; drawer line "1 building · 50 shop signs linked to it, in 13 photos". A house with no sign → "no shop sign in the photos is linked to it".
14. **One pole, several photos.** Hover / click a pole → "1 pole on the map · seen in N photos"; Under the Hood chapter 04 says the 958 pole boxes become 268 poles and streetlights.
15. **Street-name picker.** Hood → Street names → pick another name for a street → map, findings table and charts use it after reload; pick the default again → back. Offline mode → button reads "Offline — read only".
16. **Sign rule on Trust.** Trust → Which building a sign belongs to → rule, Google check (14 closer / 6 further), the AI check box labelled "AI visual check (Claude Code), not a human check".
17. **Human spot-check.** Open the spot-check → step through 20 signs; mark each; the tally updates and survives a reload (this browser only); compare with the hidden AI verdicts.

## Round 3
18. **Tour, first visit.** A fresh browser profile (or delete `gc.tourSeen` in DevTools → Application → Local storage) → the tour opens by itself after the opening flight; reload → it does not open again; **Tour (?)** at the bottom of the rail starts it.
19. **Tour by keyboard only.** Enter / → step, ← goes back, Esc closes from any step (on Review and in Analyse too: Esc closes only the tour). Focus is on Next at each step. Repeat in Daylight.
20. **Tour on the projector.** Step through at the demo resolution: the card never covers what its step talks about (Analyse: card top-right, sheet at the bottom).
21. **Tunnel on 127.0.0.1.** `cloudflared tunnel --url http://127.0.0.1:8000` → open `<tunnel URL>/health` in a browser → JSON, not 502; the worker cell connects.
22. **Worker upload retry (re-paste the worker cell first).** During a real job, turn Wi-Fi off just before "uploading N result files…" and on again after ~20 s → the cell prints "upload failed …; retrying in 5 s (try 1 of 5)…", then "✓ … done"; the area appears.
23. **Warm cache on the demo laptop.** The day before: `tools\warm_osm_cache.py` ends with "Everything cached", and `--check` says "all answered from the cache". On the day, click each demo street in Analyse → the street and its estimate appear within about a second.
24. **No map key.** Blank `GOOGLE_MAPS_BROWSER_KEY` in `backend/.env`, restart the API → "The map can't be shown" with four working links; Review shows "Street View photos need the Google Maps browser key". Restore the key.
25. **API restart mid-demo.** Stop the API while the app is open, click Jobs → orange banner "The API isn't answering…"; start the API, click Review → the banner goes.
26. **Hood cost caption.** Under the Hood → Ward 29 → Time and cost: "about $9.94 … (1,420 photos)" and "Photo cost is at Google's list price — Google's free monthly allowance may cover it."
27. **Trust.** Detector: the sign-box sentence (6 of 20, AI check). Gate 1: no pooled "all buildings" row in the two map-referenced tables, and the note says why; "73%" nowhere.
28. **Daylight buttons.** Hover the orange solid buttons (Next, Finish, Approve) in Daylight → the text stays readable.
29. **Colab cells.** Paste the exact S0, S1a, S1ba and S1bb cell text into `worker/colab_setup_cells.md` (the "PASTE CELL HERE" blocks).

## P8
30. **Routing and cost.** Under the Hood → Ward 29 → Routing and cost: as run $0.070 (589 calls), no router $0.089 (782), every photo ≈ $0.112 (estimate); hover a cost → its source; the model-card check box.
31. **Photo date.** Explore → a building → the photo shows "Photo from …"; w1252505151 (8th Street, Ganapathy) shows "over 3 years old" and "Imagery may be outdated" at the top.
32. **Front wall.** Same drawer → "Front wall 33.4 m along the street, from the map outline"; How do we know? → its source.
33. **Possible dark stretch.** Key number "Possible dark stretches" → list says "the detector finds about 43% of lamp heads"; hover a black band → the card says it too.
34. **Tamil.** Ask "பதிவேட்டில் இல்லாத கடைகள்" → Shops, not in the register (5); "60 மீட்டருக்குள் தெருவிளக்கு இல்லாத தெருக்களைக் காட்டு" → 11 possible dark stretches.
35. **Worker (re-paste the worker cell, upload the p7b zip).** After a real job: the cell prints "deleted N Street View photo crops (X MB)"; `/content/gc_jobs` has no folder for it.

## Gate 1 in the building drawer (D52)
36. **Position per building.** Explore → Ward 29, click (or Ctrl K / table):
    - w1252504250 → Position "2.8 m from the middle of the front wall on the map (target ≤ 3.5 m) ✓ within", then "Front wall chosen: the one facing 8th Street, Ganapathy (a corner building…)".
    - w1252505716 → "8.7 m … ✗ outside".
    - w1252505151 → "Position taken from the map outline — error not measured." No "0 m" anywhere in its drawer.
    - At street zoom click an orange diamond (camera-only layer) → drawer "No map outline for this building — error can't be measured." and "Uncertainty about ±N m".
    - Building → second "How do we know?" → Position check: the distance to two decimals, "n = 260, median 2.8 m, 60.4% within 3.5 m" — open Trust → Building position (Gate 1) → "All camera-derived positions" row for Ward 29 shows the same 260 / 2.8 m / 60.4%. Repeat once in Daylight.
