r"""Regression pass before the demo (D56). One command, run from the repo root with the API on :8000 and the web app on
:5173 (the production preview, as on demo day):

    backend\.venv\Scripts\python tools\regression.py              # everything (about 30-40 min)
    backend\.venv\Scripts\python tools\regression.py --quick      # API sections only (A-D), a few minutes

Sections (each prints ok / FAIL lines; the run ends with a PASS / FAIL table and exit code 1 on any FAIL):
  A  questions: the four spec questions + the extra ones (Tamil, "high priority dark stretches", the 50 m question, poles on
     a street, 100 m interval, "possible dark stretches") return the expected filters and row counts (Ward 29 baseline);
  B  review round trip: one Ward 29 decision (approve) and its Undo, then a No with a corrected value + note and its Undo
     (D59), through the API; the review tables (incl. the corrected value) are snapshotted
     before and after and must be identical (the item's updated_at and the two append-only history rows are the only
     traces, by design, D24);
  C  Analyse up to the estimate only: a street inside the local map data (Coimbatore) and one outside (Erode): street
     lookup + cost/time estimate. No job is created (the jobs list is compared before and after);
  D  reports: PDF + Excel for every area and for one street; every key number equals the app's (the API's dashboard and
     map), the PDF's text contains them, the Excel sheets have the expected rows;
  E  the browser: web/scripts/regression.ts (every page, every area, both themes, no console errors, the tour);
  F  offline cases: web/scripts/offline.ts with two helper APIs this script starts and stops (:8001 every outgoing request
     blocked, :8002 no Google keys): map servers blocked, worker offline (a TEST job, removed after), Google keys missing,
     the API stopping mid-session.
Output: docs/screenshots/regression/run-<date-time>.log (+ the browser and offline screenshots in the same folder).
"""
import argparse
import datetime as dt
import io
import json
import os
import subprocess
import sys
import time

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
API = os.environ.get("API_URL", "http://127.0.0.1:8000")
APP = os.environ.get("APP_URL", "http://localhost:5173/")
OUT = os.path.join(ROOT, "docs", "screenshots", "regression")
PY = sys.executable

# ---------------------------------------------------------------- expected answers (Ward 29 Oct 2026 re-run, D64)
QUESTIONS = [
    ("Show commercial buildings with more than two visible floors that do not have a matching property record",
     {"intent": "buildings", "use": "commercial", "floors_op": ">", "floors_n": 2, "match_status": "no_record"}, 1, None),
    ("Show streets where no streetlight is detected within 60 m", {"intent": "streetlight_gaps", "interval_m": 60}, 11, None),
    ("Display only low-confidence floor-count predictions and create a review queue",
     {"intent": "review", "reason_has": "floor count low confidence"}, 3, None),
    ("Chart of unmatched buildings by street", {"intent": "buildings", "match_status": "no_record", "group_by": "street"}, 22, None),
    ("பதிவேட்டில் இல்லாத கடைகள்", {"intent": "buildings", "use": "commercial", "match_status": "no_record"}, 6, None),
    ("60 மீட்டருக்குள் தெருவிளக்கு இல்லாத தெருக்களைக் காட்டு", {"intent": "streetlight_gaps", "interval_m": 60}, 11, None),
    ("High priority dark stretches", {"intent": "streetlight_gaps", "interval_m": 60, "priority": "high"}, 5, None),
    ("Show not-in-register buildings within 50 m of a possible dark stretch",
     {"intent": "buildings", "match_status": "no_record", "near_dark_m": 50}, 15, [22, 15]),
    ("Poles on Sathy Main Road", {"intent": "assets", "asset_type": "pole", "street": "Sathy Main Road"}, 46, None),
    ("Streets where no streetlight is detected within 100 m", {"intent": "streetlight_gaps", "interval_m": 100}, 7, None),
    ("Show possible dark stretches", {"intent": "streetlight_gaps", "interval_m": 60}, 11, None),
    # extras (added with the OpenStreetMap comparison, an intended addition): our businesses not on OpenStreetMap
    ("Businesses not in OpenStreetMap", {"intent": "osm_businesses", "osm": "camera_only"}, 131, None),
    # ui-polish-2 (D59, an intended addition): the pairs (9 in the Sep run, 10 in the D64 re-run), renamed "near each other (location only)"; no name matches
    ("Businesses near an OpenStreetMap point", {"intent": "osm_businesses", "osm": "matched"}, 10, None),
]
INSIDE = ("Sakthi Main Road (Coimbatore, local map data)", 11.042553, 76.9841361)
OUTSIDE = ("a road in Erode (outside the four cities: OpenStreetMap's public servers)", 11.3410, 77.7172)
STREET = ("ward29", "Sathy Main Road")

