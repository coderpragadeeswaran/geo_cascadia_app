"""build_run_report.py — turn one pipeline run folder into run_report.json for the Pipeline Inspector page.

Usage:  python build_run_report.py <run_dir> [--out <run_dir>/run_report.json]
Reads only files the geo_cascadia pipeline already writes (all optional; missing files -> fields omitted).
No API calls, no model loading. Safe to run on the laptop.
"""
import os, sys, json, argparse
from collections import Counter, defaultdict


def load(d, name, default=None):
    p = os.path.join(d, f"{name}.json")
    if not os.path.exists(p): return default
    try: return json.load(open(p))
    except Exception: return default


def build(run_dir):
    R = {"run_dir": os.path.basename(os.path.normpath(run_dir))}
    exp = load(run_dir, "export", {}) or {}
    meta, run = exp.get("meta", {}), exp.get("meta", {}).get("run", {})
    R["area"] = meta.get("area"); R["generated"] = meta.get("generated"); R["pipeline"] = meta.get("pipeline")
    cov = load(run_dir, "coverage", run.get("coverage", {})) or {}

    # ---------------- 1. imagery ----------------
    panos = load(run_dir, "panos", []) or []
    plan = load(run_dir, "plan", []) or []
    anomalies = load(run_dir, "plan_anomalies", []) or []
    done = load(run_dir, "_views_done", []) or []
    views = [v for e in plan for v in e.get("views", [])]
    R["imagery"] = {
        "panoramas_found": len(panos),
        "google_car": sum(p.get("source", "google") == "google" for p in panos),
        "user_photospheres": sum(p.get("source") == "user" for p in panos),
        "cameras_planned": len(plan),
        "cameras_dropped": dict(Counter(a.get("reason") for a in anomalies)),
        "views_planned": len(views),
        "views_by_type": dict(Counter(v.get("side", "?").split("_", 1)[-1] if "_" in v.get("side", "") else "perpendicular" for v in views)),
        "views_facing_mapped_building": sum(v.get("footprint") is not None for v in views),
        "views_facing_no_mapped_building": sum(v.get("footprint") is None for v in views),
        "views_fetched_ok": len(done),
        "street_view_requests": run.get("street_view_requests"),
        "street_view_cost_usd_notional": run.get("street_view_cost_usd_notional"),
        "by_street": {s: {"cameras": sum(e["street"] == s for e in plan),
                          "views": sum(len(e["views"]) for e in plan if e["street"] == s)}
                      for s in sorted({e["street"] for e in plan})}}

    # ---------------- 2. maps / footprints ----------------
    R["maps"] = {"footprints": cov.get("footprints"), "osm_built_fraction": cov.get("osm_built_fraction"),
                 "buildings_registered": cov.get("buildings_registered"),
                 "buildings_by_source": cov.get("buildings_by_source"), "verdict": cov.get("verdict")}

    # ---------------- 3. detection ----------------
    dets = load(run_dir, "detections", []) or []
    R["detection"] = {"boxes_total": len(dets), "by_class": dict(Counter(d.get("cls") for d in dets)),
                      "used_for_geometry": sum(bool(d.get("geom_ok")) for d in dets),
                      "excluded_from_geometry": dict(Counter(("tilted view" if d.get("pitch") else "user photosphere")
                                                            for d in dets if not d.get("geom_ok"))),
                      "mean_conf_by_class": {c: round(sum(d["conf"] for d in dets if d.get("cls") == c) /
                                                      max(1, sum(d.get("cls") == c for d in dets)), 3)
                                             for c in sorted({d.get("cls") for d in dets})}}

    # ---------------- 4. assets ----------------
    assets = exp.get("assets") or load(run_dir, "assets", []) or []
    R["assets"] = {"located": len(assets), "by_type": dict(Counter(a.get("type", a.get("cls")) for a in assets)),
                   "by_confidence": dict(Counter(a.get("confidence") for a in assets)),
                   "triangulated_2plus_cameras": sum((a.get("cameras_used") or 0) >= 2 for a in assets),
                   "single_camera_approximate": sum((a.get("cameras_used") or 0) < 2 for a in assets),
                   "register_status": dict(Counter((a.get("register") or {}).get("status") for a in assets)),
                   "streetlight_gaps_60m": len(exp.get("streetlight_gaps", [])),
                   "missing_asset_records": len(exp.get("missing_asset_records", []))}

    # ---------------- 5. buildings: why some get no attributes ----------------
    bviews = load(run_dir, "building_views", []) or []
    vb = load(run_dir, "vlm_buildings", []) or []
    fin = load(run_dir, "final_attributes", []) or []
    n_reg = cov.get("buildings_registered") or len(fin)
    reasons = Counter()
    for q in bviews:
        if q.get("reliable"): continue
        for k, label in (("full_frame", "box fills the whole photo"), ("top_cut", "roof cut off at top"),
                         ("bottom_cut", "base cut off at bottom"), ("sliver", "thin sliver at image edge")):
            if q.get(k): reasons[label] += 1; break
        else: reasons["implausibly tall box"] += 1
    wrong = sum(bool((r.get("vlm") or {}).get("wrong_target")) for r in vb)
    R["buildings"] = {
        "registered": n_reg,
        "with_a_building_box": len(bviews),
        "no_building_box_detected": max(0, n_reg - len(bviews)),
        "box_rejected_by_quality_gate": dict(reasons),
        "usable_view": sum(bool(q.get("reliable")) for q in bviews),
        "vlm_said_wrong_target": wrong,
        "use_route": dict(Counter((r.get("vlm") or {}).get("use_route", "tier3_vlm") for r in vb if "vlm" in r)),
        "use_values": dict(Counter(f.get("use") or "not observed" for f in fin)),
        "floors_status": dict(Counter(f.get("floors_status") for f in fin)),
        "floor_values": dict(Counter(str(f.get("floors")) for f in fin if f.get("floors") is not None))}

    # ---------------- 6. signs & names ----------------
    ocr = load(run_dir, "ocr", []) or []
    tier_name = {-1: "skipped (CPU fast-mode cap)", 0: "Google watermark", 1: "no readable text",
                 2: "read by OCR (Tier 2)", 3: "escalated to VLM (Tier 3)"}
    vnames = load(run_dir, "vlm_names", []) or []
    bl = exp.get("buildings", [])
    names = [b["attributes"]["name"] for b in bl if b.get("attributes", {}).get("name", {}).get("value")]
    R["signs"] = {"crops": len(ocr), "tiers": {tier_name.get(k, str(k)): v for k, v in Counter(r.get("tier") for r in ocr).items()},
                  "ocr_seconds_per_crop": run.get("ocr_sec_per_crop"), "ocr_mode": run.get("ocr_mode"),
                  "vlm_name_calls": len(vnames),
                  "vlm_name_verdicts": dict(Counter(((v.get("vlm") or {}).get("sign_type") or "unparsed") for v in vnames)),
                  "buildings_named": len(names),
                  "name_route": dict(Counter(n.get("route") for n in names)),
                  "name_quality": dict(Counter(n.get("quality") for n in names)),
                  "google_confirmed": sum(bool(n.get("google_confirmed")) for n in names)}
    ub = load(run_dir, "unmapped_businesses", []) or []
    vu = load(run_dir, "vlm_unmapped", {}) or {}
    R["unmapped_businesses"] = {"sign_candidates_checked_by_vlm": len(vu), "kept": len(ub),
                                "vlm_said_not_business": sum(not (v.get("is_sign") and v.get("sign_type") == "business") for v in vu.values()),
                                "examples": [u.get("name") for u in ub[:12]]}

    # ---------------- 7. matching & review ----------------
    R["matching"] = {"match_status": dict(Counter(b.get("match_status") for b in bl)),
                     "discrepancy_types": dict(Counter(d for b in bl for d in b.get("discrepancies", []))),
                     "planted_error_scores": run.get("planted_error_scores"),
                     "asset_register_scores": run.get("asset_register_scores"),
                     "register_note": meta.get("registers")}
    q = exp.get("review_queue", [])
    R["review"] = {"items": len(q), "by_priority": dict(Counter(str(x.get("priority")) for x in q)),
                   "by_reason": dict(Counter(r for x in q for r in x.get("reasons", [])))}

    # ---------------- 8. cost & time ----------------
    R["cost_time"] = {"stage_seconds": run.get("stage_seconds"), "total_minutes": run.get("total_minutes"),
                      "vlm_calls": run.get("vlm_calls"), "vlm_cost_usd": run.get("vlm_cost_usd"),
                      "places_calls": run.get("places_calls"), "device": run.get("device"),
                      "buildings_use_local": run.get("buildings_use_local"), "buildings_use_vlm": run.get("buildings_use_vlm")}

    # ---------------- 9. plain-English story (what the Inspector shows at the top) ----------------
    im, bd, sg = R["imagery"], R["buildings"], R["signs"]
    R["story"] = [
        f"Found {im['panoramas_found']} Street View panoramas ({im['user_photospheres']} user photospheres, excluded from geometry).",
        f"Planned {im['cameras_planned']} camera stops and {im['views_planned']} views instead of a full 12-heading sweep.",
        f"{im['views_facing_no_mapped_building']} views face frontage with no building outline in OSM"
        + (f" — map coverage verdict: {R['maps']['verdict']}." if R['maps'].get('verdict') else "."),
        f"The detector drew {R['detection']['boxes_total']} boxes; {R['detection']['used_for_geometry']} were usable for positioning.",
        f"Located {R['assets']['located']} poles/streetlights; {R['assets']['triangulated_2plus_cameras']} triangulated from 2+ cameras, "
        f"{R['assets']['single_camera_approximate']} approximate (single camera).",
        f"{bd['registered']} buildings registered; {bd['usable_view']} had a usable view for use/floors, "
        f"{bd['no_building_box_detected']} had no building box at all.",
        f"{sg['crops']} sign crops: {sum(v for k, v in sg['tiers'].items() if 'OCR' in k)} read locally, "
        f"{sum(v for k, v in sg['tiers'].items() if 'VLM' in k)} escalated; {sg['buildings_named']} buildings named, "
        f"{sg['google_confirmed']} confirmed by Google.",
        f"{R['unmapped_businesses']['kept']} businesses found with no analysed building (signs on frontage with no analysed building outline).",
        f"{R['review']['items']} items sent to human review."]
    return R


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("run_dir"); ap.add_argument("--out")
    a = ap.parse_args()
    rep = build(a.run_dir)
    out = a.out or os.path.join(a.run_dir, "run_report.json")
    json.dump(rep, open(out, "w"), indent=1)
    print("\n".join(rep["story"])); print(f"\nsaved -> {out}")
