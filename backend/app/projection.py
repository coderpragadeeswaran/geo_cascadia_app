"""City-scale projection (extras 2): "Whole <city>: about N km of streets → about X photos, $Y, Z hours", for each city
in the local map data (D53). An estimate, shown as a range from our own completed runs, never one precise number.

- Streets: the app's OpenStreetMap copy, only the road types the pipeline analyses (`geo_cascadia.area.ROAD_TYPES`,
  bridges and tunnels left out, as the area stage does), clipped to the city's box (its OSM boundary + 550 m; Tiruppur a
  16 × 16 km box). Dual carriageways count both ways, as in our runs' street lengths.
- Photos per km: each completed run's Street View photos (views fetched + one building crop per reliable building view,
  `planest.photos_of_run`, the same count as Under the Hood) over its analysed street length (streets.json). Low / high =
  the lowest and highest run; the middle = all runs pooled.
- Cost per photo: Google's list price (model card) + cloud AI per photo (runs that recorded their cloud cost; low / high).
- Time: the analysis time model (P7 R2 F1): GPU seconds per photo (Ward 29 full run) + the start-up once per job, with
  jobs the size of Ward 29's analysed streets (4.8 km; the largest area we ran in one job).
Not checked: Street View coverage for the whole city (some streets have no imagery, which would lower the numbers), and
whether Google's free monthly allowance applies.
"""
import json
import os
import time

from . import planest

_CACHE = {"t": 0.0, "v": None}
TTL_S = 3600


def city_km(pool):
    """km of analysable streets per covered city (PostGIS, geography lengths), or None without the database"""
    from geo_cascadia.area import ROAD_TYPES
    if pool is None:
        return None
    with pool.connection() as c:
        rows = c.execute("""select m.city, m.name, m.osm_snapshot,
                                   coalesce(sum(ST_Length(ST_Intersection(r.geom, m.box)::geography)), 0) / 1000.0
                            from map_cities m join osm_roads r on r.city = m.city
                             and r.highway = any(%s) and coalesce(r.bridge, '') = '' and coalesce(r.tunnel, '') = ''
                             and ST_Intersects(r.geom, m.box)
                            group by 1, 2, 3 order by 1""", (sorted(ROAD_TYPES),)).fetchall()
    return [{"city": r[0], "name": r[1], "osm_snapshot": r[2].date().isoformat() if r[2] else None, "km": float(r[3])} for r in rows]


def run_rates(areas_dir, model_card):
    """photos per km (each completed run, from its own files: photos fetched over the analysed street length in
    streets.json), cloud AI $ per photo (live runs that recorded it from the start), and the time model"""
    runs = []
    for slug in sorted(os.listdir(areas_dir)) if os.path.isdir(areas_dir) else []:
        d = os.path.join(areas_dir, slug)
        ph = planest.photos_of_run(d)
        try:
            with open(os.path.join(d, "streets.json"), encoding="utf-8") as f:
                km = sum((s_.get("length_m") or 0) for s_ in json.load(f)) / 1000
            with open(os.path.join(d, "export.json"), encoding="utf-8") as f:
                exp = json.load(f)
        except (OSError, ValueError):
            continue
        if not ph or km <= 0:
            continue
        run = (exp.get("meta") or {}).get("run") or {}
        live = os.path.isfile(os.path.join(d, "live_run.json"))
        # cloud AI per photo: only live runs that recorded their own cost from the start (the original areas' counters
        # come from resumed runs, D1); it is under 1% of the cost per photo either way
        cloud = run["vlm_cost_usd"] / run["street_view_requests"] if live and run.get("vlm_cost_usd") and run.get("street_view_requests") else None
        runs.append({"slug": slug, "photos": ph["photos"], "km": round(km, 3), "per_km": ph["photos"] / km, "cloud_per_photo": cloud})
    return runs, planest.measured_rates(areas_dir, model_card)


