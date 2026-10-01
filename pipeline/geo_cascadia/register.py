"""Property register: a synthetic register that means something (D42) and location-based matching (D43).

D42 — before, the synthetic register invented a random use and guessed floors from the outline area, so most "differs"
flags were the photo disagreeing with made-up values (Ward 29: 46 of 50 use and 30 of 36 extra-floor flags were not
planted). Now each record COPIES what was observed (use, floors, position = the building's predicted position, area)
EXCEPT the planted mistakes: missing record, wrong use, wrong floors, pin in the wrong place, area too small. A use or
floor count that is "not known" is left empty in the record, so it is "not compared", never a fake difference. The
planted list is returned (and saved per area) so recovery can be scored: caught / missed / false alarms per kind.

D43 — records are paired with buildings by LOCATION, never by building id, so the same code works for a real municipal
register: every record's pin to the nearest building (its predicted front position or outline centre), one-to-one,
within register_limit_m, with a small penalty for a very different area or use. Outcomes: matched · pin in the wrong
place (matched, > match_m away) · building with no record · record with no building nearby. Each pair has a match
confidence (high / medium / low) from its distance and the margin to the next-best building.

Same code for every area and every live street; deterministic per area (the seed includes the area name).
"""
import math
import random

from .geo import haversine

COMMERCIAL = {"commercial", "mixed", "shop", "office", "restaurant", "clinic", "bank", "hotel", "business", "retail"}
RESIDENTIAL = {"residential", "house", "apartment", "vacant_plot", "home", "flat", "flats"}
KINDS = ("missing_record", "location_shift", "area_understated", "use_change", "extra_floor")
GEOMETRY = {"missing_record", "location_shift", "area_understated"}


def use_category(u):
    """commercial / residential / None (other, or not known): the level at which a register use is compared"""
    u = (u or "").strip().lower().replace(" ", "_")
    return "commercial" if u in COMMERCIAL else "residential" if u in RESIDENTIAL else None


def reference_point(b, positions):
    """where a building 'is' for the register: its predicted position (centre of the front, D33) or its outline centre"""
    p = (positions or {}).get(b["building_id"])
    return (p["lat"], p["lon"]) if p and p.get("lat") is not None else (b["lat"], b["lon"])


def observed_register(buildings, final, positions, cfg, area_key=""):
    """(records, planted). One record per building, copying the observations, with ~cfg.disc_rate planted mistakes.
    Records carry `building_id` ONLY as hidden truth for validation; match_by_location never reads it."""
    rng = random.Random(f"{cfg.synthetic_seed}:{area_key}")
    fin = {f["building_id"]: f for f in final}
    records, planted = [], []
    for i, b in enumerate(buildings, 1):
        f = fin.get(b["building_id"], {})
        use = f.get("use")
        floors = f.get("floors")
        lat, lon = reference_point(b, positions)
        rec = {"property_id": f"P-{i:04d}", "building_id": b["building_id"],
               "assessment_no": f"{rng.randint(1, 9)}/{rng.randint(100, 999)}", "owner_name": f"Owner {i:04d}",
               "street": b["street"], "use_type": use, "floors": floors, "plinth_area_m2": round(b["area_m2"], 1),
               "tax_status": rng.choice(["paid", "paid", "paid", "arrears"]),
               "last_survey_year": rng.choice([2016, 2018, 2019, 2021]), "record_lat": round(lat, 7), "record_lon": round(lon, 7),
               "source": "SYNTHETIC"}
        if rng.random() < cfg.disc_rate:
            kinds = ["missing_record", "location_shift", "area_understated"]
            if use_category(use):
                kinds.append("use_change")
            if floors is not None and floors >= 2 and f.get("floors_status") == "measured":
                kinds.append("extra_floor")
            k = rng.choice(kinds)
            detail = {}
            if k == "extra_floor":
                rec["floors"] = floors - 1
                detail = {"observed": floors, "recorded": rec["floors"]}
            elif k == "use_change":
                rec["use_type"] = "residential" if use_category(use) == "commercial" else "commercial"
                detail = {"observed": use, "recorded": rec["use_type"]}
            elif k == "area_understated":
                rec["plinth_area_m2"] = round(b["area_m2"] * rng.uniform(0.55, 0.7), 1)
                detail = {"observed_m2": b["area_m2"], "recorded_m2": rec["plinth_area_m2"]}
            elif k == "location_shift":
                # moved 15–40 m from the front position, in a direction that also leaves it > match_m from the outline
                # centre (otherwise it is not "in the wrong place" under the comparison rule); up to 12 tries
                d = rng.uniform(15, 40)
                for _ in range(12):
                    br = math.radians(rng.uniform(0, 360))
                    nla = round(lat + d * math.cos(br) / 110574, 7)
                    nlo = round(lon + d * math.sin(br) / (111320 * math.cos(math.radians(lat))), 7)
                    if haversine(nla, nlo, b["lat"], b["lon"]) > cfg.match_m + 1:
                        break
                rec["record_lat"], rec["record_lon"] = nla, nlo
                detail = {"shift_m": round(d, 1)}
            planted.append({"property_id": rec["property_id"], "building_id": b["building_id"], "kind": k, **detail})
            if k == "missing_record":
                continue
        records.append(rec)
    return records, planted


