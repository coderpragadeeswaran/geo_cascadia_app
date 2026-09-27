"""sign_use_recompute.py — apply D32 (building use from sign text + stricter name quality) to a saved run, from saved
files only: no YOLO / OCR / VLM / Street View / Places calls.

    backend\\.venv\\Scripts\\python tools\\sign_use_recompute.py data/areas/<slug> [--write]

Steps (the same pipeline functions run_area calls, geo_cascadia unchanged otherwise):
  1. regression check: the pipeline's own matching on the SAVED final_attributes must reproduce the current export
     (match status, differences, severity, register ids, review queue). If not, nothing is written.
  2. final_attributes → signuse.fill_use_from_signs → match_properties → review_queue (assets' queue rows unchanged).
  3. patch export.json building records (use, name quality, match fields, review), meta counts, dashboard; rewrite
     final_attributes.json, export.json, export.geojson, dashboard.json. Rebuild run_report.json separately.
Prints what changed. Without --write it only reports.
"""
import argparse
import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.export import to_geojson  # noqa: E402
from geo_cascadia.match import match_properties, review_queue, synthetic_property_register  # noqa: E402
from geo_cascadia.signuse import fill_use_from_signs  # noqa: E402
from geo_cascadia.textmatch import name_quality  # noqa: E402
from geo_cascadia.workspace import build_dashboard  # noqa: E402

CMP = ("match_status", "discrepancies", "severity", "property_id")


def load(d, n):
    with open(os.path.join(d, f"{n}.json"), encoding="utf-8") as f:
        return json.load(f)


def save(d, n, obj, ext="json"):
    """exactly the pipeline's own format (run_area save: compact, ASCII-escaped), so every reader decodes it"""
    with open(os.path.join(d, f"{n}.{ext}"), "w", encoding="utf-8") as f:
        json.dump(obj, f)


def recompute(folder, write=False):
    cfg = Config()
    buildings, final, ocr = load(folder, "buildings"), load(folder, "final_attributes"), load(folder, "ocr")
    streets, names, exp = load(folder, "streets"), load(folder, "street_names"), load(folder, "export")
    kind = {s["name"]: s.get("kind", "residential") for s in streets}
    register, _ = synthetic_property_register(buildings, kind, cfg)
    E = {b["id"]: b for b in exp["buildings"]}

    # 1. regression: old attributes reproduce the export
    old = {m["building_id"]: m for m in match_properties(buildings, final, register, cfg)}
    bad = [bid for bid, m in old.items() if bid in E and any(
        (m.get(k) if k != "property_id" else m.get("property_id")) != (E[bid].get(k) if k != "property_id" else (E[bid].get("register") or {}).get("property_id"))
        for k in CMP)]
    if bad or set(old) != set(E):
        raise SystemExit(f"{folder}: saved files do not reproduce export.json ({len(bad)} buildings differ) — nothing written")

    # 2. the fix
    final2, stats = fill_use_from_signs([dict(f) for f in final], ocr, cfg)
    res = match_properties(buildings, final2, register, cfg)
    nm = lambda s: names.get(s, s)
    for m in res:
        e = E[m["building_id"]]
        nmr = (e["attributes"].get("name") or {})
        m.update(street=nm(m["street"]), name_verified_google=nmr.get("google_confirmed"), google_name=nmr.get("google_name"),
                 google_place_id=nmr.get("google_place_id"), ref_flags=list(e.get("google_flags") or []))
        m["name_quality"] = name_quality(m.get("name"), m.get("name_src"), m["name_verified_google"])
        if m["name_quality"] != "good":
            m["ref_flags"] = [f for f in m["ref_flags"] if f != "sign_not_in_google_within_40m"]
    bq = [q for q in review_queue(res, []) if q["item_type"] == "building"]
    aq = [q for q in exp["review_queue"] if q["item_type"] != "building"]
    queue = sorted(bq + aq, key=lambda x: x["priority"])
    qb = {}
    for q in bq:
        qb.setdefault(q["building_id"], []).append(q)

    # 3. patch the export
    changed_use, changed_name, changed_match = [], [], []
    for m in res:
        e = E[m["building_id"]]
        a = e["attributes"]
        if a["use"].get("value") != m["obs_use"]:
            changed_use.append((m["building_id"], m["street"], m.get("name")))
            a["use"] = {"value": m["obs_use"], "route": m["use_route"], "validated": cfg.validation["use_sign"]}
        if (a.get("name") or {}).get("quality") != m["name_quality"] and a.get("name"):
            changed_name.append((m["building_id"], m.get("name"), a["name"]["quality"], m["name_quality"]))
            a["name"]["quality"] = m["name_quality"]
        e["google_flags"] = m["ref_flags"]
        before = (e["match_status"], tuple(e["discrepancies"]), e["severity"])
        e.update(match_status=m["match_status"], discrepancies=m["discrepancies"], reasons=m["reasons"],
                 evidence_basis=m.get("evidence", {}), severity=m["severity"])
        if before != (e["match_status"], tuple(e["discrepancies"]), e["severity"]):
            changed_match.append((m["building_id"], before[0], e["match_status"], e["discrepancies"]))
        rq = qb.get(m["building_id"], [])
        e["review"] = {**(e.get("review") or {}), "queued": bool(rq), "priority": min((q["priority"] for q in rq), default=None),
                       "reasons": sorted({x for q in rq for x in q["reasons"]}), "status": "pending" if rq else None}
    exp["review_queue"] = queue
    exp["meta"]["counts"]["review_items"] = len(queue)
    exp["meta"]["run"]["buildings_use_sign"] = stats["filled"]
    assets = [{**a, "cls": a["type"]} for a in exp["assets"]]
    dash = build_dashboard(res, assets, {"60": exp["streetlight_gaps"]}, queue, exp["meta"]["run"])
    dash["kpi"]["unmapped_businesses"] = len(exp.get("unmapped_businesses") or [])
    exp["dashboard"] = dash
    report = {"area": exp["meta"]["area"], "use_unknown_before": stats["unknown_before"], "use_from_sign": stats["filled"],
              "use_unknown_after": sum(1 for b in exp["buildings"] if not b["attributes"]["use"].get("value")),
              "skipped": stats["skipped"], "names_changed": len(changed_name),
              "names_changed_by": dict(Counter(f"{o} -> {n}" for _, _, o, n in changed_name)),
              "match_changed": len(changed_match), "match_changes": dict(Counter(f"{o} -> {n}" for _, o, n, _ in changed_match)),
              "review_items": len(queue), "changed_use": changed_use, "changed_name": changed_name}
    if write:
        save(folder, "final_attributes", final2)
        save(folder, "export", exp)
        save(folder, "dashboard", dash)
        with open(os.path.join(folder, "export.geojson"), "w", encoding="utf-8") as f:
            json.dump(to_geojson(exp), f)
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("folders", nargs="+")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    for f in a.folders:
        r = recompute(f, a.write)
        print(json.dumps({k: v for k, v in r.items() if k not in ("changed_use", "changed_name")}, ensure_ascii=False))
        for bid, st, nmv in r["changed_use"]:
            print(f"  use: {bid}  {st}  «{nmv}»")
        for bid, nmv, o, n in r["changed_name"]:
            print(f"  name: {bid}  «{nmv}»  {o} -> {n}")
