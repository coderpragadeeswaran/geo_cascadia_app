"""Registers + matching + review queue + streetlight gaps (cell 20 synthetic register, M1, M2).
Registers are SYNTHETIC (no open municipal data); pass real ones to match_properties/match_assets to replace them."""
import math, random
from collections import Counter, defaultdict
import numpy as np
from .geo import haversine

REC_COMM = {"shop", "office", "restaurant", "clinic", "bank"}
REC_RES = {"house", "apartment", "vacant_plot"}


def synthetic_property_register(buildings, street_kind, cfg):
    rng = random.Random(cfg.synthetic_seed)
    USE = {"commercial": ["shop", "office", "restaurant", "clinic", "bank"],
           "residential": ["house", "apartment", "house", "house", "vacant_plot"]}
    floors_from_area = lambda a: 1 if a < 80 else (2 if a < 200 else rng.choice([2, 3, 3, 4]))
    register, truth = [], []
    for i, b in enumerate(buildings, 1):
        kind = street_kind.get(b["street"], "residential")
        rec = {"property_id": f"P-{i:04d}", "building_id": b["building_id"],
               "assessment_no": f"{rng.randint(1, 9)}/{rng.randint(100, 999)}", "owner_name": f"Owner {i:04d}",
               "street": b["street"], "use_type": rng.choice(USE[kind]), "floors": floors_from_area(b["area_m2"]),
               "plinth_area_m2": round(b["area_m2"] * rng.uniform(0.92, 1.05), 1),
               "tax_status": rng.choice(["paid", "paid", "paid", "arrears"]),
               "last_survey_year": rng.choice([2016, 2018, 2019, 2021]), "record_lat": b["lat"], "record_lon": b["lon"]}
        if rng.random() < cfg.disc_rate:
            k = rng.choice(["extra_floor", "use_change", "area_understated", "location_shift", "missing_record"])
            if k == "extra_floor": rec["floors"] = max(1, rec["floors"] - 1)
            elif k == "use_change": rec["use_type"] = "house" if kind == "commercial" else "shop"
            elif k == "area_understated": rec["plinth_area_m2"] = round(rec["plinth_area_m2"] * rng.uniform(0.55, 0.7), 1)
            elif k == "location_shift":
                d, br = rng.uniform(15, 40), math.radians(rng.uniform(0, 360))
                rec["record_lat"] = round(b["lat"] + d * math.cos(br) / 110574, 7)
                rec["record_lon"] = round(b["lon"] + d * math.sin(br) / (111320 * math.cos(math.radians(b["lat"]))), 7)
            truth.append({"property_id": rec["property_id"], "building_id": b["building_id"], "discrepancy": k})
            if k == "missing_record": continue
        register.append(rec)
    return register, truth


def match_properties(buildings, final, register, cfg):
    fin = {f["building_id"]: f for f in final}
    reg = {r["building_id"]: r for r in register}
    out = []
    for b in buildings:
        f = fin.get(b["building_id"], {}); r = reg.get(b["building_id"])
        o = {"building_id": b["building_id"], "lat": b["lat"], "lon": b["lon"], "street": b["street"],
             "area_m2": b["area_m2"], "frontage_m": b["frontage_m"], "n_views": b["n_views"],
             "obs_use": f.get("use"), "use_route": f.get("use_route"), "property_ids": f.get("property_ids", []),
             "obs_floors": f.get("floors"), "floors_status": f.get("floors_status", "not_measured"),
             "condition": f.get("condition"), "shop_units": f.get("shop_units"), "name": f.get("name"),
             "name_src": f.get("name_src"), "name_review": f.get("name_review", False)}
        if r is None:
            out.append({**o, "match_status": "no_record", "property_id": None, "discrepancies": ["missing_record"],
                        "reasons": ["building has no record"], "evidence": {"missing_record": "geometry"}, "severity": "high"}); continue
        d, why, ev = [], [], {}
        dist = haversine(b["lat"], b["lon"], r["record_lat"], r["record_lon"])
        if dist > cfg.match_m: d.append("location_shift"); why.append(f"record pin {dist:.0f} m from the building"); ev["location_shift"] = "geometry"
        if r["plinth_area_m2"] < b["area_m2"] * (1 - cfg.area_tol):
            d.append("area_understated"); why.append(f"record {r['plinth_area_m2']:.0f} m2 vs footprint {b['area_m2']:.0f} m2"); ev["area_understated"] = "geometry"
        u = o["obs_use"]
        if (u in ("commercial", "mixed") and r["use_type"] in REC_RES) or (u == "residential" and r["use_type"] in REC_COMM):
            d.append("use_change"); why.append(f"record says {r['use_type']}, imagery shows {u}"); ev["use_change"] = "vlm_use"
        if o["floors_status"] == "measured" and o["obs_floors"] is not None and o["obs_floors"] > r["floors"]:
            d.append("extra_floor"); why.append(f"record {r['floors']} floor(s), imagery shows {o['obs_floors']}"); ev["extra_floor"] = "vlm_floors"
        geo = [x for x in d if ev[x] == "geometry"]
        sev = "high" if len(geo) >= 2 or (geo and len(d) >= 2) else ("medium" if d else "none")
        out.append({**o, "match_status": "discrepancy" if d else "matched", "property_id": r["property_id"],
                    "record_use": r["use_type"], "record_floors": r["floors"], "record_area": r["plinth_area_m2"],
                    "record_dist_m": round(dist, 1), "discrepancies": d, "reasons": why, "evidence": ev, "severity": sev})
    return out


