# Prompts for Claude Code — ONE at a time, wait for the checkpoint, verify, then continue

Numbering = phase numbering in CLAUDE.md (P2 prompt = phase P2).
Use the Claude Code side panel in VS Code, same chat. If interrupted, type: continue

## Rules added to EVERY prompt (already included below)
- Read docs/DECISIONS.md first; it overrides CLAUDE.md where they differ.
- Counts come from the data, accuracy metrics only from model_card.json (floors n=36).
- Never print or log secret values from .env.
- Run python tools/verify_setup.py at the end; it must stay 0 fail.
- Stop at the checkpoint, list exactly what I should verify, and wait. Commit only after I say "checks pass, commit".

---
## ✅ Prompt 0 — orientation (DONE)
## ✅ P0 — skeleton + run reports (DONE, commit ac21312)
## ✅ P1 — database (DONE, commit e35967f, verified: all counts match, 160/381 unclassified)

---
## P2 — API
```
Do phase P2. Read docs/DECISIONS.md first.
FastAPI app in backend/ with every endpoint in CLAUDE.md §7, run from backend/.venv.
- /query must reuse pipeline/geo_cascadia/workspace.QueryEngine exactly as §7 describes and return why_empty when there are no rows.
- GET /config/public serves the browser Maps key + Map ID from backend/.env (browser key only, never the server key).
- Offline fallback (DECISIONS): if Supabase is unreachable/paused, serve read-only data from data/areas/*.json and include "offline": true in responses so the UI can show a badge. Test this by pointing at a bad DB URL.
- Every response uses the same record shape from DB or JSON.
- Counts in any summary endpoint are computed from records (20 triangulated in ward29, 160 not classified), never copied from story text.
- pytest: the 5 spec queries in §10 on Ward 29, plus one offline-mode test.
Give me the command to start the API (port 8000) and the Swagger URL.
Never print secrets. Run python tools/verify_setup.py (0 fail). Stop at the checkpoint, paste the pytest output, list what I should verify, and wait.
```

## P3 — web foundation + map
```
Do phase P3. Read docs/DECISIONS.md first.
web/ is already set up (Vite, TS). Add Tailwind, shadcn/ui, Framer Motion, @vis.gl/react-google-maps (vector map), deck.gl GoogleMapsOverlay, TanStack Query, Zustand.
- Maps key + Map ID come from GET /config/public on the backend, NOT from web env. web/.env.local only has VITE_API_URL.
- Implement design tokens and the zoom-driven map in CLAUDE.md §9.1–9.3: dark city view → hybrid satellite area view → tilted street view with 3D footprints extruded by floors and coloured by match status; asset icons with uncertainty circles; streetlight gaps; unmapped businesses; Street View coverage toggle; legend; minimap; layer switcher.
- Buildings with no floors (160 in ward29) render as flat footprints with a "not classified" style, never a guessed height.
- Offline badge when the API reports offline.
- Performance (DECISIONS): one map instance, DPR cap 1.5, reduce-motion / 2D toggle, JS heap target ≤60 MB.
Make it look premium, not like a template.
Never print secrets. Run python tools/verify_setup.py (0 fail). Stop, tell me the exact commands to run API + web, what to check in the browser (incl. F12 console), and wait for my screenshots.
```

## P4 — Explore page
```
Do phase P4. Read docs/DECISIONS.md first.
The complete Explore page from CLAUDE.md §9.4.1:
- KPI ribbon (click to filter), including "use: not classified" as its own visible number.
- Right panel: Findings table with the spec columns, Charts with bar-click-to-zoom, Streetlights.
- Evidence drawer with the Street View dive: Static image of the exact evidence view with the box drawn + toggle to live panorama, reverse animation back to map.
- Route badges using model_card.json; register labelled synthetic.
- Query bar + Ctrl+K palette with editable filter chips and the why_empty funnel.
- One global selection store so street/segment selection filters everything together.
- "Analyse a street" mode UI calling POST /jobs (honest "queued, no worker connected" state).
Verify acceptance tests 1–6 in CLAUDE.md §10 and tell me how you checked each.
Never print secrets. Run python tools/verify_setup.py (0 fail). Stop, list what I should click/check in the browser, and wait.
```