def _pairs(buildings, records, positions, final, cfg):
    fin = {f["building_id"]: f for f in final}
    pts = [(b, reference_point(b, positions)) for b in buildings]
    out = []
    for ri, r in enumerate(records):
        if r.get("record_lat") is None or r.get("record_lon") is None:
            continue
        rc = use_category(r.get("use_type"))
        for bi, (b, (la, lo)) in enumerate(pts):
            if abs(la - r["record_lat"]) > 0.0006 or abs(lo - r["record_lon"]) > 0.0006:   # ~65 m: cheap pre-filter
                continue
            d = min(haversine(la, lo, r["record_lat"], r["record_lon"]), haversine(b["lat"], b["lon"], r["record_lat"], r["record_lon"]))
            if d > cfg.register_limit_m:
                continue
            cost = d
            if r.get("plinth_area_m2") and b.get("area_m2"):
                cost += cfg.register_area_weight_m * abs(math.log(r["plinth_area_m2"] / b["area_m2"]))
            oc = use_category(fin.get(b["building_id"], {}).get("use"))
            if rc and oc and rc != oc:
                cost += cfg.register_use_weight_m
            out.append((cost, d, ri, bi))
    return out


def match_by_location(buildings, final, records, positions, cfg):
    """(results, unmatched_records, pairs). `results` has one row per building in the shape match.match_properties
    returns (so the review queue, export, dashboard and QueryEngine are unchanged), plus match_confidence and
    match_margin_m. Records are paired one-to-one, lowest cost first; the building id in a record is never used."""
    fin = {f["building_id"]: f for f in final}
    cands = sorted(_pairs(buildings, records, positions, final, cfg))
    by_record = {}
    for c in cands:
        by_record.setdefault(c[2], []).append(c)
    used_r, used_b, pair = set(), set(), {}
    for cost, d, ri, bi in cands:
        if ri in used_r or bi in used_b:
            continue
        used_r.add(ri); used_b.add(bi)
        others = [c[0] for c in by_record[ri] if c[3] != bi]
        margin = round(min(others) - cost, 1) if others else None
        conf = ("high" if d <= 5 and (margin is None or margin >= 5) else
                "medium" if d <= cfg.match_m and (margin is None or margin >= 2) else "low")
        pair[bi] = (ri, round(d, 1), conf, margin)
    results = []
    for bi, b in enumerate(buildings):
        f = fin.get(b["building_id"], {})
        o = {"building_id": b["building_id"], "lat": b["lat"], "lon": b["lon"], "street": b["street"],
             "area_m2": b["area_m2"], "frontage_m": b["frontage_m"], "n_views": b["n_views"],
             "obs_use": f.get("use"), "use_route": f.get("use_route"), "property_ids": f.get("property_ids", []),
             "obs_floors": f.get("floors"), "floors_status": f.get("floors_status", "not_measured"),
             "condition": f.get("condition"), "shop_units": f.get("shop_units"), "name": f.get("name"),
             "name_src": f.get("name_src"), "name_review": f.get("name_review", False)}
        if bi not in pair:
            results.append({**o, "match_status": "no_record", "property_id": None, "discrepancies": ["missing_record"],
                            "reasons": ["building has no record"], "evidence": {"missing_record": "geometry"}, "severity": "high",
                            "match_confidence": None, "match_margin_m": None})
            continue
        ri, dist, conf, margin = pair[bi]
        r = records[ri]
        d, why, ev = [], [], {}
        if dist > cfg.match_m:
            d.append("location_shift"); why.append(f"record pin {dist:.0f} m from the building"); ev["location_shift"] = "geometry"
        if r.get("plinth_area_m2") is not None and r["plinth_area_m2"] < b["area_m2"] * (1 - cfg.area_tol):
            d.append("area_understated"); why.append(f"record {r['plinth_area_m2']:.0f} m2 vs footprint {b['area_m2']:.0f} m2")
            ev["area_understated"] = "geometry"
        rc, oc = use_category(r.get("use_type")), use_category(o["obs_use"])
        if rc and oc and rc != oc:
            d.append("use_change"); why.append(f"record says {r['use_type']}, imagery shows {o['obs_use']}"); ev["use_change"] = "vlm_use"
        if o["floors_status"] == "measured" and o["obs_floors"] is not None and r.get("floors") is not None and o["obs_floors"] > r["floors"]:
            d.append("extra_floor"); why.append(f"record {r['floors']} floor(s), imagery shows {o['obs_floors']}"); ev["extra_floor"] = "vlm_floors"
        geo = [x for x in d if ev[x] == "geometry"]
        sev = "high" if len(geo) >= 2 or (geo and len(d) >= 2) else ("medium" if d else "none")
        results.append({**o, "match_status": "discrepancy" if d else "matched", "property_id": r["property_id"],
                        "record_use": r.get("use_type"), "record_floors": r.get("floors"), "record_area": r.get("plinth_area_m2"),
                        "record_dist_m": dist, "discrepancies": d, "reasons": why, "evidence": ev, "severity": sev,
                        "match_confidence": conf, "match_margin_m": margin, "register_source": r.get("source", "SYNTHETIC")})
    unmatched = [{"property_id": r["property_id"], "lat": r["record_lat"], "lon": r["record_lon"], "street": r.get("street"),
                  "why": f"no building without a record within {cfg.register_limit_m:.0f} m"}
                 for ri, r in enumerate(records) if ri not in used_r and r.get("record_lat") is not None]
    pairs = {records[ri]["property_id"]: buildings[bi]["building_id"] for bi, (ri, *_) in pair.items()}
    return results, unmatched, pairs


