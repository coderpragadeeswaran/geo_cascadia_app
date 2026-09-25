# Prompts for Claude Code — paste ONE at a time, wait for the checkpoint, check it, then continue

Open a terminal in `geo-cascadia-app/`, run `claude`, then:

---
## Prompt 0 — orientation (no code yet)
```
Read CLAUDE.md completely, then inspect data/, pipeline/geo_cascadia/ and tools/. Do not write app code yet.
Report back: (1) the areas you found and their meta.counts, (2) any schema differences between the three
export.json files vs CLAUDE.md §4, (3) your concrete plan for P0–P7 with the libraries and versions you will use,
(4) anything in CLAUDE.md you think is wrong or risky on an 8 GB Windows laptop. Keep it short.
```

## Prompt 1 — P0 skeleton + run reports
```
Do phase P0 from CLAUDE.md: create the repo layout, init git (local only), add .gitignore (.env, node_modules, venv,
__pycache__), run tools/build_run_report.py for every folder in data/areas/, and generate TypeScript types for
export.json, run_report.json and model_card.json in web/src/types/. Stop at the P0 checkpoint and show me the
story[] lines for each area.
```

## Prompt 2 — P1 database
```
Do phase P1. Write the Supabase/PostGIS schema as a SQL migration (backend/migrations/001_init.sql) and
backend/load_area.py (idempotent upsert of export.json + run_report.json per area). Read the DB URL from
backend/.env (DATABASE_URL) — create backend/.env.example, never hard-code it. Tell me exactly what to put in
backend/.env and how to run the migration in the Supabase SQL editor. Then load all three areas and show row
counts vs meta.counts. Stop at the checkpoint.
```

## Prompt 3 — P2 API
```
Do phase P2: FastAPI app in backend/ with every endpoint in CLAUDE.md §7. /query must reuse
pipeline/geo_cascadia/workspace.QueryEngine exactly as §7 describes and return why_empty when there are no rows.
Add simple tests (pytest) for the 5 spec queries in §10 on Ward 29. Give me the command to start the API and
the Swagger URL. Stop at the checkpoint and paste the test output.
```

## Prompt 4 — P3 web foundation + map
```
Do phase P3. Set up web/ with React + Vite + TypeScript, Tailwind, shadcn/ui, Framer Motion,
@vis.gl/react-google-maps (vector map with my Map ID), deck.gl GoogleMapsOverlay, TanStack Query, Zustand.
Read VITE_MAPS_BROWSER_KEY and VITE_MAP_ID from web/.env (create .env.example). Implement the design tokens and
the zoom-driven map in CLAUDE.md §9.1–9.3: city → hybrid satellite area view → tilted street view with 3D
footprints extruded by floors and coloured by match status, asset icons with uncertainty circles, streetlight
gaps, unmapped businesses, Street View coverage toggle, legend, minimap, layer switcher. Make it look premium,
not like a template. Stop and tell me how to run it; I will send you screenshots.
```

## Prompt 5 — P4 Explore page
```
Do phase P4: the complete Explore page from CLAUDE.md §9.4.1 — KPI ribbon (click to filter), right panel
(Findings table with the spec columns, Charts with bar-click-to-zoom, Streetlights), the Evidence drawer with
the Street View dive (Static image of the exact evidence view with the box drawn + toggle to live panorama,
reverse animation back to map), route badges using model_card.json, register labelled synthetic, the query bar +
Ctrl+K command palette with editable filter chips and the why_empty funnel, and one global selection store so
street/segment selection filters everything together. Also the "Analyse a street" mode UI calling POST /jobs
(show the honest queued state if no worker). Verify acceptance tests 1–6 in CLAUDE.md §10 and tell me how you
checked each one.
```

## Prompt 6 — P5 Under the Hood, Trust, Review, Jobs
```
Do phase P5: the Under the Hood page (CLAUDE.md §9.4.2) driven only by run_report.json and meta.run — animated
story timeline, Sankey of the whole pipeline, sign funnel, stage Gantt, cost waterfall, route donuts, coverage
verdict banner, per-street table, "what got dropped and why", and a side-by-side Compare of the three areas.
Then the Trust page from model_card.json (including rejected experiments), the Review page with keyboard
shortcuts and appeal photo upload (Supabase Storage), and the Jobs page. Verify acceptance test 7 and a review
round-trip (approve an item, reload, it stays approved, map updates).
```

## Prompt 7 — P6 worker + live analysis
```
Do phase P6. Write worker/colab_worker.py as ONE Colab cell I paste after my existing setup cells (S0, S1a, S1b
from my steps notebook, which define D, PKG, cfg, run_area). It must: read BACKEND_URL and WORKER_TOKEN
(I'll paste them via getpass), heartbeat, claim jobs, run click_to_street / polygon → run_area with a progress
callback that posts to /worker/progress, upload export.json + all run .json files to /worker/result, map
NO_STREET_VIEW / NO_STREETS / NO_CAMERAS and "AWS token expired" to job statuses as CLAUDE.md §8 says, and loop.
Backend side: /worker/result saves to data/areas/<slug>/, runs build_run_report, loads it. Give me the exact
steps: start API, start cloudflared tunnel, paste URL into the Colab cell, click a street in the UI.
Include the live progress animation along the street in the UI.
```

## Prompt 8 — P7 polish
```
Do phase P7: Guided tour (CLAUDE.md §9.5) running the spec queries with fly-throughs and captions on
pre-computed data; loading skeletons, empty and error states everywhere; light/dark theme; keyboard access;
performance check on a low-RAM laptop (lazy-load pages, virtualize the table, throttle deck.gl layers by zoom);
a README with start-up steps for the demo day. Then do a final pass: open every page and list anything that
still looks generic or unfinished, and fix it.
```

---
## Useful follow-up prompts (use anytime)
- `Here are screenshots of <page>. Make it look more premium: <what you dislike>. Keep all data real.`
- `Acceptance test <n> fails: <what happened>. Find the cause and fix it; don't change pipeline logic.`
- `Explain in 5 lines what you changed and why, and what I should test.`
- `Something in CLAUDE.md contradicts what you see in the data: tell me before changing anything.`
