# Night Survey — design system

Status: **approved and applied to the app** (design pass B, docs/DECISIONS.md D15–D20). The proposal stays at
`http://localhost:5173/design-preview` as the reference route.
Single source of tokens: [`web/src/design/tokens.ts`](../web/src/design/tokens.ts). `applyMode()` (`design/mode.ts`)
writes the CSS variables onto `<html>`, the Tailwind colour names are aliases of them, and deck.gl reads the same values.

## Concept
The city at night, lit by its own streetlights. The base is deep night indigo, never neutral grey. The one accent is
**sodium-lamp orange**, the colour of Indian streetlights. On the map, analysed roads glow where they are lit, and every
**streetlight gap is drawn as a dark stretch of road** on top of that glow. The core finding ("where is it dark?")
reads without a legend. Findings (no record, discrepancy) are the only coloured points at area level; matched buildings
recede.

Structure comes from **space, thin rules and type**, not from cards: no glass, no blur, no pill clusters. Panels appear
only when there is a question or a selection.

## Colour

| token | night | daylight | role |
|---|---|---|---|
| `bg0` | `#070a14` | `#f4f0e6` | page / map surround |
| `bg1` | `#0b1020` | `#fbf8f1` | panels (flat) |
| `bg2` | `#121936` | `#ffffff` | sheets, popovers |
| `ink` / `ink2` / `ink3` | `#ebe6da` / `#bec4d9` / `#9098b5` | `#1b1f2a` / `#3d4356` / `#5b6070` | text hierarchy; every step ≥ 4.5:1 (WCAG AA) on every surface |
| `line` / `lineStrong` | 13 % / 28 % of `#a0afdc` | 12 % / 30 % of ink | rules |
| `sodium` | `#ffa23a` | `#9c4e07` | the only accent: lights, selection, primary action (daylight darkened for text contrast) |
| `sodiumGlow` | `#ffc27a` | `#e08a2a` | lamp halos, lit roads |
| `matched` | `#6a7fb0` dusk slate | `#8e9dc4` | nothing wrong, recedes |
| `discrepancy` | `#7dcad6` glacier | `#00849f` | soft cool / deep teal |
| `noRecord` | `#e7819f` peony | `#cc1f63` | soft rose / deep rose |
| `review` | `#ebe6da` | `#1b1f2a` | chalk: dashed outline, never a fill |
| `unclassified` | `#4a5270` | `#b9b2a2` | floors / use not classified (hatched, D9) |
| `dark` / `darkEdge` | `#02040a` / `#34407a` | `#1b1f2a` | unlit stretch of road |

**Status colours are computed, not eyeballed.** I ran the dataviz palette validator (`validate_palette.js`, OKLab ΔE),
with the sodium accent included because it shares the map with the statuses, checking all pairs.

- **v2 night (current, "soft")** on `#0a0e1c`: dusk slate `#6a7fb0` · glacier `#7dcad6` · peony `#e7819f`.
  - Colour-blind separation PASS (worst ΔE 8.2, protan: peony ↔ slate).
  - Normal-vision floor PASS (16.4).
  - Contrast ≥ 3:1 PASS.
  - Chroma is 0.078–0.079, just under the validator's "vivid" floor of 0.10. That softening is the point of v2; every
    status also has a text label, so colour is never the only cue.
- **v1 night** (first preview, rejected as too neon): `#7c93c9` · `#3fd4e0` · `#ff4f9a`. Kept in `statusV1Night` only
  for the old-vs-new comparison in the preview.
