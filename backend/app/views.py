"""Pure functions over an area bundle: identical results whether the bundle came from the DB or the JSON files.

Counts are computed from the records (docs/DECISIONS.md D2), never copied from story[] text or meta.run counters.
The dashboard is rebuilt with the pipeline's own `workspace.build_dashboard`, and /query reuses `workspace.QueryEngine`
with inputs rebuilt from the export records (CLAUDE.md §7).
"""
import copy
from collections import Counter

from geo_cascadia.workspace import QueryEngine, build_dashboard

from .derived import computed_counts, consistency

NOT_CLASSIFIED = "not classified"   # D9: unclassified use is shown, never hidden
MODEL_CARD_AREA = "ward29"          # model_card cost_time figures are Ward 29 figures (D1)
RESUMED_BADGE = "resumed run, not representative"


def _attr(b, k):
    return (b.get("attributes") or {}).get(k) or {}


def export_view(bundle):
    """The bundle as an export.json-shaped dict (input for derived.py)."""
    return {"meta": bundle["meta"], "dashboard": bundle["dashboard_stored"], "buildings": bundle["buildings"],
            "assets": bundle["assets"], "missing_asset_records": bundle["missing_asset_records"],
            "streetlight_gaps": bundle["streetlight_gaps"], "review_queue": bundle["review_queue"],
            "unmapped_businesses": bundle["unmapped_businesses"]}


# ---------------------------------------------------------------- QueryEngine inputs (CLAUDE.md §7)
def engine_inputs(bundle):
    results = []
    for b in bundle["buildings"]:
        use, fl, nm, reg = _attr(b, "use"), _attr(b, "floors"), _attr(b, "name"), b.get("register") or {}
        results.append({
            "building_id": b["id"], "street": b.get("street"), "lat": b["lat"], "lon": b["lon"],
            "obs_use": use.get("value"), "use_route": use.get("route"), "obs_floors": fl.get("value"),
            "floors_status": fl.get("status"), "match_status": b.get("match_status"),
            "discrepancies": b.get("discrepancies") or [], "reasons": b.get("reasons") or [], "severity": b.get("severity"),
            "ref_flags": b.get("google_flags") or [], "name": nm.get("value"), "name_quality": nm.get("quality"),
            "name_verified_google": nm.get("google_confirmed"), "google_name": nm.get("google_name"),
            "area_m2": (b.get("footprint") or {}).get("area_m2"), "property_id": reg.get("property_id"),
            "record_use": reg.get("record_use"), "record_floors": reg.get("record_floors"),
            "review_status": (b.get("review") or {}).get("status")})
    assets = [{**a, "cls": a["type"]} for a in bundle["assets"]]
    gaps = {"60": bundle["streetlight_gaps"]}
    return results, assets, gaps, bundle["review_queue"]


def engine(bundle):
    if "_qe" not in bundle:
        bundle["_qe"] = QueryEngine(*engine_inputs(bundle))
    return bundle["_qe"]


# ---------------------------------------------------------------- summaries
def summary(bundle):
    exp = export_view(bundle)
    return {**computed_counts(exp), "review_status": dict(Counter(q["status"] for q in bundle["review_queue"]))}


def dashboard(bundle):
    """Rebuilt from the records with the pipeline's build_dashboard (same code that produced the stored one)."""
    results, assets, gaps, queue = engine_inputs(bundle)
    d = build_dashboard(results, assets, gaps, queue, run_stats=None)
    d.pop("cost_panel", None)                      # replaced by cost() below (D1)
    d["kpi"]["unmapped_businesses"] = len(bundle["unmapped_businesses"])
    d["kpi"]["use_not_classified"] = sum(r["obs_use"] is None for r in results)
    bu = d["charts"]["building_use"]
    if "not observed" in bu:
        bu[NOT_CLASSIFIED] = bu.pop("not observed")
    d["charts"]["floor_distribution_n"] = sum(d["charts"]["floor_distribution"].values())  # measured only
    return d


def cost(bundle, model_card):
    """D1: Ward 29 cost/time from model_card; run counters are from resumed runs and flagged as such."""
    run = bundle["meta"].get("run") or {}
    keys = ("street_view_requests", "street_view_cost_usd_notional", "vlm_calls", "vlm_cost_usd", "places_calls",
            "total_minutes", "stage_seconds", "device", "ocr_mode")
    mc = (model_card or {}).get("cost_time") if bundle["slug"] == MODEL_CARD_AREA else None
    return {"model_card": {"source": "model_card", **mc} if mc else None,
            "run_stats": {k: run.get(k) for k in keys}, "run_stats_representative": False, "run_stats_badge": RESUMED_BADGE}


def area_card(bundle):
    s = summary(bundle)
    return {"slug": bundle["slug"], "name": bundle["name"], "polygon_source": bundle["polygon_source"],
            "polygon": bundle["polygon"], "bbox": bundle["bbox"],
            "coverage_verdict": ((bundle["meta"].get("run") or {}).get("coverage") or {}).get("verdict"),
            "counts": {k: s[k] for k in ("buildings", "assets", "streets", "streetlight_gaps_60m", "review_items",
                                         "unmapped_businesses", "missing_asset_records", "use_not_classified",
                                         "assets_triangulated")},
            "match_status": s["match_status"]}


