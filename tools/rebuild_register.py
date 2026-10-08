r"""D64: give an analysed area a synthetic register made from ITS OWN buildings (register.observed_register, D42: each
record copies what was observed; planted mistakes), matched by location as always (D43), from the saved run files only
(no photo, no model call, no map call).

    backend\.venv\Scripts\python tools\rebuild_register.py data\areas\<slug> --planted 78 [--write]

--planted N: the method plants a mistake in each building with probability disc_rate (0.22), seeded by the area key. The
seed is the area's name; when that does not give exactly N planted mistakes, the first key "<name> #k" (k = 1, 2, ...)
that does is used, and the key is recorded (meta.run.register_rebuilt). Nothing else of the method changes.

Before writing, the area's CURRENT register is re-applied the same way and must reproduce the saved export exactly
(buildings' register fields, the review queue, the register numbers of the dashboard); otherwise nothing is written.
Only register-dependent fields change: buildings[].register / match_status / discrepancies / reasons / evidence_basis /
severity / review, review_queue, register_unmatched, dashboard kpi + charts that count them, meta.counts.review_items,
meta.run planted_error_scores + register_matching; files register_synthetic.json, planted_register_mistakes.json,
export.geojson, dashboard.json. The previous files go to data/cache/register_before/<slug>/.
"""
import argparse
import json
import os
import shutil
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.export import to_geojson  # noqa: E402
from geo_cascadia.match import review_queue  # noqa: E402
from geo_cascadia.register import hide_truth, match_by_location, observed_register, pairing_accuracy, recovery_scores  # noqa: E402


def rd(folder, n, default=None):
    p = os.path.join(folder, n)
    if not os.path.isfile(p):
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def apply(folder, exp, records, truth, cfg):
    """the export with these records compared (a new dict); the matching / queue / dashboard code of the pipeline"""
    buildings, final = rd(folder, "buildings.json"), rd(folder, "final_attributes.json")
    bpos = (rd(folder, "building_positions.json", {}) or {}).get("by_building") or {}
    names = rd(folder, "street_names.json", {}) or {}
    results, unmatched, pairs = match_by_location(buildings, final, hide_truth(records), bpos, cfg)
    for coll in (results, unmatched):
        for o in coll:
            o["street"] = names.get(o.get("street"), o.get("street"))
    E = {b["id"]: b for b in exp["buildings"]}
    assert [m["building_id"] for m in results] == [b["id"] for b in exp["buildings"]], "building order differs"
    for m in results:                                  # what review_queue reads besides the register (the export's own)
        m["street"] = E[m["building_id"]]["street"]
    assets_q = [q for q in exp["review_queue"] if q["item_type"] == "asset"]
    bq = [q for q in review_queue(results, []) if q["item_type"] == "building"]
    queue = sorted(bq + assets_q, key=lambda x: x["priority"])
    qb = {}
    for q in bq:
        qb.setdefault(q["building_id"], []).append(q)
    out = json.loads(json.dumps(exp))
    for b, m in zip(out["buildings"], results):
        rq = qb.get(b["id"], [])
        b["register"] = {"source": m.get("register_source") or "SYNTHETIC", "property_id": m.get("property_id"),
                         "record_use": m.get("record_use"), "record_floors": m.get("record_floors"),
                         "record_area_m2": m.get("record_area"), "record_dist_m": m.get("record_dist_m"),
                         "match_confidence": m.get("match_confidence"), "match_margin_m": m.get("match_margin_m")}
        b.update(match_status=m["match_status"], discrepancies=m["discrepancies"], reasons=m["reasons"],
                 evidence_basis=m.get("evidence", {}), severity=m["severity"])
        b["review"] = {"queued": bool(rq), "priority": min((q["priority"] for q in rq), default=None),
                       "reasons": sorted({x for q in rq for x in q["reasons"]}), "status": "pending" if rq else None,
                       "appeal_photo_path": None, "appeal_note": None}
    out["review_queue"] = queue
    out["register_unmatched"] = unmatched
    k, c = out["dashboard"]["kpi"], out["dashboard"]["charts"]
    k["unmatched_properties"] = sum(m["match_status"] == "no_record" for m in results)
    k["buildings_with_discrepancy"] = sum(m["match_status"] == "discrepancy" for m in results)
    k["low_confidence_observations"] = len(queue)
    c["match_status"] = dict(Counter(m["match_status"] for m in results))
    c["discrepancy_type"] = dict(Counter(d for m in results for d in m["discrepancies"]))
    for s, row in c["by_street"].items():
        row["no_record"] = sum(m["street"] == s and m["match_status"] == "no_record" for m in results)
        row["discrepancy"] = sum(m["street"] == s and m["match_status"] == "discrepancy" for m in results)
    out["meta"]["counts"]["review_items"] = len(queue)
    run = out["meta"]["run"]
    run["planted_error_scores"] = recovery_scores(results, truth)
    run["register_matching"] = {"pairing": pairing_accuracy(pairs, records, truth), "records": len(records),
                                "records_unmatched": len(unmatched)}
    out["dashboard"]["cost_panel"] = run
    return out


