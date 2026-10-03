"""Pure functions over an area bundle: identical results whether the bundle came from the DB or the JSON files.

Counts are computed from the records (docs/DECISIONS.md D2), never copied from story[] text or meta.run counters.
The dashboard is rebuilt with the pipeline's own `workspace.build_dashboard`, and /query reuses `workspace.QueryEngine`
with inputs rebuilt from the export records (CLAUDE.md §7).
"""
import copy
from collections import Counter

from geo_cascadia.workspace import QueryEngine, build_dashboard

from . import queryparse, spatial
from .derived import computed_counts, consistency
from .streetgeo import gap_consistency

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
    # P5 fix: "Waiting for review" counts only items still waiting; low_confidence_observations stays the queue size
    d["kpi"]["waiting_for_review"] = sum(q.get("status") == "pending" for q in bundle["review_queue"])
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
            "live": bool(bundle.get("live")),
            "polygon": bundle["polygon"], "bbox": bundle["bbox"],
            "coverage_verdict": ((bundle["meta"].get("run") or {}).get("coverage") or {}).get("verdict"),
            "coverage": coverage(bundle, s),
            "counts": {k: s[k] for k in ("buildings", "assets", "streets", "streetlight_gaps_60m", "review_items",
                                         "unmapped_businesses", "missing_asset_records", "use_not_classified",
                                         "assets_triangulated")},
            "match_status": s["match_status"]}


def coverage(bundle, s=None):
    """Map-coverage facts for the low-coverage banner. View counts are the pipeline's coverage stats (meta.run.coverage);
    building / unmapped-business counts are computed from the records (D2)."""
    cov = (bundle["meta"].get("run") or {}).get("coverage") or {}
    s = s or summary(bundle)
    vp, vn = cov.get("views_planned"), cov.get("views_facing_no_mapped_building")
    share = round(vn / vp, 3) if vp and vn is not None else None
    verdict = cov.get("verdict") or ""
    return {"level": "full" if verdict.startswith("full") else "partial" if verdict else None,
            "verdict": verdict or None, "views_planned": vp, "views_facing_no_mapped_building": vn,
            "share_views_no_mapped_building": share, "osm_footprints": (cov.get("footprints") or {}).get("osm"),
            "buildings": s["buildings"], "unmapped_businesses": s["unmapped_businesses"], "assets": s["assets"]}


def area_detail(bundle, model_card):
    return {**area_card(bundle), "meta": bundle["meta"], "dashboard": dashboard(bundle), "summary": summary(bundle),
            "consistency": consistency(export_view(bundle), bundle["run_report"], model_card)
                           + gap_consistency(bundle["streetlight_gaps"], bundle.get("gap_display") or {}),
            "cost": cost(bundle, model_card), "run_report": bundle["run_report"],
            "streets": [{k: v for k, v in s.items() if k != "geometry"} for s in bundle["streets"]]}


# ---------------------------------------------------------------- map layers
def street_health(bundle):
    by = dashboard(bundle)["charts"]["by_street"]
    out = {}
    for s in bundle["streets"]:
        st = by.get(s["name"])
        km = (s.get("length_m") or 0) / 1000
        if st is None:        # no building stats for this line: "no data" (grey), never a healthy-looking 0 (D13)
            out[s["name"]] = {"has_stats": False, "issues_per_km": None}
            continue
        issues = st.get("discrepancy", 0) + st.get("no_record", 0)
        out[s["name"]] = {**st, "has_stats": True, "issues_per_km": round(issues / km, 2) if km else None}
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
                feats.append(F(s["geometry"], {"kind": "street", "id": s["name"], "name": s["name"], "osm_name": s.get("osm_name"),
                                               "length_m": s["length_m"],
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
                    "cameras_used": a.get("cameras_used"), "n_detections": a.get("n_detections"), "uncertainty_m": a.get("uncertainty_m"),
                    "register_status": (a.get("register") or {}).get("status"), "review_status": (a.get("review") or {}).get("status")}))
    if "gaps" in layers:
        disp = bundle.get("gap_display") or {}
        for g in bundle["streetlight_gaps"]:
            if ok("gaps", g["id"]):
                d = disp.get(g["id"]) or {}
                path = d.get("path") or [g["start"][::-1], g["end"][::-1]]      # D13: along the road, or as recorded
                feats.append(F({"type": "LineString", "coordinates": path}, {
                    "kind": "streetlight_gap", "id": g["id"], "street": g.get("street"), "length_m": g.get("length_m"),
                    "interval_m": g.get("interval_m"), "poles_inside": g.get("poles_inside"), "gap_type": g.get("gap_type"),
                    "display_mode": d.get("mode", "straight"), "along_road_m": d.get("along_road_m"),
                    "length_differs": bool(d.get("length_differs")), "lit_cameras_inside": d.get("lit_cameras_inside"),
                    "longest_dark_along_road_m": d.get("longest_dark_along_road_m"), "note": d.get("note")}))
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
               # a sign text is shown as the building's name only when it reads as a real name (D32 name quality)
               "name": _attr(b, "name").get("value") if _attr(b, "name").get("quality") == "good" else None,
               "severity": b.get("severity")}
    else:
        a = next((x for x in bundle["assets"] if x["id"] == q["ref_id"]), None) or {}
        obj = {"type": a.get("type"), "confidence": a.get("confidence"), "method": a.get("method"),
               "register_status": (a.get("register") or {}).get("status")}
    return {**q, "area": bundle["slug"], "object": obj}


