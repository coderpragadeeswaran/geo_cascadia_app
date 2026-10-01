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