def area_detail(bundle, model_card):
    return {**area_card(bundle), "meta": bundle["meta"], "dashboard": dashboard(bundle), "summary": summary(bundle),
            "consistency": consistency(export_view(bundle), bundle["run_report"], model_card),
            "cost": cost(bundle, model_card), "run_report": bundle["run_report"],
            "streets": [{k: v for k, v in s.items() if k != "geometry"} for s in bundle["streets"]]}


# ---------------------------------------------------------------- map layers
def street_health(bundle):
    by = dashboard(bundle)["charts"]["by_street"]
    out = {}
    for s in bundle["streets"]:
        st = by.get(s["name"], {})
        km = (s.get("length_m") or 0) / 1000
        issues = st.get("discrepancy", 0) + st.get("no_record", 0)
        out[s["name"]] = {**st, "issues_per_km": round(issues / km, 2) if km else None}
    return out


def features(bundle, layers, keep=None):
    """GeoJSON features. keep: {layer: set(ids)} from a bbox filter, or None for everything."""
    ok = lambda layer, key: keep is None or key in keep.get(layer, set())
    F = lambda geom, props: {"type": "Feature", "geometry": geom, "properties": props}
    pt = lambda o: {"type": "Point", "coordinates": [o["lon"], o["lat"]]}
    feats = []
    if "streets" in layers:
        health = street_health(bundle)
        for s in bundle["streets"]:
            if s.get("geometry") and ok("streets", s["name"]):
                feats.append(F(s["geometry"], {"kind": "street", "id": s["name"], "name": s["name"], "length_m": s["length_m"],
                                               "road_type": s["road_type"], "coverage": s["coverage"], **health.get(s["name"], {})}))
    if "buildings" in layers:
        for b in bundle["buildings"]:
            if not ok("buildings", b["id"]):
                continue
            ring = (b.get("footprint") or {}).get("polygon_latlon") or []
            geom = {"type": "Polygon", "coordinates": [[[p[1], p[0]] for p in ring]]} if len(ring) >= 4 else pt(b)
            use, fl, nm = _attr(b, "use"), _attr(b, "floors"), _attr(b, "name")
            feats.append(F(geom, {
                "kind": "building", "id": b["id"], "street": b.get("street"), "lat": b["lat"], "lon": b["lon"],
                "use": use.get("value"), "use_route": use.get("route"), "floors": fl.get("value"),
                "floors_status": fl.get("status"), "match_status": b.get("match_status"), "severity": b.get("severity"),
                "discrepancies": b.get("discrepancies") or [], "name": nm.get("value") if nm.get("quality") == "good" else None,
                "google_confirmed": bool(nm.get("google_confirmed")), "review_status": (b.get("review") or {}).get("status")}))
    if "assets" in layers:
        for a in bundle["assets"]:
            if ok("assets", a["id"]):
                feats.append(F(pt(a), {
                    "kind": a["type"], "id": a["id"], "street": a.get("street"), "confidence": a.get("confidence"),
                    "method": a.get("method"), "approximate": a.get("method") != "triangulated",
                    "cameras_used": a.get("cameras_used"), "uncertainty_m": a.get("uncertainty_m"),
                    "register_status": (a.get("register") or {}).get("status"), "review_status": (a.get("review") or {}).get("status")}))
    if "gaps" in layers:
        for g in bundle["streetlight_gaps"]:
            if ok("gaps", g["id"]):
                feats.append(F({"type": "LineString", "coordinates": [g["start"][::-1], g["end"][::-1]]}, {
                    "kind": "streetlight_gap", "id": g["id"], "street": g.get("street"), "length_m": g.get("length_m"),
                    "interval_m": g.get("interval_m"), "poles_inside": g.get("poles_inside"), "gap_type": g.get("gap_type")}))
    if "unmapped" in layers:
        for u in bundle["unmapped_businesses"]:
            if ok("unmapped", u["id"]):
                feats.append(F(pt(u), {"kind": "unmapped_business", "id": u["id"], "name": u.get("name"), "street": u.get("street"),
                                       "sightings": u.get("sightings"), "approximate": True}))
    if "missing" in layers:
        for m in bundle["missing_asset_records"]:
            if ok("missing", m["asset_no"]):
                feats.append(F(pt(m), {"kind": "missing_asset_record", "id": m["asset_no"], "street": m.get("street"),
                                       "why": m.get("why"), "register": "SYNTHETIC"}))
    return feats


# ---------------------------------------------------------------- lists
def _norm(x):
    return (x or "").lower()


