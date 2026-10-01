"""P7.2: the analyse-a-street estimate from the REAL camera plan — the same pipeline code the worker runs before it buys
any photo (run_area stages 1-3: geo_cascadia.streetview.StreetView.discover, area.Area footprints + streets,
plan.capture_plan, plan.building_register), with the pipeline's own Config defaults (spacing, headings, dedupe).

Images = planned views + one building crop per building faced (the worker's cost-cap rule; an upper bound: the run
re-fetches crops only for buildings with a usable box). Rates come from records, never tuned:
- Street View price: model_card.cost_time.street_view_price_usd_per_image;
- seconds per image and cloud-AI $ per image: completed live jobs that ran from the start (live_run.json not resumed,
  not a replay), pooled (total time / total images); job time = worker claim -> upload. Without such jobs: the Ward 29
  full run (model_card GPU minutes over the photos counted from its run files);
- Google look-ups per image from the same jobs (counted; no price is recorded, so they are not in the dollar total).

Planning costs nothing billable (Street View metadata calls are free) but takes seconds to minutes (Overpass), so it
runs in the background: start() returns a key, status() is polled. Results are cached in memory and on disk.
"""
import hashlib
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from shapely.geometry import shape

_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="planest")
_JOBS, _LOCK = {}, threading.Lock()


def _parse_t(s):
    return datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def photos_of_run(folder):
    """Street View photos a run fetched, from its files: the views fetched (_views_done.json) + one building crop per
    reliable building view (building_views.json; what vlm.run_building_attrs re-fetches). None if a file is missing."""
    try:
        with open(os.path.join(folder, "_views_done.json"), encoding="utf-8") as f:
            views = len(json.load(f))
        with open(os.path.join(folder, "building_views.json"), encoding="utf-8") as f:
            crops = sum(1 for r in json.load(f) if isinstance(r, dict) and r.get("reliable"))
    except (OSError, ValueError):
        return None
    return {"views": views, "crops": crops, "photos": views + crops}


def measured_rates(areas_dir, model_card):
    """Seconds and cloud-AI dollars per Street View image, from completed live jobs (see module doc)."""
    ct = (model_card or {}).get("cost_time") or {}
    jobs = []
    for slug in sorted(os.listdir(areas_dir)) if os.path.isdir(areas_dir) else []:
        d = os.path.join(areas_dir, slug)
        try:
            with open(os.path.join(d, "live_run.json"), encoding="utf-8") as f:
                lr = json.load(f)
            with open(os.path.join(d, "export.json"), encoding="utf-8") as f:
                run = (json.load(f).get("meta") or {}).get("run") or {}
        except (OSError, ValueError):
            continue
        n = run.get("street_view_requests") or 0
        if lr.get("resumed_from_saved_files") or lr.get("replay_of") or not n or not lr.get("started_at") or not lr.get("uploaded_at"):
            continue
        secs = (_parse_t(lr["uploaded_at"]) - _parse_t(lr["started_at"])).total_seconds()
        jobs.append({"slug": slug, "street": lr.get("street"), "device": lr.get("device") or run.get("device"), "images": n,
                     "seconds": round(secs), "cloud_usd": run.get("vlm_cost_usd") or 0.0, "places_calls": run.get("places_calls") or 0})
    out = {"jobs": jobs}
    # P7 R2 (F1): time = fixed start-up + images x per-image rate. Per-image rate: the Ward 29 full run (model_card GPU
    # minutes over the photos counted from its run files). Start-up: each small completed GPU job's time minus its images x
    # that rate; the median over those jobs. Not fitted: two measured inputs, one formula.
    ward = photos_of_run(os.path.join(areas_dir, "ward29"))
    gpu_min = ct.get("ward29_full_run_gpu_minutes")
    if ward and gpu_min:
        rate = gpu_min * 60 / ward["photos"]
        gpu = [j for j in jobs if j["device"] == "gpu"]
        starts = sorted(j["seconds"] - j["images"] * rate for j in gpu)
        startup = None
        if starts:
            m = len(starts) // 2
            startup = max(0.0, starts[m] if len(starts) % 2 else (starts[m - 1] + starts[m]) / 2)
        out["gpu"] = {"sec_per_image": rate, "startup_s": startup or 0.0,
                      "basis": f"{rate:.2f} s per image from the Ward 29 full run ({ward['photos']:,} images in {gpu_min} min)"
                               + (f" + {startup / 60:.1f} min start-up: the median of {len(gpu)} completed GPU job(s) that ran "
                                  "from the start, each job's time minus its images at that rate ("
                                  + ", ".join(f"{j['street']}: {j['seconds'] / 60:.1f} min, {j['images']} images" for j in gpu)
                                  + "; worker claim → upload)" if startup is not None else " (no completed live job yet: no start-up added)")}
    cpu = [j for j in jobs if j["device"] == "cpu"]
    if cpu:
        n = sum(j["images"] for j in cpu)
        out["cpu"] = {"sec_per_image": sum(j["seconds"] for j in cpu) / n,
                      "basis": f"{len(cpu)} completed CPU job(s) that ran from the start"}
    if "cpu" not in out and ward:
        cpu_m = ((ct.get("cpu_fallback_per_street_min") or {}).get("full_ocr"))
        if cpu_m:
            per_street = ward["photos"] / 10                      # model_card's CPU minutes are per average Ward 29 street
            out["cpu"] = {"sec_per_image": cpu_m * 60 / per_street,
                          "basis": f"model card: {cpu_m} min per Ward 29 street on a CPU (full sign reading), "
                                   f"{per_street:.0f} images per street (Ward 29: {ward['photos']:,} images over 10 streets)"}
    if jobs:
        n = sum(j["images"] for j in jobs)
        out["cloud_usd_per_image"] = sum(j["cloud_usd"] for j in jobs) / n
        out["places_per_image"] = sum(j["places_calls"] for j in jobs) / n
        out["cloud_basis"] = f"cloud-AI cost of the same {len(jobs)} job(s): ${sum(j['cloud_usd'] for j in jobs):.4f} over {n} images"
    elif ward and ct.get("ward29_vlm_usd_with_router") is not None:
        out["cloud_usd_per_image"] = ct["ward29_vlm_usd_with_router"] / ward["photos"]
        out["places_per_image"] = None
        out["cloud_basis"] = f"model card Ward 29 cloud AI with the local router (${ct['ward29_vlm_usd_with_router']}) over {ward['photos']:,} images"
    out["sv_price"] = ct.get("street_view_price_usd_per_image")
    return out