# ---------------------------------------------------------------- /query
STORED_GAP_M = 60                   # the only interval the pipeline exported (fix 2)
GOOGLE_FLAG = "sign_not_in_google_within_40m"


def run_query(bundle, text, explain=True, gaps_at=None, scope_street=None, near_at=None, near_m=None):
    """QueryEngine.run + a uniform response. why_empty: the engine's funnel for building queries; for other intents
    a funnel built the same way (all → filters → 0). Typed questions go through queryparse first (synonyms + what was
    understood / ignored, docs/QUERY.md); chips built by clicking are canonical text and skip that step.

    gaps_at(interval) → {"rows", "display"} | None: dark stretches at intervals other than the stored 60 m, computed
    with the pipeline's method (gaps.GapCalc); None = can't be computed → said plainly, never reported as 0 (fix 2).
    scope_street: the street the person had selected; a typed question that names no street is answered on it and says
    so with a Street chip (fix 3: one scope, never two). A by-street chart covers every street and ignores it.

    near_at(metres) → {"ids", "method"}: D53 spatial rule "within N m of a possible dark stretch" (spatial.py; PostGIS
    online). The phrase is taken out of a typed question before QueryEngine reads the rest; near_m = from edited chips."""
    qe = engine(bundle)
    und = None
    phrase = None
    if explain:
        text_q, m, phrase = spatial.extract(text)
        near_m = m or near_m
        read_as, und = queryparse.understand(qe, text_q if m else text, compose_query)
        read_as = _scoped(qe, read_as, und, scope_street)
        parsed, res = qe.run(read_as)
    else:
        parsed, res = qe.run(text)
    parsed = copy.deepcopy(parsed)
    funnel = parsed.pop("why_empty", None)
    it = parsed["intent"]
    near = None
    if near_m and (it != "buildings" or near_at is None):
        if und is not None:                                  # only building questions take the distance rule
            und["ignored"] = und["ignored"] + [phrase or f"within {near_m} m of a possible dark stretch"]
            und["status"] = "partial" if und["understood"] else "not_understood"
    elif near_m:
        nd = near_at(near_m)
        base = res
        if isinstance(res, dict):                            # by street: count the kept buildings per street
            base = qe.run(compose_query({k: v for k, v in parsed.items() if k != "group_by"}))[1]
        kept = [r for r in base if r["building_id"] in nd["ids"]]
        res = dict(Counter(r["street"] for r in kept).most_common()) if isinstance(res, dict) else kept
        parsed["near_dark_m"] = near_m
        near = {"near_dark_m": near_m, "method": nd["method"], "before": len(base), "after": len(kept),
                "note": f"Kept the buildings whose outline lies within {near_m} m of a possible dark stretch as the map "
                        f"draws it (the pipeline's stored 60 m stretches)."}
        if und is not None:
            und["understood"] = und["understood"] + [{"phrase": phrase or "", "meaning": f"within {near_m} m of a possible dark stretch"}]
    out = {"text": text, "parsed_filters": parsed, "intent": it, "rows": None, "groups": None, "why_empty": [], "understanding": und,
           **({"spatial": near} if near else {})}
    all_gaps = None
    if it == "streetlight_gaps" and parsed["interval_m"] != STORED_GAP_M:
        iv = parsed["interval_m"]
        comp = gaps_at(iv) if gaps_at else None
        if comp is None:
            out.update(rows=[], total=None, gaps={"interval_m": iv, "computed": False, "available": False, "note":
                       f"Dark stretches at {iv} m can't be computed for this area: the camera plan (plan.json) is not "
                       f"available. Only the pipeline's stored {STORED_GAP_M} m stretches exist."})
            return out
        all_gaps, st = comp["rows"], parsed.get("street")
        rows = sorted([g for g in all_gaps if not st or g["street"] == st], key=lambda g: -g["length_m"])
        out["rows"] = [{**_query_row(it, g, comp["display"]), "computed": True,
                        "path": (comp["display"].get(g["id"]) or {}).get("path")} for g in rows]
        out["total"] = len(rows)
        out["gaps"] = {"interval_m": iv, "computed": True, "available": True, "note": gaps_note()}
    elif isinstance(res, dict):                       # group_by street
        out["groups"] = [{"key": k, "count": v} for k, v in res.items()]
        out["total"] = sum(res.values())
    else:
        disp = bundle.get("gap_display") or {}
        out["rows"] = [_query_row(it, r, disp) for r in res]
        out["total"] = len(res)
        if it == "streetlight_gaps":
            out["gaps"] = {"interval_m": STORED_GAP_M, "computed": False, "available": True, "note": "stored by the pipeline"}
    if it == "buildings" and parsed.get("ref_flag") == GOOGLE_FLAG:
        out["note"] = _google_note(qe, parsed, out["total"])
    if near:
        steps = [{"step": s, "count": n} for s, n in funnel] if funnel else             [{"step": "buildings matching the rest of the question", "count": near["before"]}]
        out["why_empty"] = steps + [{"step": f"within {near['near_dark_m']} m of a possible dark stretch", "count": near["after"]}]
    elif funnel:
        out["why_empty"] = [{"step": s, "count": n} for s, n in funnel]
    elif out["total"] == 0:
        out["why_empty"] = _other_funnel(bundle, qe, parsed, all_gaps)
    return out