def recovery_scores(results, planted):
    """per planted kind: planted, caught, missed, false alarms (a building flagged with that kind that was not planted
    with it). Tests the comparison logic end to end on made-up data; not a real-world accuracy."""
    flagged = {k: set() for k in KINDS}
    for m in results:
        for k in m.get("discrepancies") or []:
            if k in flagged:
                flagged[k].add(m["building_id"])
    out = {}
    for k in KINDS:
        p = {x["building_id"] for x in planted if x["kind"] == k}
        out[k] = {"planted": len(p), "caught": len(p & flagged[k]), "missed": len(p - flagged[k]), "false_alarms": len(flagged[k] - p)}
    return out


def pairing_accuracy(pairs, records, planted):
    """How often a record was paired with ITS building (the hidden truth), overall and for records whose pin was moved."""
    truth = {r["property_id"]: r["building_id"] for r in records}
    shifted = {x["property_id"] for x in planted if x["kind"] == "location_shift"}

    def score(ids):
        ids = list(ids)
        right = sum(1 for i in ids if pairs.get(i) == truth[i])
        unpaired = sum(1 for i in ids if i not in pairs)
        return {"records": len(ids), "paired_right": right, "paired_wrong": len(ids) - right - unpaired, "unpaired": unpaired,
                "right_pct": round(100 * right / len(ids), 1) if ids else None}
    return {"all": score(truth), "pin_moved": score(i for i in truth if i in shifted),
            "pin_not_moved": score(i for i in truth if i not in shifted)}


def hide_truth(records):
    """records as the matcher may see them (no building id)"""
    return [{k: v for k, v in r.items() if k != "building_id"} for r in records]