def cost_of_plan(plan, rates, cap_usd=None):
    """The estimate for a camera plan. The worker's cost cap uses the same images rule (views + buildings faced)."""
    views = sum(len(e["views"]) for e in plan)
    faced = len({v["footprint"] for e in plan for v in e["views"] if v.get("footprint")})
    images = views + faced
    price, cloud = rates.get("sv_price"), rates.get("cloud_usd_per_image")
    sv_usd = images * price if price is not None else None
    cloud_usd = images * cloud if cloud is not None else None
    total = round(sv_usd + (cloud_usd or 0), 2) if sv_usd is not None else None
    def mins(dev):
        if dev not in rates:
            return None
        return round(((rates[dev].get("startup_s") or 0) + images * rates[dev]["sec_per_image"]) / 60, 1)
    ppi = rates.get("places_per_image")
    return {"cameras": len(plan), "views": views, "buildings_faced": faced, "street_view_images": images,
            "street_view_usd": round(sv_usd, 2) if sv_usd is not None else None,
            "cloud_ai_usd": round(cloud_usd, 4) if cloud_usd is not None else None,
            "places_calls": round(images * ppi) if ppi is not None else None,
            "total_usd": total, "gpu_minutes": mins("gpu"), "cpu_minutes": mins("cpu"),
            "cap_usd": cap_usd, "over_cap": bool(cap_usd is not None and total is not None and total > cap_usd)}


def basis_text(rates):
    """the plain-language "How is this estimated?" shown to users (hotfix: no internal words); the technical rates stay in
    the `rates` field"""
    parts = [f"Photos: every Street View photo this street needs, from the spots where Google's cameras stood along it, "
             f"plus one close-up per building (at most). Each photo costs ${rates.get('sv_price')} (Google's price)."]
    if rates.get("cloud_usd_per_image") is not None:
        parts.append(f"AI checks: about ${rates['cloud_usd_per_image']:.5f} per photo, as measured on earlier analyses.")
    g = rates.get("gpu")
    if g:
        parts.append(f"Time: about {g['sec_per_image']:.1f} s per photo (the full Ward 29 analysis)"
                     + (f" plus about {g['startup_s'] / 60:.0f} minutes to start up (typical of earlier analyses)." if g.get("startup_s") else "."))
    parts.append("Google business look-ups are counted but not priced. An estimate, not a measurement.")
    return " ".join(parts)