- **Daylight** on `#f4f0e6` (unchanged):
  - Colour-blind separation PASS (worst ΔE 8.6, deutan: sodium ↔ rose).
  - Normal-vision floor PASS (15.3).
  - The pale matched is 2.4:1 against paper by design, so it always has an ink outline and every value is also in the
    table (the validator's "relief" rule).
- The categorical lightness band is not applied: the validator scopes it to categorical series, and these are statuses.
- Hue logic: warm (sodium) is "the lit city", and cool or muted colours are findings. Red-green pairs failed the
  validator (green ↔ rose ΔE 3–5 deutan), so the palette avoids them.

## Type
- **Anek Tamil** (Ek Type, OFL): one variable family for **Latin and Tamil** (weight 100–800, width 75–125 %). Sign
  text in the data is Tamil; Inter has no Tamil glyphs. Condensed widths set titles; normal width sets reading text.
- **Martian Mono** (OFL, weight 100–800, width 75–112.5 %): every measurement, count, coordinate and ID. Tabular by
  nature, with an instrument feel.
- **Self-hosted** from `@fontsource-variable/*` (bundled by Vite). No Google Fonts requests. The preview also stops the
  Maps JS API from injecting its Roboto stylesheet; our fonts cover the attribution text.

| style | family | size / line | weight | width |
|---|---|---|---|---|
| display | Anek Tamil | 32 / 1.0 | 640 | 78 % |
| title | Anek Tamil | 20 / 1.15 | 600 | 85 % |
| body | Anek Tamil | 17 / 1.45 | 420 | 100 % |
| small | Anek Tamil | 15 / 1.4 | 430 | 100 % |
| micro (caps, +0.1em) | Anek Tamil | 13 / 1.2 | 600 | 105 % |
| figure (KPIs) | Martian Mono | 26 / 1.0 | 300 | 100 % |
| data (IDs, metres) | Martian Mono | 14 / 1.3 | 400 | 90 % |

## Space, radii, motion
- **Space:** 4-pt steps `2 4 8 12 16 24 32 48`.
- **Radii:** hairline 2, controls 6, sheets 10. Sharper than the glass UI (14).
- **Motion:** quick 120 ms, base 200, slow 320; ease `cubic-bezier(0.2,0.7,0.2,1)`.
  - Opening: a 2.6 s flight in over the dark city, then the streetlights fade on over 1.8 s, staggered per lamp.
  - `prefers-reduced-motion` (and the 3D-off switch) skip both and show the final state.

## Map language
| element | night | daylight |
|---|---|---|
| analysed road | sodium line + soft additive glow | sodium line |
| **streetlight gap (60 m)** | **dark band** (`dark`) with a cold edge | heavy ink band |
| gap to check (D13) | dark band + dotted chalk edge | same |
| streetlight | glowing orb (additive halo), fades on | sodium dot |
| pole without lamp | street level only: small unlit dot | street level only |
| building, area level | findings only (peony / glacier points); matched from street level | same |
| unmapped business | hollow ring, from street level | same |
| building, street level | extruded by floors, status colour; no floors → flat + hatched | same |
| unmapped business | hollow ring (approximate) | same |
| selection | sodium outline | sodium outline |

## Declutter rules (applied in the preview)
1. The map is the hero. The right panel appears only for a question (query result) or a selection (evidence drawer).
2. **KPIs:** five numbers (buildings, no record, discrepancy, dark stretches, use not classified) plus "More". They sit
   on a scrim, with no cards and no horizontal scroll.
3. **Findings table fits its panel.** Columns drop by priority using container queries:
   - 380 px: id · name/street · register;
   - 460 px: adds use and floors;
   - 600 px: adds review.
   Location and model routes move to the row tooltip and the drawer.
4. **One chart per question.** The query chart replaces the regular chart of the same thing.
5. **Findings-density hexbins are off by default.** The key (legend) is collapsed and only lists what is on screen.
   The minimap is optional (off by default).
6. **Street View coverage lines only in Analyse mode**, and only near the cursor. The map dims like a flashlight
   outside a 150 px circle around the pointer (`.flashlight`).
7. Status colour only where there is a status. Everything else is ink.
8. **Area level: lit vs dark roads are the dominant read.** Poles, matched buildings and unmapped-business rings appear
   only from street level, in both modes (pass B; the preview still showed them faintly at night).
9. **Two audiences** (D16): user screens speak plain language; technical detail is behind "How do we know?" and on the
   verifier pages (Under the Hood, Trust).

## App structure
- **The map is home.** Explore, Analyse and Drive the street are modes of the map, never separate pages. At most **one
  panel** is open: a selection's evidence, a drive, a question's result, a key number's list, a street, or "What stands
  out" (`store/ui.ts` `panelOf`). It stops above Google's attribution.
- **A 64 px left rail** (icon + label) reaches **Review · Under the Hood · Trust · Jobs**. The active item is marked
  with a sodium bar. At the bottom: **Tour (?)** (the guided tour) and the Night / Daylight toggle.
- **Review:** queue (priority first) | the evidence view with its box | the decision column (A / R / E, J / K).
- **Trust:** "what we measured" (detector per class with n, use, floors n=36, names routed vs all-VLM) and "tried and
  dropped", every number from `model_card.json`.
- **Jobs:** pre-computed runs, plus analyses started from the app, with an honest empty state and worker status.

## Drive the street
Select a street → **Drive this street**; a scrubber moves the camera **through the pipeline's real camera stops**, in
driving order per branch (D20: stops ordered along the merged road line, strictly forward; forward = road tangent).
- **Road strip:** the whole street at once. The road is sodium where lit and a dark band on each gap, with lamp ticks,
  buildings above (left side) and below (right side), and camera-stop ticks.
- **Controls:** drag, click, ←/→ to step, or ▶ Drive to play one stop every 1.3 s (1.6 s with reduced motion).
- **Map:** follows the camera, with a 90° view wedge; findings within 20 m grow and get an outline.
- **Street View frame:** the forward view (the street's bearing) at the current stop. It is debounced by 350 ms, so it
  bills **one image per stop you settle on**, not one per pixel of scrubbing.
- **Right column:**
  - the status: "Dark stretch · no lamp within 60 m" with the gap id and recorded / on-road length, or "Lit · nearest
    lamp X m";
  - "Passing now": buildings, lamps and unmapped businesses within 20 m, animating in and out;
  - counts so far.
- **Data:** `GET /areas/{slug}/drive?street=` (backend/app/drive.py). The preview's bundled file
  (`web/src/design/data/ward29-sathy-drive.json`, from `tools/export_drive_street.py`) keeps the old, flawed ordering
  (39 stops interleaving the side piece) and is used by `/design-preview` only.
- **In the app:** the map follows the camera with a direction arrow and a view wedge; Forward / Left / Right view; the
  next stop's image is preloaded; the panel says each stop you stop at loads one billed Street View image.

## Under the Hood as a scroll story
As built (P5, D29–D31): a **coverage & summary** panel, then **ten chapters**, each a figure counted from the run's own
files, one plain sentence, a kept-vs-dropped bar and "see real examples":
01 Streets planned · 02 Camera positions · 03 Photos fetched · 04 Objects detected · 05 Signs read · 06 Local or cloud AI ·
07 Floors and use · 08 Positions · 09 Matched · 10 Findings. Then: the whole pipeline (funnel), what got dropped and why,
street by street, street names, and time and cost (photo cost at Google's list price — the free monthly allowance may
cover it; cloud-AI cost as measured, P7 R3). Compare all runs side by side. The design preview's seven chapters
(`/design-preview`) are the first version and are kept only there.

Countable facts are computed from the records (D2): the story shows **20** triangulated and explains the report's 29.
Timings of the three original runs carry the "resumed run, not representative" badge (D1). Reduced motion shows final
values without animation.

## Guided tour (P7.5)
Seven steps in plain words, on the real data: the key numbers → a building's evidence → Review → Analyse a street → Jobs →
Trust (Gate 1 "Not verified") → done. One `bg2` sheet with a sodium edge, bottom-left over the map (top-right on the
Analyse step, clear of its bottom sheet); the step's target gets a sodium ring. Started from **?** (Tour) at the bottom of
the rail; opens by itself once, on the first visit (`gc.tourSeen`). Esc closes, ← → and Enter step, focus sits on Next.
Each step says what is missing instead of failing (no area, no building, no worker, no model card).

## States (P7 R3)
- **Loading** always says what loads ("Loading the Street View photo…", "Loading this area's results…"), not a bare pulse.
- **Errors** say what failed in plain words and offer "Try again"; a missing record says so instead of loading forever.
- **The API stops answering:** a sodium banner at the top ("The API isn't answering … What is on screen stays").
- **No Maps browser key / Map ID:** the app opens without the map ("The map can't be shown", with links to Review, Under
  the Hood, Trust and Jobs); Street View photos say the key is missing; Live 360° is hidden.
- `.btn-solid:hover` mixes sodium 86% with ink (the old glow hover was 2.4:1 in Daylight).

## Base map: Google Cloud settings for your Map ID
With a Map ID, the map's own look (land, roads, labels, POIs, Google's buildings) is controlled **only in Google
Cloud**. The JS `styles` option is ignored on vector maps. Both files are in Google's **new cloud-based maps styling
JSON** format (`{"variant": …, "styles": [{"id": …, "geometry": …, "label": …}]}`), generated from `tokens.ts` by
`npm run map-styles`. They use only feature IDs and stylers listed in Google's JSON reference, and a local check
confirms every ID, styler and colour against that list.

| file | variant | becomes | holds |
|---|---|---|---|
| `docs/map-styles/night.json` | `dark` | the Map ID's **dark-mode** style | night palette |
| `docs/map-styles/daylight.json` | `light` | the Map ID's **light-mode** style | paper palette |

Both files hide POI pins and labels, transit stations, 2D and 3D Google buildings (commercial included), business
corridors, road shields and signs, parking aisles and land-parcel lines, and **mute the green** of parks, sports
fields, golf courses, nature reserves, cemeteries and land cover (forest, shrub, crops) to the land's own tone, so no
green competes with sodium. `npm run map-styles` checks every rule against Google's schema
(`developers.google.com/static/maps/cbms-json-schema.json`, copied into `CLOUD_STYLERS`) and refuses invalid stylers.

**Re-upload both files after design pass B:** the park muting is new, and the pass-A files had one rule the schema
does not allow (`political.landParcel` with a label styler; now `geometry.visible: false`). In Map Styles open each
style, replace its JSON with the new file (or create new styles and swap them on the Map ID), then Publish.

A style's mode comes from `variant` and cannot be changed after creation. A Map ID takes exactly one light-mode and
one dark-mode style, and the app picks one with `colorScheme` (DARK = night, LIGHT = daylight).

**Steps (twice: night.json first, then daylight.json)**
1. Google Cloud Console → **Google Maps Platform → Map Styles → Create style → JSON** tab →
   **Upload JSON File**. Choose `docs/map-styles/night.json`. If the importer reports "Your JSON contains N errors",
   stop and send me the message.
2. Click **Customize**. Open **Map Settings** (the gear in the Map features panel) and set:
   - **Building style: Footprints.** 3D vs footprints is a Map Settings toggle, not part of the JSON. The JSON already
     hides building geometry; this makes sure nothing is extruded if Google changes defaults.
   - **POI density:** the lowest option, and **Landmarks:** off, if your editor shows them.
3. **Save** it as "GEO Night Survey". It publishes automatically on first save; later edits need **Publish**.
4. Repeat with `daylight.json` → "GEO Night Survey daylight".
5. **Map Management → your Map ID → Map styles:** set **Dark mode → GEO Night Survey** and **Light mode → GEO Night
   Survey daylight**, then **Save**. Google notes that style changes can take **a few hours** to reach apps.

**Limits to know**
- **Dark-mode styles apply only to roadmap, navigation and terrain**, not hybrid (satellite). So the night map stays
  on roadmap; satellite is a daylight-only option.
- The code cannot hide POIs or Google's buildings on a Map ID map; only these styles can.

**What the code handles:**
- `colorScheme` per mode;
- `mapTypeId: roadmap` by default;
- default UI off and POI clicks off;
- every data layer;
- blocking the Roboto webfont.

The preview's "Intended style (JSON preview)" shows the same palette on a raster map. It uses the legacy array form
of the same colours, because the JS `styles` option only accepts that format.

## Files
- `web/src/design/tokens.ts`: all tokens and **one** base-map palette (`mapBase`). It feeds `mapStyleJson`
  (legacy array, preview raster map only) and `cloudMapStyle()` (new Cloud JSON, checked by `CLOUD_STYLERS`).
  `npm run map-styles` writes `docs/map-styles/{night,daylight}.json`. `design/mode.ts` applies a mode to `<html>`.
- `web/src/design/night-survey.css`: `.ns` base styles (on `<body>` in the app) and the font imports;
  `web/src/index.css` maps the Tailwind colour names onto the tokens.
- `web/src/map/layers.ts`: the app's map layers in this language (the preview's `nsLayers.ts` is kept for
  `/design-preview`).
- `web/src/design/NsParts.tsx`, `NsShell.tsx`, `NsDrive.tsx`, `NsStory.tsx`, `DesignPreview.tsx`: the preview.
- `tools/export_drive_street.py`: builds the drive data from `plan.json`, `streets.json` and `export.json`.
