r"""import_register.py — load a REAL property register (CSV / GeoJSON / Excel) and match it to an area by location (D43).

    backend\.venv\Scripts\python tools\import_register.py <file> --config <mapping.json> [--out data/registers/<name>.json]
                                                          [--area data/areas/<slug>] [--apply] [--geocode]

The mapping config names the register's columns (only `id` and a position are required):

    {"id": "ASSESSMENT_NO", "lat": "LATITUDE", "lon": "LONGITUDE", "address": "DOOR_ADDRESS", "street": "STREET_NAME",
     "use": "USAGE", "floors": "NO_OF_FLOORS", "area": "PLINTH_AREA", "area_unit": "sqft",
     "use_values": {"Commercial": "commercial", "Residential": "residential", "Mixed": "mixed"},
     "sheet": "Sheet1", "delimiter": ","}

- Positions: `lat`/`lon` columns, or a GeoJSON Point geometry, or (`--geocode`) the `address` column geocoded with the
  server key GOOGLE_PLACES_SERVER_KEY from backend/.env (Geocoding API). Rows with no usable position are skipped.
- Use is compared at the level commercial / residential (register.use_category); unmapped use values are reported.
- Area in m² (or `area_unit: "sqft"`, converted). Floors as a whole number.
- Output: a normalised register (records in the pipeline's register shape, source "IMPORTED") + a report of rows read,
  loaded, skipped and why. Nothing in the app changes unless you pass --area and --apply.
- --area: pair the records with that area's buildings by location (register.match_by_location) and report the outcomes.
  --apply: also write the result into that area's export.json (register fields, match status, differences, review queue,
  dashboard) and save the register as register_imported.json; then reload the area (backend/load_area.py), which keeps
  review decisions and lists every review item added or removed.
"""
import argparse
import csv
import json
import math
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.register import match_by_location, use_category  # noqa: E402

SQFT_M2 = 0.09290304


def read_rows(path, cfg):
    """[(row number, {column: value}, (lat, lon) from geometry or None)]"""
    ext = os.path.splitext(path)[1].lower()
    if ext in (".csv", ".txt", ".tsv"):
        with open(path, encoding=cfg.get("encoding", "utf-8-sig"), newline="") as f:
            rd = csv.DictReader(f, delimiter=cfg.get("delimiter") or ("\t" if ext == ".tsv" else ","))
            return [(i, row, None) for i, row in enumerate(rd, 2)]
    if ext in (".geojson", ".json"):
        with open(path, encoding="utf-8") as f:
            g = json.load(f)
        out = []
        for i, ft in enumerate(g.get("features") or [], 1):
            geom, pos = ft.get("geometry") or {}, None
            if geom.get("type") == "Point" and len(geom.get("coordinates") or []) >= 2:
                pos = (geom["coordinates"][1], geom["coordinates"][0])
            out.append((i, ft.get("properties") or {}, pos))
        return out
    if ext in (".xlsx", ".xlsm"):
        try:
            import openpyxl
        except ImportError:
            raise SystemExit("Excel needs openpyxl: backend\\.venv\\Scripts\\pip install openpyxl (or save the sheet as CSV)")
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb[cfg["sheet"]] if cfg.get("sheet") else wb.worksheets[0]
        rows = list(ws.iter_rows(values_only=True))
        head = [str(h).strip() if h is not None else "" for h in rows[0]]
        return [(i, dict(zip(head, r)), None) for i, r in enumerate(rows[1:], 2)]
    raise SystemExit(f"unsupported file type {ext!r} (csv, tsv, geojson, json, xlsx)")