def plan_street(polygon, way_ids, data_dir, maps_key):
    """run_area stages 1-3 (panoramas, area, plan) for a job polygon, exactly as the worker runs them; no photo bought."""
    from geo_cascadia.area import Area
    from geo_cascadia.config import Config
    from geo_cascadia.plan import building_register, capture_plan
    from geo_cascadia.streetview import StreetView
    cfg = Config(data_dir=os.path.join(data_dir, "cache", "pipeline"), maps_key=maps_key)   # defaults; no resolve() (torch)
    poly = shape(polygon) if isinstance(polygon, dict) else polygon
    t0 = time.monotonic()
    panos, _ = StreetView(cfg.maps_key).discover(poly, cfg.grid_step_m, cfg.search_radius_m)
    if not panos:
        return {"panoramas": 0, "plan": [], "buildings": [], "note": "Google has no outdoor Street View on this street"}
    t1 = time.monotonic()
    area = Area(poly, f"{cfg.data_dir}/overpass_cache", cfg.ray_max_range_m)
    area.load_footprints(ms_fill=True)
    sel = area.load_streets(panos, cfg, None, way_ids)
    if not sel:
        return {"panoramas": len(panos), "plan": [], "buildings": [], "note": "no road of the selection lies inside the area"}
    plan, _ = capture_plan(area, panos, cfg)
    buildings = building_register(area, plan)
    return {"panoramas": len(panos), "plan": plan, "buildings": buildings, "footprints": area.fp_counts,
            "seconds": {"panoramas": round(t1 - t0, 1), "area_and_plan": round(time.monotonic() - t1, 1)}}


def _rounded(g, nd):
    if isinstance(g, (list, tuple)):
        return [_rounded(x, nd) for x in g]
    if isinstance(g, dict):
        return {k: _rounded(v, nd) for k, v in g.items()}
    return round(g, nd) if isinstance(g, float) else g


def key_of(polygon, way_ids, lines=None):
    """one key per stretch of street: its line (≈ 1 m rounding) when known, so clicking the same street at another spot
    reuses the estimate (the job polygon is the line's 45 m buffer, rebuilt around each click with tiny float changes)"""
    basis = _rounded(lines, 5) if lines else _rounded(polygon, 6)
    return hashlib.md5(json.dumps([basis, sorted(way_ids or [])], sort_keys=True).encode()).hexdigest()[:16]


def start(polygon, way_ids, *, data_dir, maps_key, model_card, cap_usd, lines=None):
    """Start (or join) planning for this job polygon. Returns the status dict (see status())."""
    k = key_of(polygon, way_ids, lines)
    path = os.path.join(data_dir, "cache", "planest", f"{k}.json")
    with _LOCK:
        if k in _JOBS and _JOBS[k]["status"] in ("running", "done"):
            return status(k)
        if os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as f:
                    saved = json.load(f)
                _JOBS[k] = {"status": "done", "plan": saved, "t0": time.monotonic(), "data_dir": data_dir,
                            "model_card": model_card, "cap_usd": cap_usd}
                return status(k)
            except (OSError, ValueError):
                pass
        if not maps_key:
            _JOBS[k] = {"status": "failed", "error": "No Google server key on the backend (GOOGLE_PLACES_SERVER_KEY), so the "
                        "camera plan can't be made here.", "t0": time.monotonic()}
            return status(k)
        _JOBS[k] = {"status": "running", "t0": time.monotonic(), "data_dir": data_dir, "model_card": model_card, "cap_usd": cap_usd}

    def run():
        try:
            res = plan_street(polygon, way_ids, data_dir, maps_key)
            keep = {"panoramas": res["panoramas"], "note": res.get("note"), "footprints": res.get("footprints"),
                    "seconds": res.get("seconds"),
                    "plan": [{"views": [{"footprint": v.get("footprint")} for v in e["views"]]} for e in res["plan"]]}
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(keep, f)
            with _LOCK:
                _JOBS[k].update(status="done", plan=keep)
        except Exception as e:                                    # noqa: BLE001 - shown to the person, never a 500
            msg = str(e)
            if "Overpass" in msg:
                msg = "OpenStreetMap is slow or busy, so the camera plan could not be made. Try again in a minute."
            with _LOCK:
                _JOBS[k].update(status="failed", error=msg[:300])
    _POOL.submit(run)
    return status(k)


def status(k):
    j = _JOBS.get(k)
    if not j:
        return {"key": k, "status": "unknown"}
    out = {"key": k, "status": j["status"], "elapsed_s": round(time.monotonic() - j["t0"], 1)}
    if j["status"] == "failed":
        out["error"] = j.get("error")
    if j["status"] == "done":
        p = j["plan"]
        rates = measured_rates(os.path.join(j["data_dir"], "areas"), j["model_card"])
        est = cost_of_plan(p["plan"], rates, j.get("cap_usd"))
        out["estimate"] = {**est, "panoramas": p["panoramas"], "footprints": p.get("footprints"), "note": p.get("note"),
                           "method": "planner", "basis": basis_text(rates),
                           "rates": {k2: v for k2, v in rates.items() if k2 != "jobs"}, "is_estimate": True}
    return out
