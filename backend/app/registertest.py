"""Register tests per area, computed from the records and the run's own files (D42, D43) — never typed.

- Planted-mistake recovery: for every planted mistake kind, how many the comparison caught, missed, and how many
  buildings were flagged with that kind although nothing was planted (false alarms). Source: planted_register_mistakes.json
  (what the generator planted) vs the exported buildings' match_status / discrepancies.
- Pairing by location: how many register records were paired with THEIR building. Source: register_synthetic.json (the
  records with the hidden building id) vs the exported buildings' register.property_id.
This tests the comparison logic end to end on made-up data; real accuracy needs a real register.
"""
import json
import os

KINDS = ("missing_record", "location_shift", "area_understated", "use_change", "extra_floor")


def _read(folder, name):
    p = os.path.join(folder, f"{name}.json")
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def area_tests(bundle, areas_dir):
    folder = os.path.join(areas_dir, bundle["slug"])
    planted, register = _read(folder, "planted_register_mistakes"), _read(folder, "register_synthetic")
    B = bundle["buildings"]
    out = {"area": bundle["slug"], "name": bundle["name"], "buildings": len(B),
           "register_source": ((B[0].get("register") or {}).get("source") if B else None)}
    if planted is None or register is None:
        return {**out, "available": False}
    flagged = {k: set() for k in KINDS}
    for b in B:
        for k in b.get("discrepancies") or []:
            if k in flagged:
                flagged[k].add(b["id"])
    rec = {}
    for k in KINDS:
        p = {x["building_id"] for x in planted if x["kind"] == k}
        rec[k] = {"planted": len(p), "caught": len(p & flagged[k]), "missed": len(p - flagged[k]),
                  "false_alarms": len(flagged[k] - p)}
    paired = {(b.get("register") or {}).get("property_id"): b["id"] for b in B if (b.get("register") or {}).get("property_id")}
    moved = {x["property_id"] for x in planted if x["kind"] == "location_shift"}

    def score(recs):
        right = sum(1 for r in recs if paired.get(r["property_id"]) == r["building_id"])
        unpaired = sum(1 for r in recs if r["property_id"] not in paired)
        return {"records": len(recs), "paired_right": right, "paired_wrong": len(recs) - right - unpaired, "unpaired": unpaired,
                "right_pct": round(100 * right / len(recs), 1) if recs else None}
    conf = {}
    for b in B:
        c = (b.get("register") or {}).get("match_confidence")
        if c:
            conf[c] = conf.get(c, 0) + 1
    return {**out, "available": True, "recovery": rec, "planted_total": len(planted),
            "pairing": {"all": score(register), "pin_moved": score([r for r in register if r["property_id"] in moved]),
                        "pin_not_moved": score([r for r in register if r["property_id"] not in moved])},
            "records": len(register),
            "records_unmatched": ((bundle["meta"].get("run") or {}).get("register_matching") or {}).get("records_unmatched"),
            "match_confidence": conf}


def all_tests(bundles, areas_dir):
    rows = [area_tests(b, areas_dir) for b in bundles]
    tot = {k: {"planted": 0, "caught": 0, "missed": 0, "false_alarms": 0} for k in KINDS}
    pair = {"records": 0, "paired_right": 0, "moved": 0, "moved_right": 0}
    for r in rows:
        if not r.get("available"):
            continue
        for k in KINDS:
            for f in tot[k]:
                tot[k][f] += r["recovery"][k][f]
        pair["records"] += r["pairing"]["all"]["records"]
        pair["paired_right"] += r["pairing"]["all"]["paired_right"]
        pair["moved"] += r["pairing"]["pin_moved"]["records"]
        pair["moved_right"] += r["pairing"]["pin_moved"]["paired_right"]
    pct = lambda a, b: round(100 * a / b, 1) if b else None
    return {"areas": rows, "total": {"recovery": tot, "pairing": {**pair, "right_pct": pct(pair["paired_right"], pair["records"]),
                                                                  "moved_right_pct": pct(pair["moved_right"], pair["moved"])}},
            "note": "This tests the comparison logic end to end on made-up data; real accuracy needs a real register."}