LOG = []
RESULT = {}


def utf8_io():
    """extras F2: print UTF-8 whatever the console or redirect is (Windows gives a redirected file the ANSI code page,
    where "→" or Tamil text raised UnicodeEncodeError and stopped the run). Unencodable text is never fatal."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def say(s=""):
    print(s, flush=True)
    LOG.append(s)


class Section:
    def __init__(self, key, title):
        self.key, self.fails, self.notes = key, 0, []
        say(f"\n== {key}  {title}")

    def check(self, ok, what):
        say(f"  {'ok  ' if ok else 'FAIL'} {what}")
        if not ok:
            self.fails += 1
        return ok

    def done(self, extra=""):
        RESULT[self.key] = ("PASS" if not self.fails else f"FAIL ({self.fails})") + (f" — {extra}" if extra else "")


def get(path, **kw):
    return requests.get(API + path, timeout=kw.pop("timeout", 120), **kw)


# ---------------------------------------------------------------- A questions
def section_a():
    s = Section("A", "questions: spec + extra (Ward 29)")
    for text, filters, total, why in QUESTIONS:
        r = requests.post(f"{API}/query", json={"area": "ward29", "text": text}, timeout=120).json()
        got = {k: v for k, v in r["parsed_filters"].items() if k in filters or k in ("priority", "near_dark_m", "osm")}
        und = (r.get("understanding") or {}).get("status")
        ok = got == filters and r["total"] == total and und == "ok"
        if why is not None:
            ok = ok and [w["count"] for w in r["why_empty"]] == why
        s.check(ok, f"{text[:70]!r} → {r['total']} (expected {total}){'' if got == filters else f'; filters {got} != {filters}'}"
                    f"{'' if und == 'ok' else f'; understood: {und}'}")
    s.done()


# ---------------------------------------------------------------- B review round trip
def _snapshot(pool):
    with pool.connection() as c:
        # D59: the reviewer's corrected value is part of the state that must come back exactly (kept before updated_at)
        items = {r[0]: (r[1], r[2], r[3], r[4], json.dumps(r[6], sort_keys=True), r[5]) for r in c.execute(
            "select id, status, reviewer, note, appeal_photo_url, updated_at, corrected from review_items")}
        objs = sorted(c.execute("select 'b', area_id, id, review_status from buildings union all "
                                "select 'a', area_id, id, review_status from assets").fetchall())
        events = c.execute("select count(*) from review_events").fetchone()[0]
    return items, objs, events


def section_b():
    s = Section("B", "review decision + undo round trip (Ward 29, through the API)")
    from app.settings import Settings
    from app.db import Pool
    pool = Pool(Settings().database_url)
    try:
        before = _snapshot(pool)
        q = get("/review?area=ward29&status=pending&page_size=1").json()
        if not s.check(q["total"] > 0, f"a waiting Ward 29 item exists ({q['total']} waiting)"):
            return s.done()
        item = q["rows"][0]
        iid = item["id"]
        r = requests.patch(f"{API}/review/{iid}", data={"action": "approve", "reviewer": "regression check"}, timeout=60)
        ev = r.json().get("event_id")
        s.check(r.status_code == 200 and get(f"/review/{iid}").json()["status"] == "approved",
                f"item #{iid} ({item.get('ref_id')}) approved (event {ev})")
        u = requests.post(f"{API}/review/{iid}/undo", json={"item_id": iid, "event_id": ev, "reviewer": "regression check"}, timeout=60)
        s.check(u.status_code == 200 and get(f"/review/{iid}").json()["status"] == "pending", "Undo puts it back to waiting")
        # D59: a No with the reviewer's corrected value and a note, then its Undo
        r = requests.patch(f"{API}/review/{iid}", data={"action": "reject", "reviewer": "regression check", "note": "regression: no",
                                                       "corrected": json.dumps({"floors": 3})}, timeout=60)
        ev2 = r.json().get("event_id")
        got = get(f"/review/{iid}").json()
        s.check(r.status_code == 200 and got["status"] == "rejected" and got.get("corrected") == {"floors": 3} and got.get("note") == "regression: no",
                f"item #{iid} answered No with a corrected value {{'floors': 3}} and a note (event {ev2})")
        u = requests.post(f"{API}/review/{iid}/undo", json={"item_id": iid, "event_id": ev2, "reviewer": "regression check"}, timeout=60)
        got = get(f"/review/{iid}").json()
        s.check(u.status_code == 200 and got["status"] == "pending" and got.get("corrected") is None and got.get("note") is None,
                "Undo puts it back to waiting, with no corrected value and no note")
        after = _snapshot(pool)
        bi, ai = before[0], after[0]
        same_state = {k: v[:5] for k, v in bi.items()} == {k: v[:5] for k, v in ai.items()}
        other_times = all(bi[k][5] == ai[k][5] for k in bi if k != iid)
        s.check(same_state, f"every review item's status / reviewer / note / photo / corrected value is exactly as before ({len(bi)} items)")
        s.check(other_times, "no other item was touched (updated_at unchanged)")
        s.check(before[1] == after[1], f"every building's and asset's review status is exactly as before ({len(before[1])} objects)")
        s.check(after[2] - before[2] == 4, f"history: +{after[2] - before[2]} append-only rows (two decisions and their undos, by design)")
    finally:
        pool.close()
    s.done()


# ---------------------------------------------------------------- C analyse up to the estimate
def _preview(s, label, lat, lon, wait_s):
    t0 = time.time()
    while True:
        r = requests.post(f"{API}/jobs/preview", json={"lat": lat, "lon": lon}, timeout=60)
        if r.status_code == 200 and r.json().get("status") == "ok":
            break
        if r.status_code not in (200, 202) or time.time() - t0 > wait_s:
            return s.check(False, f"{label}: street lookup → HTTP {r.status_code} {r.text[:160]}") and None
        time.sleep(1)
    p = r.json()
    s.check(True, f"{label}: street found in {time.time() - t0:.1f} s — {p['street']}, {p['length_m']} m")
    key = (p.get("plan_estimate") or {}).get("key")
    est, t1 = p.get("plan_estimate") or {}, time.time()
    while est.get("status") == "running" and key and time.time() - t1 < wait_s:
        time.sleep(3)
        est = get(f"/jobs/plan-estimate/{key}").json()
    e = est.get("estimate") or {}
    if est.get("status") == "done":
        s.check(True, f"{label}: estimate in {time.time() - t1:.0f} s — {e.get('street_view_images')} photos, "
                      f"${e.get('total_usd')}, about {e.get('gpu_minutes')} min on the GPU"
                      f"{' (above the $' + str(e.get('cap_usd')) + ' cap: would wait for approval)' if e.get('over_cap') else ''}")
    else:
        s.check(False, f"{label}: estimate {est.get('status')} after {time.time() - t1:.0f} s ({est.get('message') or est.get('why') or ''})")
    return p


def section_c():
    s = Section("C", "Analyse a street up to the estimate (no job created)")
    jobs_before = job_ids()
    _preview(s, INSIDE[0], INSIDE[1], INSIDE[2], 240)
    _preview(s, OUTSIDE[0], OUTSIDE[1], OUTSIDE[2], 420)
    jobs_after = job_ids()
    s.check(jobs_before == jobs_after, f"no job was created ({len(jobs_after)} jobs before and after)")
    s.done()


# ---------------------------------------------------------------- D reports
def _about(xlsx_bytes):
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(xlsx_bytes))
    about = {r[0].value: (r[1].value, r[2].value if len(r) > 2 else None) for r in wb["About"].iter_rows() if r[0].value}
    return wb, about


def _pdf_text(pdf_bytes):
    import pypdfium2
    doc = pypdfium2.PdfDocument(pdf_bytes)
    parts = []
    for i in range(len(doc)):
        page = doc[i]
        tp = page.get_textpage()
        parts.append(tp.get_text_range())
        tp.close()
        page.close()
    n = len(doc)
    doc.close()
    return " ".join(" ".join(parts).split()), n


KPI_LABELS = [("buildings_analysed", "Buildings checked", "Building checked"), ("unmatched_properties", "Not in register", None),
              ("buildings_with_discrepancy", "Differ from register", "Differs from register"),
              ("streetlight_gaps", "Possible dark stretches", "Possible dark stretch"), ("use_not_classified", "Use not known", None),
              ("streetlights", "Streetlights", "Streetlight"), ("poles", "Poles, no lamp seen", "Pole, no lamp seen"),
              ("named_businesses", "Shop names read clearly", "Shop name read clearly"),
              ("names_confirmed_by_google", "Also on Google Maps", None),
              ("sign_text_unverified", "Signs to double-check", "Sign to double-check"),
              ("waiting_for_review", "Waiting for review", None),
              ("unmapped_businesses", "Businesses with no analysed building", "Business with no analysed building"),
              ("streets_covered", "Streets", "Street")]


def _all(path):
    rows, page = [], 1
    while True:
        r = get(f"{path}{'&' if '?' in path else '?'}page={page}&page_size=500").json()
        rows += r["rows"]
        if len(rows) >= r["total"]:
            return rows
        page += 1


def _street_kpis(slug, street):
    """derive.ts kpis(records, street), on the records the app loads"""
    q = requests.utils.quote(street)
    B = [b for b in _all(f"/areas/{slug}/buildings?street={q}") if b.get("street") == street]
    A = [a for a in _all(f"/areas/{slug}/assets?street={q}") if a.get("street") == street]
    U = [u for u in _all(f"/areas/{slug}/unmapped") if u.get("street") == street]
    R = [x for x in _all(f"/review?area={slug}&street={q}")]
    G = [f for f in get(f"/areas/{slug}/geojson?layers=gaps").json()["features"] if f["properties"].get("street") == street]
    nm = lambda b: (b.get("attributes") or {}).get("name") or {}
    use = lambda b: ((b.get("attributes") or {}).get("use") or {}).get("value")
    return {"streets_covered": len({b.get("street") for b in B}), "buildings_analysed": len(B),
            "unmatched_properties": sum(b.get("match_status") == "no_record" for b in B),
            "buildings_with_discrepancy": sum(b.get("match_status") == "discrepancy" for b in B),
            "use_not_classified": sum(use(b) is None for b in B),
            "streetlights": sum(a.get("type") == "streetlight" for a in A), "poles": sum(a.get("type") == "pole" for a in A),
            "streetlight_gaps": len(G), "named_businesses": sum(nm(b).get("quality") == "good" for b in B),
            "sign_text_unverified": sum(nm(b).get("quality") in ("tamil_unverified", "fragment") for b in B),
            "names_confirmed_by_google": sum(bool(nm(b).get("google_confirmed")) for b in B),
            "waiting_for_review": sum(x.get("status") == "pending" for x in R), "unmapped_businesses": len(U)}


def _check_report(s, slug, app_numbers, cam, street=None):
    q = f"?street={requests.utils.quote(street)}" if street else ""
    name = f"{slug}{' / ' + street if street else ''}"
    t = time.time()
    x = get(f"/areas/{slug}/report.xlsx{q}", timeout=300)
    p = get(f"/areas/{slug}/report.pdf{q}", timeout=300)
    if not s.check(x.status_code == 200 and p.status_code == 200, f"{name}: PDF + Excel download ({time.time() - t:.1f} s)"):
        return
    wb, about = _about(x.content)
    text, pages = _pdf_text(p.content)
    bad = []
    for key, label, one in KPI_LABELS:
        lab = one if app_numbers[key] == 1 and one else label
        v = about.get(lab, (None,))[0]
        if v != app_numbers[key]:
            bad.append(f"{lab}: report {v} vs app {app_numbers[key]}")
        if str(app_numbers[key]) not in text:
            bad.append(f"{lab} {app_numbers[key]} not in the PDF text")
    note = about.get("Buildings checked", (None, None))[1] or about.get("Building checked", (None, None))[1]
    want = f"+ {cam} seen only by camera (no map outline)" if cam and not street else None
    if note != want:
        bad.append(f"camera-only note {note!r} vs {want!r}")
    n_assets = len(list(wb["Assets"].iter_rows(min_row=2)))
    if n_assets != app_numbers["streetlights"] + app_numbers["poles"]:
        bad.append(f"Assets sheet {n_assets} rows vs {app_numbers['streetlights'] + app_numbers['poles']} poles and lights")
    for k in ("SYNTHETIC", "© OpenStreetMap contributors"):
        if k not in text:
            bad.append(f"{k!r} missing from the PDF")
    s.check(not bad, f"{name}: {pages} pages; every key number = the app; Assets sheet {n_assets} rows"
                     + (f" — {'; '.join(bad)}" if bad else ""))
    _check_gis(s, slug, q, name, wb)
    if not street:
        with open(os.path.join(OUT, f"report_{slug}.pdf"), "wb") as f:
            f.write(p.content)


GIS_SHEETS = {"buildings": "Buildings with findings", "poles_streetlights": "Assets", "dark_stretches": "Possible dark stretches",
              "review_items": "Review items", "businesses_vs_osm": "OSM shops"}


def _check_gis(s, slug, q, name, wb):
    """extras 1: the GeoJSON and the zipped Shapefile set carry one feature per Excel row, per layer, in WGS84"""
    import zipfile
    import shapefile
    g = get(f"/areas/{slug}/report.geojson{q}", timeout=300)
    z = get(f"/areas/{slug}/report.shp.zip{q}", timeout=300)
    if not s.check(g.status_code == 200 and z.status_code == 200, f"{name}: GeoJSON + Shapefile download"):
        return
    feats = g.json()["features"]
    zf = zipfile.ZipFile(io.BytesIO(z.content))
    bad, counts = [], {}
    for layer, sheet in GIS_SHEETS.items():
        rows = max(0, wb[sheet].max_row - 1) if sheet in wb.sheetnames else 0
        n_geo = sum(1 for f in feats if f["properties"]["layer"] == layer)
        r = shapefile.Reader(shp=io.BytesIO(zf.read(f"{layer}.shp")), shx=io.BytesIO(zf.read(f"{layer}.shx")),
                             dbf=io.BytesIO(zf.read(f"{layer}.dbf")))
        n_shp = len(r)
        prj = zf.read(f"{layer}.prj").decode().startswith('GEOGCS["GCS_WGS_1984"')
        counts[layer] = n_geo
        if not (n_geo == n_shp == rows and prj):
            bad.append(f"{layer}: GeoJSON {n_geo}, Shapefile {n_shp}, Excel {rows}, prj {prj}")
    s.check(not bad, f"{name}: GIS layers = the Excel sheets ({', '.join(f'{k} {v}' for k, v in counts.items())})"
                     + (f" — {'; '.join(bad)}" if bad else ""))


def section_d():
    s = Section("D", "reports: PDF + Excel for every area and one street")
    areas = get("/areas").json()["areas"]
    for a in areas:
        slug = a["slug"]
        kpi = dict(get(f"/areas/{slug}").json()["dashboard"]["kpi"])
        kpi["streetlight_gaps"] = sum(f["properties"]["kind"] == "streetlight_gap"
                                      for f in get(f"/areas/{slug}/geojson?layers=gaps").json()["features"])
        _check_report(s, slug, kpi, a["counts"].get("camera_only_buildings") or 0)
    slug, street = STREET

    def total(f):
        return requests.post(f"{API}/query", json={"area": slug, "filters": {**f, "street": street}}, timeout=120).json()["total"]
    k = _street_kpis(slug, street)               # web/src/lib/derive.ts kpis() on the API's own records for the street
    s.check(k["buildings_analysed"] == total({"intent": "buildings"})
            and k["unmatched_properties"] == total({"intent": "buildings", "match_status": "no_record"})
            and k["streetlights"] == total({"intent": "assets", "asset_type": "streetlight"})
            and k["streetlight_gaps"] == total({"intent": "streetlight_gaps", "interval_m": 60}),
            f"{street}: the street's key numbers = the app's questions with that street "
            f"({k['buildings_analysed']} / {k['unmatched_properties']} / {k['buildings_with_discrepancy']} / {k['streetlight_gaps']})")
    _check_report(s, slug, k, 0, street)
    s.done(f"{len(areas)} areas + 1 street")


# ---------------------------------------------------------------- E browser, F offline
def _run(cmd, cwd, s, label, timeout):
    say(f"  $ {' '.join(cmd)}")
    t = time.time()
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=timeout, shell=os.name == "nt")
    for line in (p.stdout + p.stderr).splitlines():
        if line.strip():
            say("    " + line)
    s.check(p.returncode == 0, f"{label} (exit {p.returncode}, {time.time() - t:.0f} s)")


def section_e():
    s = Section("E", "browser: every page, every area, both themes, the tour")
    _run(["npx", "tsx", "scripts/regression.ts", os.path.join(OUT, "browser")], os.path.join(ROOT, "web"), s,
         "web/scripts/regression.ts", 3600)
    s.done()


def _helper_api(port, env_extra):
    env = {**os.environ, **env_extra}
    log = open(os.path.join(OUT, f"helper_api_{port}.log"), "w", encoding="utf-8")
    p = subprocess.Popen([PY, "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", str(port)],
                         cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(60):
        try:
            if requests.get(f"http://127.0.0.1:{port}/health", timeout=3, proxies={"http": None, "https": None}).ok:
                return p
        except requests.RequestException:
            pass
        time.sleep(2)
    return p


def section_f():
    s = Section("F", "offline cases (P7 R3 C5): map servers blocked, worker offline, Google keys missing, API down")
    dead = {"HTTP_PROXY": "http://127.0.0.1:9", "HTTPS_PROXY": "http://127.0.0.1:9", "NO_PROXY": "127.0.0.1,localhost"}
    nokeys = {"GOOGLE_PLACES_SERVER_KEY": "", "GOOGLE_MAPS_BROWSER_KEY": "", "GOOGLE_MAP_ID": ""}
    helpers = [_helper_api(8001, dead), _helper_api(8002, nokeys)]
    before = job_ids()
    made_file = os.path.join(OUT, "offline", "created_jobs.txt")
    if os.path.exists(made_file):
        os.remove(made_file)
    try:
        _run(["npx", "tsx", "scripts/offline.ts", os.path.join(OUT, "offline")], os.path.join(ROOT, "web"), s,
             "web/scripts/offline.ts", 1800)
    finally:
        for h in helpers:
            h.terminate()
        # offline.ts removes its own test job; if it stopped half way, remove exactly the ids it recorded when it made
        # them (extras F1: never by name, status or "new since" — a job someone else made meanwhile stays)
        made = open(made_file, encoding="utf-8").read().split() if os.path.exists(made_file) else []
        for jid, status in remove_own_jobs(made, requests, API):
            say(f"  (left-over test job {jid[:8]} removed: {status})")
        after = job_ids()
        s.check(not (set(made) & after), f"every job this check made is gone ({len(made)} made)")
        s.check(before <= after, f"every job that existed before is still there ({len(before)})")
    s.done()


def job_ids(wait_s=120):
    """the jobs list from the database. In offline data mode (a network blip to Supabase) the API lists no jobs at all,
    which must never read as "the jobs are gone": wait for an online answer (it retries the database after 30 s)."""
    t0 = time.time()
    while True:
        r = get("/jobs").json()
        if not r.get("offline") or time.time() - t0 > wait_s:
            if r.get("offline"):
                raise RuntimeError("the API stayed in offline data mode: the jobs list can't be checked")
            return {j["id"] for j in r["jobs"]}
        time.sleep(5)


def remove_own_jobs(ids, http, base=""):
    """extras F1: cancel + remove exactly these job ids (the ones a check recorded when it created them). Returns
    [(id, HTTP status)] for the ids still present. Nothing else is looked at or touched."""
    out = []
    for jid in dict.fromkeys(ids):
        if http.get(f"{base}/jobs/{jid}").status_code != 200:
            continue                                                    # already removed by the check itself
        http.post(f"{base}/jobs/{jid}/cancel")
        out.append((jid, http.delete(f"{base}/jobs/{jid}").status_code))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true", help="API sections only (A-D)")
    ap.add_argument("--only", default="", help="e.g. AD: run only these sections")
    a = ap.parse_args()
    utf8_io()
    os.makedirs(OUT, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y-%m-%d_%H%M")
    say(f"GEO-CASCADIA regression · {stamp} · API {API} · app {APP}")
    try:
        h = get("/health", timeout=10).json()
        say(f"API health: offline={h.get('offline')} db_error={h.get('db_error')}")
        requests.get(APP, timeout=10)
    except requests.RequestException as e:
        say(f"API or web app not reachable ({type(e).__name__}). Start T1 (API :8000) and T2 (npm run build; npx vite preview --port 5173).")
        sys.exit(2)
    want = set(a.only.upper()) if a.only else set("ABCD" if a.quick else "ABCDEF")
    for k, fn in (("A", section_a), ("B", section_b), ("C", section_c), ("D", section_d), ("E", section_e), ("F", section_f)):
        if k in want:
            try:
                fn()
            except Exception as e:                                      # noqa: BLE001 - a crashed section is a FAIL, the rest still run
                say(f"  FAIL section {k} crashed: {type(e).__name__}: {e}")
                RESULT[k] = f"FAIL (crashed: {type(e).__name__})"
    say("\n== summary")
    for k in sorted(RESULT):
        say(f"  {k}  {RESULT[k]}")
    failed = any(v.startswith("FAIL") for v in RESULT.values())
    say("ALL PASSED" if not failed else "SOME CHECKS FAILED")
    path = os.path.join(OUT, f"run-{stamp}.log")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(LOG) + "\n")
    print(f"log: {path}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