def _scoped(qe, read_as, und, street):
    """Answer a question that names no street on the selected street (fix 3), if QueryEngine reads it back exactly."""
    parsed = {k: v for k, v in qe.parse(read_as).items() if k != "why_empty"}
    if not street or street not in qe.streets or parsed.get("street") or parsed.get("group_by") == "street":
        return read_as
    want = normalize_filters({**parsed, "street": street})
    try:
        t2 = compose_query(want)
    except FilterError:
        return read_as
    if {k: v for k, v in qe.parse(t2).items() if k != "why_empty"} != want:
        return read_as
    und["scoped_to"] = street
    if und["understood"]:
        und["understood"] = und["understood"] + [{"phrase": "", "meaning": f"on {street} (the street you selected)"}]
    return t2


def gaps_note():
    from .gaps import COMPUTED_NOTE
    return COMPUTED_NOTE


USE_WORDS = {"commercial": "shops", "mixed": "mixed use", "residential": "homes", "institutional": "institutional",
             "other": "other use", None: "use not known"}


def _google_note(qe, f, total):
    """Fix 5: "businesses not on Google" (34) vs Trust's 23 of 116 named businesses on Google (93 not). Both come
    from the records: the flag marks a building whose sign name was not found on Google within 40 m, whatever its use."""
    flagged = [m for m in qe.M if GOOGLE_FLAG in (m.get("ref_flags") or [])]
    if len(flagged) == total:
        return None
    by = Counter(m.get("obs_use") for m in flagged)
    other = [(u, n) for u, n in by.most_common() if u not in ("commercial", "mixed")]
    rest = ", ".join(f"{USE_WORDS.get(u, u)} {n}" for u, n in other)
    what = "shops & businesses (commercial or mixed use)" if f.get("use") == "commercial" else "buildings"
    scope = f" on {f['street']}" if f.get("street") else ""
    verb = "has" if total == 1 else "have"
    tail = f", including {sum(n for _, n in other)} that are not shops ({rest})." if other and f.get("use") == "commercial" else "."
    return (f"{total} {what}{scope} {verb} a sign name that was not found on Google within 40 m. In the whole area "
            f"{len(flagged)} named buildings are not on Google{tail}")


