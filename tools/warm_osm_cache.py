r"""warm_osm_cache.py — P7 R3: fill the map caches the day before a demo, so clicks and mini-maps need no map server.

    backend\.venv\Scripts\python tools\warm_osm_cache.py                 (warm everything; retries slow servers until done)
    backend\.venv\Scripts\python tools\warm_osm_cache.py --check         (no network at all: is every click answered from disk?)
    options: --streets tools/demo_streets.json · --max-minutes 30 (per item) · --no-estimates · --api http://127.0.0.1:8000

What it fills (all on disk under data/cache/, the same files the API reads — they survive API restarts):
- every analysed area (data/areas/*): the roads around it (mini-maps, GET /areas/{slug}/minimap) and the building outline
  under each dropped camera (Under the Hood examples);
- every job the API lists (when it is running): the roads around the requested stretch (Jobs mini-map);
- every street in the demo list (tools/demo_streets.json, easy to edit): the street lookup for points every 100 m along
  the whole street (every map tile it crosses, plus the street by OSM way id), with Google's road names where the server
  key allows, and the cost/time estimate (the real camera plan; Street View metadata calls are free).

Slow or busy map servers are retried (with a pause) until each item is done or --max-minutes runs out. Prints the time
taken. --check blocks every outgoing request in this process and times each demo click and estimate from the caches.
"""
import argparse
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from app import hood, minimap, planest, streetpick  # noqa: E402
from app.drive import Plans  # noqa: E402
from app.settings import Settings  # noqa: E402
from app.store import JsonStore  # noqa: E402

STEP_M = 100            # demo streets: one click every 100 m (a map tile is ~330 m)


def say(*a):
    print(*a, flush=True)


def retry(what, fn, max_s):
    """fn() until it returns; a busy / slow map server is asked again after a pause. None after max_s."""
    t0 = time.monotonic()
    t_end, k, said = t0 + max_s, 0, t0
    while True:
        try:
            return fn()
        except streetpick.Pending:
            wait = 1.5                                            # still running in the background: ask again soon
            if time.monotonic() - said > 30:
                said = time.monotonic()
                say(f"   … {what}: still looking it up ({said - t0:.0f} s)")
        except streetpick.OverpassBusy as e:
            k += 1
            wait = min(60, 10 * k)
            say(f"   … {what}: map server busy ({e}); retry {k} in {wait} s")
        if time.monotonic() + wait > t_end:
            say(f"   ✗ {what}: gave up after {max_s / 60:.0f} min")
            return None
        time.sleep(wait)


def warm_query(cache, q, what, max_s):
    return retry(what, lambda: streetpick.overpass(q, cache, time.monotonic() + 90)[0], max_s) is not None


