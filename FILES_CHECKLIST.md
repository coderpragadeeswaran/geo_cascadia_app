# What to collect before opening Claude Code

## A. Files from this kit (download the zip, unzip into a new folder `geo-cascadia-app/`)
| file | goes to |
|---|---|
| `CLAUDE.md` | `geo-cascadia-app/CLAUDE.md` (repo root — Claude Code reads it automatically) |
| `PROMPTS.md` | keep beside you; paste prompts from it one phase at a time |
| `model_card.json` | `geo-cascadia-app/data/model_card.json` |
| `tools/build_run_report.py` | `geo-cascadia-app/tools/build_run_report.py` |

## B. Files YOU already have on Google Drive (`/MyDrive/alldataset/…`) — download and place
| from Drive | to repo |
|---|---|
| `geo_cascadia_pkg/geo_cascadia/` (whole folder, **latest version** — the one with `localuse.py`) | `pipeline/geo_cascadia/` |
| `Study_area.geojson` | `data/study_area/Study_area.geojson` |
| `runs/ward29_full_v2/*.json` (**only the .json files**, not the crops folders) | `data/areas/ward29/` |
| `runs/ward29_full_v2/export.geojson` | `data/areas/ward29/` |
| `runs/unseen_Tiruchirappalli_Bharathidasan_Salai/*.json` + `export.geojson` | `data/areas/trichy_bharathidasan_salai/` |
| `runs/unseen_Uthukuli_Road/*.json` + `export.geojson` | `data/areas/tiruppur_uthukuli_road/` |

Do NOT copy: `crops_*` folders, model weights, `ward29_full`, `ward29_full_y26s`, `regression_2streets` (not needed by the app).
Tip: in Drive, open each run folder → select only files ending `.json`/`.geojson` → Download (Drive zips them).

## C. Accounts / keys to prepare (never paste them into Claude Code chat; put them in `.env` files when asked)
1. **Google Maps browser key + Map ID** (Google Cloud Console, same project as your current key):
   - APIs & Services → enable **Maps JavaScript API**, **Street View Static API** (already on), **Places API (New)** (already on).
   - Credentials → Create API key → Restrict: *Application restrictions* = HTTP referrers → add `http://localhost:5173/*`
     and later your tunnel/demo URL; *API restrictions* = Maps JavaScript API, Street View Static API, Places API (New).
   - Google Maps Platform → **Map Management → Create Map ID** → type *JavaScript*, **Vector** (enables tilt/3D). Copy the Map ID.
   - Keep your existing server key (GOOGLE_MAPS_KEY) for the backend/worker only.
2. **Supabase** (free): new project, region Mumbai → SQL editor → `create extension if not exists postgis;` →
   Project Settings → Database → copy the **connection string (URI)** and the **service role key** (Storage uploads for appeal photos).
3. **Cloudflare tunnel** (for the Colab worker to reach your laptop): install `cloudflared` for Windows (winget install Cloudflare.cloudflared).
   No account needed for quick tunnels.
4. A **worker token**: any long random string you make up (shared by backend `.env` and the Colab worker cell).
5. Your existing **AWS portal** keys stay only in Colab (worker). The laptop never needs them.

## D. Software on the laptop
- **Node.js 20 LTS** (includes npm), **Python 3.11**, **Git** (Claude Code uses it locally; no GitHub needed), **Claude Code**.
- Python packages the backend needs will be installed by Claude Code into a venv (`fastapi`, `uvicorn`, `sqlalchemy`, `psycopg`,
  `geoalchemy2`, `shapely`, `requests`). **Do not** install torch/paddle/ultralytics on the laptop.

## E. Final folder before the first prompt
```
geo-cascadia-app/
  CLAUDE.md
  PROMPTS.md            (optional to keep here)
  data/model_card.json
  data/study_area/Study_area.geojson
  data/areas/ward29/ (export.json, export.geojson, coverage.json, panos.json, plan.json, detections.json, ocr.json, …)
  data/areas/trichy_bharathidasan_salai/ (…)
  data/areas/tiruppur_uthukuli_road/ (…)
  pipeline/geo_cascadia/ (__init__.py, config.py, run_area.py, workspace.py, picker.py, …)
  tools/build_run_report.py
```