def _query_row(intent, r, disp=None):
    if intent == "buildings":
        return {"kind": "building", "id": r["building_id"], **{k: r.get(k) for k in (
            "street", "lat", "lon", "obs_use", "use_route", "obs_floors", "floors_status", "match_status", "discrepancies",
            "severity", "name", "name_quality", "ref_flags", "review_status")}}
    if intent == "assets":
        return {"kind": r["type"], "id": r["id"], **{k: r.get(k) for k in (
            "street", "lat", "lon", "confidence", "method", "uncertainty_m")}, "register_status": (r.get("register") or {}).get("status")}
    if intent == "streetlight_gaps":
        d = (disp or {}).get(r.get("id")) or {}
        return {"kind": "streetlight_gap", **{k: r.get(k) for k in (
            "id", "street", "length_m", "interval_m", "start", "end", "poles_inside", "gap_type")},
                # D13: recorded length stays the value; along-road length + check flag shown beside it
                "display_mode": d.get("mode", "straight"), "along_road_m": d.get("along_road_m"),
                "length_differs": bool(d.get("length_differs")), "lit_cameras_inside": d.get("lit_cameras_inside"),
                "longest_dark_along_road_m": d.get("longest_dark_along_road_m"), "note": d.get("note")}
    return {"kind": "review_item", **r}       # review


def _other_funnel(bundle, qe, f, all_gaps=None):
    it, st = f["intent"], f.get("street")
    if it == "streetlight_gaps":
        allg = all_gaps if all_gaps is not None else qe.G.get(str(STORED_GAP_M), [])
        steps = [(f"{f['interval_m']} m gap analysis available", len(allg))]
        if st:
            steps.append((f"on {st}", sum(g["street"] == st for g in allg)))
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


# ---------------------------------------------------------------- editable filter chips → QueryEngine
FILTER_KEYS = ("intent", "street", "use", "floors_op", "floors_n", "match_status", "discrepancy", "ref_flag", "group_by",
               "interval_m", "asset_type", "reason_has")
OP_WORDS = {">": "more than", ">=": "at least", "<": "less than", "==": "exactly"}


class FilterError(ValueError):
    pass


def normalize_filters(f):
    out = {k: f[k] for k in FILTER_KEYS if f.get(k) not in (None, "", False)}
    out.setdefault("intent", "buildings")
    if "floors_n" in out:
        out["floors_n"] = int(out["floors_n"])
    if "interval_m" in out:
        out["interval_m"] = int(out["interval_m"])
    return out


def compose_query(f):
    """Canonical English for a filter set, phrased so QueryEngine.parse() reads back exactly these filters.
    Chip edits therefore still run through the pipeline's QueryEngine (CLAUDE.md §7), never a second query engine."""
    f = normalize_filters(f)
    it, parts = f["intent"], []
    if it == "streetlight_gaps":
        parts.append(f"streets where no streetlight is detected within {f.get('interval_m', 60)} m")
    elif it == "assets":
        parts.append("show streetlights" if f.get("asset_type") == "streetlight" else "show poles")
    elif it == "review":
        parts.append("review items" + (" with low-confidence floor count" if f.get("reason_has") else ""))
    else:
        w = ["show"] + ([f["use"]] if f.get("use") in ("commercial", "residential") else []) + ["buildings"]
        if f.get("floors_op"):
            if f["floors_op"] not in OP_WORDS or "floors_n" not in f:
                raise FilterError("floors filter needs an operator (>, >=, <, ==) and a number")
            w.append(f"with {OP_WORDS[f['floors_op']]} {queryparse.plural(f['floors_n'], 'visible floor')}")
        if f.get("match_status") == "no_record":
            w.append("that do not have a matching property record")
        elif f.get("match_status") == "discrepancy":
            w.append("flagged with a discrepancy")
        if f.get("discrepancy"):
            w.append("with " + str(f["discrepancy"]).replace("_", " "))
        if f.get("ref_flag"):
            w.append("whose sign is not in google")
        parts.append(" ".join(w))
    if f.get("street"):
        parts.append(f"on {f['street']}")
    if it == "buildings" and f.get("group_by") == "street":
        parts.append("by street")
    return " ".join(parts)


def run_filters(bundle, filters, gaps_at=None, near_at=None):
    near_m = int(filters.get("near_dark_m") or 0) or None        # D53: applied after QueryEngine (spatial.py)
    want = normalize_filters(filters)
    if want["intent"] != "buildings":
        want.pop("group_by", None)
    text = compose_query(want)
    got = {k: v for k, v in engine(bundle).parse(text).items() if k != "why_empty"}
    if got != want:
        raise FilterError(f"these filters can't be expressed for QueryEngine (read back as {got})")
    return run_query(bundle, text, explain=False, gaps_at=gaps_at, near_at=near_at,
                     near_m=near_m if want["intent"] == "buildings" else None)