def points_along(lines, step_m=STEP_M):
    """[lat, lon] every step_m along a GeoJSON MultiLineString (lon/lat), ends included"""
    from shapely.geometry import LineString
    from geo_cascadia.geo import Frame
    coords = lines["coordinates"] if lines["type"] == "MultiLineString" else [lines["coordinates"]]
    lo0, la0 = coords[0][0]
    F = Frame(la0, lo0)
    out = []
    for part in coords:
        g = LineString([F.xy(la, lo) for lo, la in part])
        n = max(1, int(g.length // step_m))
        for i in range(n + 1):
            p = g.interpolate(min(g.length, i * step_m))
            out.append(list(F.ll(p.x, p.y)))
    return out


def api_jobs(api):
    import requests
    try:
        return requests.get(f"{api}/jobs", timeout=15).json().get("jobs") or []
    except Exception as e:                                        # noqa: BLE001
        say(f"   (API not reachable at {api}: {type(e).__name__} — job mini-maps skipped)")
        return []


def estimate(st, res, card, max_s):
    """the confirm sheet's estimate for this street (planest; same key as the API, cached on disk). A failed plan (map
    server busy, Google unreachable) is planned again after a pause until max_s; failures are never cached."""
    t_end, said, k = time.monotonic() + max_s, time.monotonic(), 0
    while True:
        s = planest.start(res["polygon"], res.get("way_ids"), data_dir=st.data_dir, maps_key=st.google_server_key,
                          model_card=card, cap_usd=st.job_cost_cap_usd, lines=res.get("lines"))
        while s["status"] == "running" and time.monotonic() < t_end:
            time.sleep(2)
            s = planest.status(s["key"])
            if time.monotonic() - said > 30:
                said = time.monotonic()
                say(f"   … estimate for {res['street']}: planning camera stops ({s.get('elapsed_s')} s)")
        k += 1
        wait = min(120, 30 * k)
        if s["status"] != "failed" or not st.google_server_key or time.monotonic() + wait > t_end:
            return s
        say(f"   … estimate for {res['street']} failed ({s.get('error')}); planning again in {wait} s")
        time.sleep(wait)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")    # ✓ / ✗ on a Windows console
    ap = argparse.ArgumentParser()
    ap.add_argument("--streets", default=os.path.join(ROOT, "tools", "demo_streets.json"))
    ap.add_argument("--max-minutes", type=float, default=30.0, help="per item")
    ap.add_argument("--no-estimates", action="store_true")
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--check", action="store_true", help="block all network; time clicks from the caches")
    a = ap.parse_args()
    st = Settings()
    cache = os.path.join(st.data_dir, "cache", "streetpick")
    store, plans = JsonStore(st.areas_dir), Plans(st.areas_dir)
    bundles = [b for b in (store.bundle(s) for s in store.slugs()) if b]
    with open(os.path.join(st.data_dir, "model_card.json"), encoding="utf-8") as f:
        card = json.load(f)
    with open(a.streets, encoding="utf-8") as f:
        demo = json.load(f)["streets"]
    max_s = a.max_minutes * 60
    if a.check:
        return check(st, cache, bundles, demo, card)

    t0 = time.monotonic()
    fails = []
    say(f"1/3 analysed areas ({len(bundles)})")
    for b in bundles:
        slug = b["slug"]
        bb = minimap.area_bounds(b, plans.get(slug))
        ok = bb is None or warm_query(cache, minimap.roads_query(bb), f"{slug} roads", max_s)
        pts = []
        F = hood.RunFiles(st.areas_dir).get(slug)
        for key in hood.EXAMPLE_KEYS:                            # the examples that look up a building outline
            try:
                hood.examples(b, F, key, outline_at=lambda la, lo: pts.append((la, lo)))
            except Exception:                                     # noqa: BLE001 - a key this area has no data for
                pass
        pts = sorted(set(pts))
        n_ok = sum(warm_query(cache, minimap.outline_query(la, lo), f"{slug} outline", max_s) for la, lo in pts)
        say(f"   {'✓' if ok else '✗'} {slug}: roads {'cached' if ok else 'FAILED'}; dropped-camera outlines {n_ok}/{len(pts)}")
        if not ok or n_ok < len(pts):
            fails.append(slug)

    jobs = [j for j in api_jobs(a.api) if minimap.job_bounds(j.get("input"))]
    say(f"2/3 job mini-maps ({len(jobs)})")
    for j in jobs:
        ok = warm_query(cache, minimap.roads_query(minimap.job_bounds(j["input"])), f"job {j['id'][:8]}", max_s)
        say(f"   {'✓' if ok else '✗'} {j.get('street')}")
        if not ok:
            fails.append(j["id"])

    say(f"3/3 demo streets ({len(demo)})")
    for d in demo:
        t1 = time.monotonic()
        res = retry(d["label"], lambda: streetpick.pick(cache, bundles, d["lat"], d["lon"], st.google_server_key), max_s)
        if res is None:
            fails.append(d["label"])
            continue
        pts = points_along(res["lines"])
        n_ok = 0
        for la, lo in pts:
            try:
                r = retry(f"{d['label']} @ {la:.5f},{lo:.5f}",
                          lambda: streetpick.pick(cache, bundles, la, lo, st.google_server_key), max_s)
                n_ok += r is not None
            except streetpick.NoRoad:
                n_ok += 1                                         # a point the picker gives no road for: nothing to cache
        est = "skipped"
        if not a.no_estimates and res.get("source") != "area":
            s = estimate(st, res, card, max_s)
            e = s.get("estimate") or {}
            est = (f"{e.get('street_view_images')} photos, ${e.get('total_usd')}, {e.get('gpu_minutes')} min" if s["status"] == "done"
                   else f"{s['status']}: {s.get('error') or ''}")
            if s["status"] != "done":
                fails.append(d["label"] + " estimate")
        say(f"   ✓ {res['street']} ({res['length_m']} m, {n_ok}/{len(pts)} clicks cached, {time.monotonic() - t1:.0f} s) · estimate: {est}")
        if n_ok < len(pts):
            fails.append(d["label"])
    say(f"\nDone in {(time.monotonic() - t0) / 60:.1f} min. " + (f"NOT complete: {', '.join(map(str, fails))} — run again."
                                                               if fails else "Everything cached."))
    return 1 if fails else 0


def check(st, cache, bundles, demo, card):
    """Every outgoing HTTP request in this process fails at once; each demo click and its estimate must come from disk."""
    import requests

    def blocked(*_a, **_k):
        raise requests.ConnectionError("blocked by --check")
    requests.Session.request = blocked
    requests.post = requests.get = blocked
    worst, bad = 0.0, []
    for d in demo:
        t = time.perf_counter()
        try:
            res = streetpick.pick(cache, bundles, d["lat"], d["lon"], st.google_server_key)
            pts = points_along(res["lines"])
            for la, lo in pts:
                t2 = time.perf_counter()
                try:
                    streetpick.pick(cache, bundles, la, lo, st.google_server_key)
                except streetpick.NoRoad:
                    pass
                worst = max(worst, time.perf_counter() - t2)
            s = planest.start(res["polygon"], res.get("way_ids"), data_dir=st.data_dir, maps_key=st.google_server_key,
                              model_card=card, cap_usd=st.job_cost_cap_usd, lines=res.get("lines"))
            say(f"   ✓ {res['street']}: first click {1000 * (time.perf_counter() - t):.0f} ms, {len(pts)} clicks along it, "
                f"estimate {s['status']}")
            if s["status"] != "done" and res.get("source") != "area":
                bad.append(d["label"] + " estimate")
        except Exception as e:                                    # noqa: BLE001
            say(f"   ✗ {d['label']}: {type(e).__name__} {e}")
            bad.append(d["label"])
    say(f"slowest click {1000 * worst:.0f} ms; " + ("all answered from the cache" if not bad else f"NOT cached: {bad}"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