def _num(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        x = float(str(v).replace(",", "").strip())
    except ValueError:
        return "bad"
    return x if math.isfinite(x) else "bad"


def geocoder(cache_path):
    """address → (lat, lon) with the server key (Geocoding API), cached on disk; None if not found / not allowed"""
    import requests
    from dotenv import dotenv_values
    key = (dotenv_values(os.path.join(ROOT, "backend", ".env")).get("GOOGLE_PLACES_SERVER_KEY") or "").strip()
    if not key:
        raise SystemExit("--geocode needs GOOGLE_PLACES_SERVER_KEY in backend/.env")
    cache = json.load(open(cache_path, encoding="utf-8")) if os.path.isfile(cache_path) else {}

    def go(address):
        if address in cache:
            return tuple(cache[address]) if cache[address] else None
        j = requests.get("https://maps.googleapis.com/maps/api/geocode/json", params={"address": address, "key": key},
                         timeout=20).json()
        if j.get("status") not in ("OK", "ZERO_RESULTS"):
            raise SystemExit(f"Geocoding answered {j.get('status')} (is the Geocoding API allowed on the server key?)")
        r = (j.get("results") or [None])[0]
        cache[address] = [r["geometry"]["location"]["lat"], r["geometry"]["location"]["lng"]] if r else None
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        json.dump(cache, open(cache_path, "w", encoding="utf-8"))
        return tuple(cache[address]) if cache[address] else None
    return go


def normalise(rows, cfg, geocode=None):
    """(records, report). A record has the pipeline's register fields; skipped rows are listed with their reason."""
    col = lambda k: cfg.get(k)
    use_map = {str(k).strip().lower(): v for k, v in (cfg.get("use_values") or {}).items()}
    unit = SQFT_M2 if str(cfg.get("area_unit", "m2")).lower() in ("sqft", "ft2", "sq ft") else 1.0
    recs, skipped, seen = [], [], set()
    unmapped_use, warn = Counter(), Counter()
    for n, row, pos in rows:
        get = lambda k: (row.get(col(k)) if col(k) else None)
        pid = get("id")
        pid = str(pid).strip() if pid is not None else ""
        if not pid:
            skipped.append((n, "no id")); continue
        if pid in seen:
            skipped.append((n, f"duplicate id {pid}")); continue
        lat, lon = (_num(get("lat")), _num(get("lon"))) if col("lat") and col("lon") else (pos or (None, None))
        if lat in (None, "bad") or lon in (None, "bad"):
            addr = str(get("address") or "").strip()
            if addr and geocode:
                g = geocode(addr)
                if not g:
                    skipped.append((n, "address not found by geocoding")); continue
                lat, lon = g
            else:
                skipped.append((n, "no coordinates" + (" (address given: run with --geocode)" if addr else ""))); continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            skipped.append((n, "coordinates out of range")); continue
        raw_use = get("use")
        use = None
        if raw_use not in (None, ""):
            use = use_map.get(str(raw_use).strip().lower(), str(raw_use).strip().lower())
            if not use_category(use):
                unmapped_use[str(raw_use)] += 1
        fl = _num(get("floors"))
        if fl == "bad":
            warn["floors not a number (left empty)"] += 1; fl = None
        ar = _num(get("area"))
        if ar == "bad":
            warn["area not a number (left empty)"] += 1; ar = None
        seen.add(pid)
        recs.append({"property_id": pid, "use_type": use, "floors": int(round(fl)) if fl is not None else None,
                     "plinth_area_m2": round(ar * unit, 1) if ar is not None else None, "record_lat": round(lat, 7),
                     "record_lon": round(lon, 7), "street": str(get("street") or "").strip() or None, "source": "IMPORTED",
                     "row": n})
    rep = {"rows_read": len(rows), "loaded": len(recs), "skipped": len(skipped),
           "skipped_by_reason": dict(Counter(r for _, r in skipped if not r.startswith("duplicate")) +
                                     Counter("duplicate id" for _, r in skipped if r.startswith("duplicate"))),
           "skipped_rows_first_20": [{"row": n, "why": r} for n, r in skipped[:20]],
           "use_values_not_compared": dict(unmapped_use), "warnings": dict(warn),
           "fields_present": {k: sum(1 for r in recs if r[f] is not None) for k, f in
                              (("use", "use_type"), ("floors", "floors"), ("area", "plinth_area_m2"))}}
    return recs, rep


def match_area(folder, records, cfg):
    L = lambda n: json.load(open(os.path.join(folder, f"{n}.json"), encoding="utf-8"))
    buildings, final = L("buildings"), L("final_attributes")
    bpos = (L("building_positions") or {}).get("by_building") or {}
    results, unmatched, pairs = match_by_location(buildings, final, records, bpos, cfg)
    st = Counter(m["match_status"] for m in results)
    out = {"buildings": len(buildings), "records": len(records), "matched": st.get("matched", 0),
           "differs": st.get("discrepancy", 0), "building_with_no_record": st.get("no_record", 0),
           "record_with_no_building_nearby": len(unmatched),
           "pin_in_wrong_place": sum("location_shift" in m["discrepancies"] for m in results),
           "differences": dict(Counter(d for m in results for d in m["discrepancies"] if d != "missing_record")),
           "match_confidence": dict(Counter(m.get("match_confidence") for m in results if m.get("property_id")))}
    return results, unmatched, out


def apply(folder, records, results, unmatched, cfg):
    """Write the imported register's comparison into the area's export (the same fields the pipeline exports)."""
    from geo_cascadia.match import review_queue
    from geo_cascadia.workspace import build_dashboard
    p = os.path.join(folder, "export.json")
    exp = json.load(open(p, encoding="utf-8"))
    names = json.load(open(os.path.join(folder, "street_names.json"), encoding="utf-8")) if os.path.isfile(os.path.join(folder, "street_names.json")) else {}
    E = {b["id"]: b for b in exp["buildings"]}
    for m in results:
        e = E[m["building_id"]]
        e["register"] = {"source": "IMPORTED", "property_id": m.get("property_id"), "record_use": m.get("record_use"),
                         "record_floors": m.get("record_floors"), "record_area_m2": m.get("record_area"),
                         "record_dist_m": m.get("record_dist_m"), "match_confidence": m.get("match_confidence"),
                         "match_margin_m": m.get("match_margin_m")}
        e.update(match_status=m["match_status"], discrepancies=m["discrepancies"], reasons=m["reasons"],
                 evidence_basis=m.get("evidence", {}), severity=m["severity"])
        m["street"] = names.get(m["street"], m["street"])
    A = [{**a, "cls": a["type"]} for a in exp["assets"]]
    queue = review_queue(results, A)
    qb = {}
    for q in queue:
        if q["item_type"] == "building":
            qb.setdefault(q["building_id"], []).append(q)
    for e in exp["buildings"]:
        rq = qb.get(e["id"], [])
        e["review"] = {**(e.get("review") or {}), "queued": bool(rq), "priority": min((q["priority"] for q in rq), default=None),
                       "reasons": sorted({x for q in rq for x in q["reasons"]}), "status": "pending" if rq else None}
    run = {**exp["meta"]["run"], "planted_error_scores": None,
           "register_matching": {"records": len(records), "records_unmatched": len(unmatched), "pairing": None}}
    dash = build_dashboard(results, A, {"60": exp["streetlight_gaps"]}, queue, run)
    dash["kpi"]["unmapped_businesses"] = len(exp.get("unmapped_businesses") or [])
    exp.update(review_queue=queue, dashboard=dash, register_unmatched=unmatched)
    exp["meta"] = {**exp["meta"], "run": run, "registers": "IMPORTED property register (matched by location, D43); SYNTHETIC asset register",
                   "counts": {**exp["meta"]["counts"], "review_items": len(queue)}}
    json.dump(exp, open(p, "w", encoding="utf-8"))
    json.dump(records, open(os.path.join(folder, "register_imported.json"), "w", encoding="utf-8"))
    for n in ("planted_register_mistakes.json", "register_synthetic.json"):        # no planted mistakes in a real register
        if os.path.isfile(os.path.join(folder, n)):
            os.replace(os.path.join(folder, n), os.path.join(folder, n.replace(".json", ".synthetic_backup.json")))


def main():
    ap = argparse.ArgumentParser(description="Load a real property register and match it to an area by location (D43).")
    ap.add_argument("file")
    ap.add_argument("--config", required=True, help="column mapping JSON (see the module docstring / docs/REGISTER_IMPORT.md)")
    ap.add_argument("--out", help="normalised register JSON (default data/registers/<file name>.json)")
    ap.add_argument("--area", help="an area folder to match against, e.g. data/areas/ward29")
    ap.add_argument("--apply", action="store_true", help="write the comparison into that area's export.json")
    ap.add_argument("--geocode", action="store_true", help="geocode the address column where coordinates are missing")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    with open(a.config, encoding="utf-8") as f:
        mapping = json.load(f)
    if not mapping.get("id") or not ((mapping.get("lat") and mapping.get("lon")) or mapping.get("address")
                                     or a.file.lower().endswith((".geojson", ".json"))):
        raise SystemExit("the config needs \"id\" and a position: \"lat\" + \"lon\", or \"address\" with --geocode, or a GeoJSON file")
    geo = geocoder(os.path.join(ROOT, "data", "cache", "geocode", "register.json")) if a.geocode else None
    records, rep = normalise(read_rows(a.file, mapping), mapping, geo)
    out = a.out or os.path.join(ROOT, "data", "registers", os.path.splitext(os.path.basename(a.file))[0] + ".json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": os.path.basename(a.file), "config": mapping, "report": rep, "records": records}, f, ensure_ascii=False)
    print(json.dumps({"register": out, **rep}, indent=1, ensure_ascii=False))
    if a.area:
        results, unmatched, summary = match_area(a.area, records, Config())
        print(json.dumps({"area": a.area, **summary}, indent=1))
        if a.apply:
            apply(a.area, records, results, unmatched, Config())
            print(f"written into {a.area}/export.json — now run: backend\\.venv\\Scripts\\python backend\\load_area.py {a.area}")
    elif a.apply:
        raise SystemExit("--apply needs --area")


if __name__ == "__main__":
    main()