def filter_buildings(bundle, street=None, status=None, use=None, q=None, floors_status=None, review_status=None,
                     severity=None):
    out = []
    for b in bundle["buildings"]:
        u, nm = _attr(b, "use"), _attr(b, "name")
        if street and b.get("street") != street:
            continue
        if status and b.get("match_status") != status:
            continue
        if use and (u.get("value") is not None if use in ("not_classified", NOT_CLASSIFIED) else u.get("value") != use):
            continue
        if floors_status and _attr(b, "floors").get("status") != floors_status:
            continue
        if review_status and (b.get("review") or {}).get("status") != review_status:
            continue
        if severity and b.get("severity") != severity:
            continue
        if q:
            sv = (b.get("evidence") or {}).get("sign_view") or {}
            hay = " ".join(_norm(x) for x in (b["id"], b.get("street"), nm.get("value"), nm.get("google_name"), sv.get("ocr_text")))
            if _norm(q) not in hay:
                continue
        out.append(b)
    return out


def filter_assets(bundle, street=None, type=None, status=None, confidence=None, method=None, review_status=None):
    return [a for a in bundle["assets"]
            if (not street or a.get("street") == street) and (not type or a["type"] == type)
            and (not status or (a.get("register") or {}).get("status") == status)
            and (not confidence or a.get("confidence") == confidence) and (not method or a.get("method") == method)
            and (not review_status or (a.get("review") or {}).get("status") == review_status)]


def page(rows, page, page_size):
    page, page_size = max(1, page), max(1, min(page_size, 500))
    return {"total": len(rows), "page": page, "page_size": page_size, "rows": rows[(page - 1) * page_size: page * page_size]}


def review_row(bundle, q):
    """Review item + a small summary of the object it points to."""
    if q["item_type"] == "building":
        b = next((x for x in bundle["buildings"] if x["id"] == q["ref_id"]), None) or {}
        obj = {"use": _attr(b, "use").get("value"), "floors": _attr(b, "floors").get("value"),
               "floors_status": _attr(b, "floors").get("status"), "match_status": b.get("match_status"),
               "name": _attr(b, "name").get("value"), "severity": b.get("severity")}
    else:
        a = next((x for x in bundle["assets"] if x["id"] == q["ref_id"]), None) or {}
        obj = {"type": a.get("type"), "confidence": a.get("confidence"), "method": a.get("method"),
               "register_status": (a.get("register") or {}).get("status")}
    return {**q, "area": bundle["slug"], "object": obj}


# ---------------------------------------------------------------- /query
def run_query(bundle, text):
    """QueryEngine.run + a uniform response. why_empty: the engine's funnel for building queries; for other intents
    a funnel built the same way (all → filters → 0)."""
    qe = engine(bundle)
    parsed, res = qe.run(text)
    parsed = copy.deepcopy(parsed)
    funnel = parsed.pop("why_empty", None)
    it = parsed["intent"]
    out = {"text": text, "parsed_filters": parsed, "intent": it, "rows": None, "groups": None, "why_empty": []}
    if isinstance(res, dict):                       # group_by street
        out["groups"] = [{"key": k, "count": v} for k, v in res.items()]
        out["total"] = sum(res.values())
    else:
        out["rows"] = [_query_row(it, r) for r in res]
        out["total"] = len(res)
    if funnel:
        out["why_empty"] = [{"step": s, "count": n} for s, n in funnel]
    elif out["total"] == 0:
        out["why_empty"] = _other_funnel(bundle, qe, parsed)
    return out


def _query_row(intent, r):
    if intent == "buildings":
        return {"kind": "building", "id": r["building_id"], **{k: r.get(k) for k in (
            "street", "lat", "lon", "obs_use", "use_route", "obs_floors", "floors_status", "match_status", "discrepancies",
            "severity", "name", "name_quality", "ref_flags", "review_status")}}
    if intent == "assets":
        return {"kind": r["type"], "id": r["id"], **{k: r.get(k) for k in (
            "street", "lat", "lon", "confidence", "method", "uncertainty_m")}, "register_status": (r.get("register") or {}).get("status")}
    if intent == "streetlight_gaps":
        return {"kind": "streetlight_gap", **{k: r.get(k) for k in (
            "id", "street", "length_m", "interval_m", "start", "end", "poles_inside", "gap_type")}}
    return {"kind": "review_item", **r}       # review


def _other_funnel(bundle, qe, f):
    it, st = f["intent"], f.get("street")
    if it == "streetlight_gaps":
        k = str(min((40, 60, 100), key=lambda v: abs(v - f["interval_m"])))
        steps = [(f"{k} m gap analysis available", len(qe.G.get(k, [])))]
        if st:
            steps.append((f"on {st}", sum(g["street"] == st for g in qe.G.get(k, []))))
    elif it == "assets":
        steps = [(f"{f['asset_type']}s detected", sum(a["cls"] == f["asset_type"] for a in qe.A))]
        if st:
            steps.append((f"on {st}", sum(a["cls"] == f["asset_type"] and a.get("street") == st for a in qe.A)))
    else:
        steps = [("review items", len(qe.Q))]
        if st:
            steps.append((f"on {st}", sum(x.get("street") == st for x in qe.Q)))
        if f.get("reason_has"):
            steps.append((f"reason: {f['reason_has']}", sum((not st or x.get("street") == st)
                                                            and any(f["reason_has"] in r for r in x["reasons"]) for x in qe.Q)))
    return [{"step": s, "count": n} for s, n in steps]