def same(a, b, keys):
    return all(json.dumps(a.get(k), sort_keys=True) == json.dumps(b.get(k), sort_keys=True) for k in keys)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--planted", type=int, required=True)
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    cfg, folder = Config(), os.path.abspath(a.folder)
    slug = os.path.basename(folder)
    exp = rd(folder, "export.json")
    # 1) the current register must reproduce the saved export
    cur = apply(folder, exp, rd(folder, "register_synthetic.json"), rd(folder, "planted_register_mistakes.json"), cfg)
    bkeys = ("register", "match_status", "discrepancies", "reasons", "evidence_basis", "severity", "review")
    bad = [b["id"] for b, o in zip(cur["buildings"], exp["buildings"]) if not same(b, o, bkeys)]
    ok = (not bad and same(cur, exp, ("review_queue", "register_unmatched"))
          and same(cur["dashboard"], exp["dashboard"], ("kpi", "charts"))
          and same(cur["meta"]["run"], exp["meta"]["run"], ("planted_error_scores", "register_matching")))
    if not ok:
        raise SystemExit(f"{slug}: the saved files do not reproduce the saved register results ({len(bad)} buildings, "
                         f"e.g. {bad[:3]}) — nothing written")
    print(f"{slug}: current register reproduced exactly")
    # 2) a register from this run's own buildings, same method, seeded by the area name (+ ' #k' until N planted)
    buildings, final = rd(folder, "buildings.json"), rd(folder, "final_attributes.json")
    bpos = (rd(folder, "building_positions.json", {}) or {}).get("by_building") or {}
    name = exp["meta"]["area"]
    for k in range(0, 1000):
        key = name if k == 0 else f"{name} #{k}"
        records, truth = observed_register(buildings, final, bpos, cfg, key)
        if len(truth) == a.planted:
            break
    else:
        raise SystemExit("no seed key within 1000 gives that many planted mistakes")
    new = apply(folder, exp, records, truth, cfg)
    new["meta"]["run"]["register_rebuilt"] = {"method": "observed_register (D42), matched by location (D43)",
                                              "seed_key": key, "keys_tried": k + 1, "planted": len(truth),
                                              "replaced": "the register kept from the previous run of the area"}
    new["dashboard"]["cost_panel"] = new["meta"]["run"]
    rep = {"seed_key": key, "planted": dict(Counter(t["kind"] for t in truth)), "records": len(records),
           "recovery": new["meta"]["run"]["planted_error_scores"], "pairing": new["meta"]["run"]["register_matching"],
           "not_in_register": new["dashboard"]["kpi"]["unmatched_properties"],
           "differ": new["dashboard"]["kpi"]["buildings_with_discrepancy"], "review_items": len(new["review_queue"])}
    print(json.dumps(rep, indent=1))
    if a.write:
        keep = os.path.join(ROOT, "data", "cache", "register_before", slug)
        os.makedirs(keep, exist_ok=True)
        for n in ("export.json", "export.geojson", "dashboard.json", "register_synthetic.json", "planted_register_mistakes.json"):
            if os.path.isfile(os.path.join(folder, n)):
                shutil.copy(os.path.join(folder, n), os.path.join(keep, n))
        for n, o in (("register_synthetic.json", records), ("planted_register_mistakes.json", truth),
                     ("export.json", new), ("dashboard.json", new["dashboard"]), ("export.geojson", to_geojson(new))):
            with open(os.path.join(folder, n), "w", encoding="utf-8") as f:
                json.dump(o, f)
        print("written; previous files in", keep)


if __name__ == "__main__":
    main()