def _cities(pool, cache_path):
    """the road km per city: PostGIS when the database answers (saved to disk), else the saved answer"""
    try:
        rows = city_km(pool)
    except Exception:                                          # noqa: BLE001 - offline: fall back to the saved answer
        rows = None
    if rows:
        try:
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump({"t": time.time(), "cities": rows}, f)
        except OSError:
            pass
        return rows
    try:
        with open(cache_path, encoding="utf-8") as f:
            return json.load(f)["cities"]
    except (OSError, ValueError, KeyError):
        return None


def project(pool, areas_dir, model_card, cache_dir=None):
    """the table for every covered city (cached an hour in memory; the road km also on disk for offline mode)"""
    now = time.time()
    key = tuple(sorted(os.listdir(areas_dir))) if os.path.isdir(areas_dir) else ()
    if _CACHE["v"] is not None and now - _CACHE["t"] < TTL_S and _CACHE.get("key") == key:
        return _CACHE["v"]
    cities = _cities(pool, os.path.join(cache_dir or os.path.join(os.path.dirname(areas_dir), "cache"), "projection_city_km.json"))
    runs, rates = run_rates(areas_dir, model_card)
    if not cities or not runs:
        return {"available": False, "note": "needs the local map data (database) and at least one completed run"}
    per_km = [r["per_km"] for r in runs]
    pooled = sum(r["photos"] for r in runs) / sum(r["km"] for r in runs)
    clouds = [r["cloud_per_photo"] for r in runs if r["cloud_per_photo"] is not None]
    price = rates.get("sv_price") or 0.007
    gpu = rates.get("gpu") or {}
    sec, startup = gpu.get("sec_per_image"), gpu.get("startup_s") or 0.0
    ward = next((r for r in runs if r["slug"] == "ward29"), None)
    job_km = ward["km"] if ward else 4.8
    lo_pk, mid_pk, hi_pk = min(per_km), pooled, max(per_km)
    lo_c, hi_c = price + (min(clouds) if clouds else 0), price + (max(clouds) if clouds else 0)
    mid_c = price + (sum(clouds) / len(clouds) if clouds else 0)
    rows = []
    for c in cities:
        km = c["km"]
        jobs = max(1, round(km / job_km))
        ph = {"low": km * lo_pk, "mid": km * mid_pk, "high": km * hi_pk}
        usd = {"low": ph["low"] * lo_c, "mid": ph["mid"] * mid_c, "high": ph["high"] * hi_c}
        hrs = {k: (v * sec + jobs * startup) / 3600 for k, v in ph.items()} if sec else None
        rows.append({**c, "jobs": jobs, "photos": ph, "usd": usd, "gpu_hours": hrs,
                     "colab_days": {k: v / 2.5 for k, v in hrs.items()} if hrs else None})
    out = {
        "available": True, "is_estimate": True, "cities": rows,
        "inputs": {"photos_per_km": {"low": lo_pk, "mid": mid_pk, "high": hi_pk}, "usd_per_photo": {"low": lo_c, "mid": mid_c, "high": hi_c},
                   "sv_price": price, "sec_per_photo": sec, "startup_s": startup, "job_km": job_km, "runs": runs},
        "assumptions": [
            "Streets: OpenStreetMap roads of the kinds the analysis covers (main, connecting and residential streets; not "
            "service lanes, bridges or tunnels) inside the city's box. A divided road counts both sides, as in our runs.",
            f"Photos: {lo_pk:.0f}–{hi_pk:.0f} per km, the lowest and highest of our {len(runs)} completed runs "
            f"({pooled:.0f} per km for all runs together).",
            f"Cost: ${price} per Street View photo at Google's list price (the free monthly allowance is not counted), plus "
            f"cloud AI of ${min(clouds) if clouds else 0:.5f}–${max(clouds) if clouds else 0:.5f} per photo as measured.",
            f"Time: {sec:.2f} s of GPU time per photo (the full Ward 29 run) plus {startup / 60:.1f} min start-up per job, "
            f"one job per {job_km:.1f} km of streets (the size of Ward 29). Colab days at 2.5 GPU hours a day." if sec else
            "Time: not available (no measured per-photo rate).",
            "Not checked: whether Google has Street View imagery on every one of these streets (streets without it would "
            "lower every number). An estimate from our runs, not a quote.",
        ],
    }
    _CACHE.update(t=now, v=out, key=key)
    return out
