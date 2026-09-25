"""Countable facts computed from export.json records, and stored-vs-computed mismatches (docs/DECISIONS.md D2).

Rule: anything countable is computed from the records here, never copied from meta.run counters, run_report
sections or story[] text. Where stored values disagree, `consistency()` lists them for the Trust page.
Pure stdlib — safe to import anywhere (loader, API, tools).
"""
import re
from collections import Counter


def _count(xs):
    return dict(Counter(x for x in xs))


def computed_counts(exp):
    B, A = exp.get("buildings", []), exp.get("assets", [])
    Q, U = exp.get("review_queue", []), exp.get("unmapped_businesses") or []
    attr = lambda b, k: (b.get("attributes") or {}).get(k) or {}
    return {
        "buildings": len(B),
        "assets": len(A),
        "missing_asset_records": len(exp.get("missing_asset_records", [])),
        "streetlight_gaps_60m": len(exp.get("streetlight_gaps", [])),
        "review_items": len(Q),
        "unmapped_businesses": len(U),
        "streets": len({b["street"] for b in B}),
        "match_status": _count(b.get("match_status") for b in B),
        "use_route": _count(attr(b, "use").get("route") for b in B if attr(b, "use").get("route")),
        "floors_status": _count(attr(b, "floors").get("status") for b in B),
        "name_route": _count(attr(b, "name").get("route") for b in B if attr(b, "name").get("route")),
        "name_quality": _count(attr(b, "name").get("quality") for b in B if attr(b, "name").get("quality")),
        "names_google_confirmed": sum(bool(attr(b, "name").get("google_confirmed")) for b in B),
        "asset_type": _count(a.get("type") for a in A),
        "asset_method": _count(a.get("method") for a in A),
        "assets_triangulated": sum(a.get("method") == "triangulated" for a in A),
        "assets_seen_by_2plus_cameras": sum((a.get("cameras_used") or 0) >= 2 for a in A),
        "asset_register_status": _count((a.get("register") or {}).get("status") for a in A),
        "review_by_type": _count(q.get("item_type") for q in Q),
    }


def _n_in(text):
    m = re.search(r"\(n=(\d+)\)", text or "")
    return int(m.group(1)) if m else None


def consistency(exp, run_report=None, model_card=None):
    """List of {field, stored, computed, source, note} where a stored value disagrees with the data."""
    C, out = computed_counts(exp), []
    meta, run = exp.get("meta", {}), exp.get("meta", {}).get("run", {})
    kpi = (exp.get("dashboard") or {}).get("kpi", {})

    def chk(field, stored, computed, source, note=""):
        if stored is not None and stored != computed:
            out.append({"field": field, "stored": stored, "computed": computed, "source": source, "note": note})

    for k, v in (meta.get("counts") or {}).items():
        chk(f"meta.counts.{k}", v, C.get(k), "export.json meta")
    for k, ck in (("buildings_analysed", "buildings"), ("streetlights", None), ("poles", None),
                  ("low_confidence_observations", "review_items"), ("unmapped_businesses", "unmapped_businesses"),
                  ("unmatched_properties", None), ("buildings_with_discrepancy", None), ("streets_covered", "streets")):
        comp = {"streetlights": C["asset_type"].get("streetlight", 0), "poles": C["asset_type"].get("pole", 0),
                "unmatched_properties": C["match_status"].get("no_record", 0),
                "buildings_with_discrepancy": C["match_status"].get("discrepancy", 0)}.get(k, C.get(ck))
        chk(f"dashboard.kpi.{k}", kpi.get(k), comp, "export.json dashboard")

    ur = C["use_route"]
    chk("meta.run.buildings_use_local", run.get("buildings_use_local"), ur.get("tier1_local_clip", 0), "export.json meta.run",
        "stored counter counts VLM-stage records; computed = buildings whose exported use.route is tier1_local_clip")
    chk("meta.run.buildings_use_vlm", run.get("buildings_use_vlm"), ur.get("tier3_vlm", 0), "export.json meta.run",
        "computed = buildings whose exported use.route is tier3_vlm")

    if run_report:
        ra = run_report.get("assets") or {}
        chk("run_report.assets.triangulated_2plus_cameras (and story[])", ra.get("triangulated_2plus_cameras"),
            C["assets_triangulated"], "run_report.json",
            f"report counts assets seen by 2+ cameras ({C['assets_seen_by_2plus_cameras']}); "
            f"computed = assets whose position method is 'triangulated'")
        chk("run_report.assets.single_camera_approximate (and story[])", ra.get("single_camera_approximate"),
            C["assets"] - C["assets_triangulated"], "run_report.json", "computed = assets not positioned by triangulation")
        rb = (run_report.get("buildings") or {}).get("use_route")
        if rb is not None:
            chk("run_report.buildings.use_route", rb, ur, "run_report.json", "report counts VLM-stage records, not exported buildings")

    if model_card and "ward 29" in (meta.get("area") or "").lower():
        fr = (((model_card.get("building_use") or {}).get("local_router") or {}).get("full_ward29_run") or {})
        chk("model_card.building_use.local_router.full_ward29_run.local", fr.get("local"), ur.get("tier1_local_clip", 0),
            "model_card.json", "count, so the export wins (D2); the model_card accuracy figures are unaffected")
        chk("model_card.building_use.local_router.full_ward29_run.vlm", fr.get("vlm"), ur.get("tier3_vlm", 0), "model_card.json")

    if model_card:
        # metrics: model_card wins; flag per-building 'validated' strings that quote a different n
        mc_floor_n = ((model_card.get("floors") or {}).get("ward29") or {}).get("n")
        mc_use_n = ((model_card.get("building_use") or {}).get("vlm_accuracy") or {}).get("n")
        val = run.get("validation") or {}
        for key, mc_n in (("floors", mc_floor_n), ("use", mc_use_n)):
            if val.get(key) and mc_n is not None and _n_in(val[key]) not in (None, mc_n):
                out.append({"field": f"buildings[].attributes.{key}.validated", "stored": val[key],
                            "computed": f"model_card n={mc_n}", "source": "export.json",
                            "note": "metric: model_card.json is the only source (D2)"})
    return out