## P5 — Under the Hood, Trust, Review, Jobs
```
Do phase P5. Read docs/DECISIONS.md first.
Under the Hood page (CLAUDE.md §9.4.2), driven by run_report.json + meta.run + computed counts:
- animated story timeline (story text corrected to computed numbers: ward29 = 20 triangulated / 248 approximate, 163 local / 58 VLM, 160 not classified)
- Sankey of the whole pipeline incl. "what got dropped and why", sign funnel, route donuts, coverage verdict banner, per-street table
- Stage timings and cost: per DECISIONS, show them greyed out with a "resumed run, not representative" badge; ward29 cost from model_card labelled "from model_card". No chart that implies the resumed timings are real.
- Side-by-side Compare of the three areas.
Trust page from model_card.json: production vs rejected experiments clearly separated (floors production variant vs rejected 3-example variant), plus a "stored vs computed" mismatch list.
Review page: keyboard shortcuts, appeal photo upload to the private appeal-photos bucket (signed URLs only).
Jobs page.
Verify acceptance test 7 and a review round-trip (approve an item, reload, it stays approved, map updates).
Never print secrets. Run python tools/verify_setup.py (0 fail). Stop, list what I should check, and wait.
```

## P6 — worker + live analysis
```
Do phase P6. Read docs/DECISIONS.md first.
Write worker/colab_worker.py as ONE Colab cell I paste after my existing setup cells (S0, S1a, S1b, which define D, PKG, cfg, run_area).
- Reads BACKEND_URL, WORKER_TOKEN and GOOGLE_MAPS_KEY (server key) via getpass; never prints them.
- Heartbeat, claim jobs, run click_to_street / polygon → run_area with a progress callback posting to /worker/progress.
- Upload export.json + all run .json files to /worker/result.
- Map NO_STREET_VIEW / NO_STREETS / NO_CAMERAS and "AWS token expired" to job statuses per CLAUDE.md §8; loop.
- Handles a changed tunnel URL (BACKEND_URL is a variable, re-enterable).
Backend: /worker/result saves to data/areas/<slug>/, runs build_run_report, loads via the existing loader.
UI: live progress animation along the street; "worker offline" state.
Give me exact steps: start API, start cloudflared quick tunnel, add the tunnel URL to the Maps key website restrictions and CORS_ORIGINS, paste URL into the Colab cell, click a street.
Never print secrets. Run python tools/verify_setup.py (0 fail). Stop, list what I should check, and wait.
```

## P7 — polish
```
Do phase P7. Read docs/DECISIONS.md first.
Guided tour (CLAUDE.md §9.5) running the spec queries with fly-throughs and captions on pre-computed data; loading skeletons, empty and error states everywhere; light/dark theme; keyboard access; performance on an 8 GB laptop (lazy-load pages, virtualize tables, throttle deck.gl layers by zoom); README with demo-day start-up steps including the offline fallback and what to do if Supabase is paused.
Final pass: open every page, list anything that looks generic or unfinished or shows a number that disagrees with the computed counts, and fix it.
Never print secrets. Run python tools/verify_setup.py (0 fail). Stop, list what I should check, and wait.
```

---
## Follow-up prompts (use anytime)
- `Here are screenshots of <page>. Make it look more premium: <what you dislike>. Keep all data real.`
- `Acceptance test <n> fails: <what happened>. Find the cause and fix it; don't change pipeline logic.`
- `Explain in 5 lines what you changed and why, and what I should test.`
- `Something in CLAUDE.md contradicts what you see in the data: tell me before changing anything.`
- `checks pass, commit this phase`
- `continue`