def score_planted(results, truth):
    s = {}
    for kind in ("location_shift", "area_understated", "missing_record"):
        gt = {t["building_id"] for t in truth if t["discrepancy"] == kind}
        pr = {r["building_id"] for r in results if kind in r["discrepancies"]}
        tp = len(gt & pr); s[kind] = {"planted": len(gt), "tp": tp, "fp": len(pr - gt), "fn": len(gt - pr)}
    return s


def asset_layer(assets, plan, area, cfg):
    """Synthetic asset register + matching (M2A) and streetlight gaps (M2B)."""
    A = [dict(a) for a in assets if a.get("lat")]
    for a in A:
        a["street"] = Counter(a.get("streets") or ["?"]).most_common(1)[0][0]
        a["x"], a["y"] = area.L(a["lat"], a["lon"])
        a["confirmed"] = a.get("n_detections", 1) >= 2 or a.get("cameras_used", 0) >= 2
    rng = random.Random(7)
    register, truth = [], []
    for i, a in enumerate([a for a in A if a["confirmed"]], 1):
        rec = {"asset_no": f"EB-{i:04d}", "type": a["cls"], "lat": a["lat"], "lon": a["lon"], "street": a["street"]}
        roll = rng.random()
        if roll < 0.12: truth.append({"kind": "unrecorded_asset", "pos": (a["lat"], a["lon"])}); continue
        elif roll < 0.27:
            d, b = rng.uniform(12, 25), math.radians(rng.uniform(0, 360))
            rec["lat"], rec["lon"] = area.frame.ll(a["x"] + d * math.sin(b), a["y"] + d * math.cos(b))
            truth.append({"kind": "location_shift", "asset_no": rec["asset_no"]})
        elif roll < 0.37:
            rec["type"] = "streetlight" if a["cls"] == "pole" else "pole"
            truth.append({"kind": "type_mismatch", "asset_no": rec["asset_no"]})
        register.append(rec)
    cams = [area.L(e["camera_lat"], e["camera_lon"]) + (e["street"],) for e in plan]; rng.shuffle(cams); g = 0
    for cx, cy, st in cams:
        if g >= max(1, len(register) // 10) or not A: break
        b = math.radians(rng.uniform(0, 360)); gx, gy = cx + 5 * math.sin(b), cy + 5 * math.cos(b)
        if min(math.dist((gx, gy), (a["x"], a["y"])) for a in A) < 15: continue
        g += 1; la, lo = area.frame.ll(gx, gy)
        register.append({"asset_no": f"EB-G{g:02d}", "type": "pole", "lat": la, "lon": lo, "street": st})
        truth.append({"kind": "missing_asset", "asset_no": f"EB-G{g:02d}"})
    for r in register: r["x"], r["y"] = area.L(r["lat"], r["lon"])
    pairs = sorted((math.dist((r["x"], r["y"]), (a["x"], a["y"])), ri, ai) for ri, r in enumerate(register)
                   for ai, a in enumerate(A) if math.dist((r["x"], r["y"]), (a["x"], a["y"])) <= cfg.asset_shift_m)
    used_r, used_a, match = set(), set(), {}
    for lim in (cfg.asset_match_m, cfg.asset_shift_m):
        for d, ri, ai in pairs:
            if d > lim or ri in used_r or ai in used_a: continue
            if lim == cfg.asset_shift_m and not A[ai]["confirmed"]: continue
            used_r.add(ri); used_a.add(ai); match[ri] = (ai, d)
    status = {}
    missing = []
    for ri, r in enumerate(register):
        if ri not in match:
            missing.append({"asset_no": r["asset_no"], "lat": r["lat"], "lon": r["lon"], "street": r["street"],
                            "why": "record exists, nothing detected within 25 m"}); continue
        ai, d = match[ri]; flags = []
        if d > cfg.asset_match_m: flags.append("location_shift")
        if r["type"] != A[ai]["cls"]: flags.append("type_mismatch")
        status[ai] = {"status": "discrepancy" if flags else "matched", "asset_no": r["asset_no"], "flags": flags,
                      "record_type": r["type"], "dist_m": round(d, 1)}
    for ai, a in enumerate(A):
        if ai not in status: status[ai] = {"status": "unrecorded_asset" if a["confirmed"] else "unconfirmed_detection", "flags": []}
    for ai, a in enumerate(A): a["register"] = status[ai]

    lights = [a for a in A if a["cls"] == "streetlight"]; poles = [a for a in A if a["cls"] == "pole"]
    groups = defaultdict(list)
    for e in plan: groups[(e["street"], e.get("carriageway", 0))].append(area.L(e["camera_lat"], e["camera_lon"]))
    gaps = {}
    for iv in (40, 60, 100):
        res = []
        for (st, cw), pts in groups.items():
            if len(pts) < 3: continue
            P = np.array(pts); c = P.mean(0); u = np.linalg.svd(P - c)[2][0]
            t = (P - c) @ u; o = np.argsort(t); P, t = P[o], t[o]
            lit = np.array([min((math.dist(p, (l["x"], l["y"])) for l in lights), default=1e9) <= iv / 2 for p in P])
            i = 0
            while i < len(P):
                if lit[i]: i += 1; continue
                j = i
                while j + 1 < len(P) and not lit[j + 1]: j += 1
                length = float(t[j] - t[i]) + 12.0
                if length >= iv:
                    seg = P[i:j + 1]
                    npole = sum(1 for p in poles if min(math.dist((p["x"], p["y"]), tuple(q)) for q in seg) <= 15)
                    res.append({"street": st, "carriageway": cw, "length_m": round(length), "start": list(area.frame.ll(*seg[0])),
                                "end": list(area.frame.ll(*seg[-1])), "poles_inside": npole,
                                "gap_type": "poles present, no lamp detected" if npole else "no pole or lamp detected"})
                i = j + 1
        gaps[str(iv)] = res
    score = {}
    for k in ("location_shift", "type_mismatch"):
        gt = {t["asset_no"] for t in truth if t["kind"] == k}
        pr = {s["asset_no"] for s in status.values() if k in s.get("flags", [])}
        score[k] = {"planted": len(gt), "tp": len(gt & pr), "fp": len(pr - gt)}
    gt = {t["asset_no"] for t in truth if t["kind"] == "missing_asset"}; pr = {m["asset_no"] for m in missing}
    score["missing_asset"] = {"planted": len(gt), "tp": len(gt & pr), "fp": len(pr - gt)}
    for a in A: a.pop("x"); a.pop("y")
    return A, missing, gaps, score


def review_queue(results, assets):
    PRI = {"high-severity discrepancy": 1, "attribute discrepancy — verify on imagery": 2,
           "name read by VLM only (not supported by OCR)": 3, "floor count low confidence (roofline not visible)": 4,
           "building seen from one view only": 5, "single-detection asset": 6}
    q = []
    for r in results:
        reasons = []
        if r["severity"] == "high": reasons.append("high-severity discrepancy")
        if {"use_change", "extra_floor"} & set(r["discrepancies"]): reasons.append("attribute discrepancy — verify on imagery")
        if r["name_review"]: reasons.append("name read by VLM only (not supported by OCR)")
        if r["floors_status"] == "low_confidence": reasons.append("floor count low confidence (roofline not visible)")
        if r["n_views"] <= 1 and r["discrepancies"]: reasons.append("building seen from one view only")
        if reasons:
            q.append({"item_type": "building", "building_id": r["building_id"], "street": r["street"], "lat": r["lat"],
                      "lon": r["lon"], "reasons": reasons, "priority": min(PRI[x] for x in reasons),
                      "discrepancies": r["discrepancies"], "status": "pending", "appeal_photo_path": None, "appeal_note": None})
    for a in assets:
        if a.get("lat") and a.get("confidence") == "low":
            q.append({"item_type": "asset", "asset_cls": a["cls"], "lat": a["lat"], "lon": a["lon"], "street": a.get("street"),
                      "reasons": ["single-detection asset"], "priority": 6, "status": "pending",
                      "appeal_photo_path": None, "appeal_note": None})
    return sorted(q, key=lambda x: x["priority"])
