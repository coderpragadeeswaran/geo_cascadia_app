"""Unified export (M4): one record per building / asset / gap with attributes, route, confidence, cost,
Street View evidence, register match and review status. Plus a GeoJSON for the map."""
import os, json, datetime
from collections import defaultdict
from .geo import bearing_between
from .poleunc import camera_distance, uncertainty_for

NAME_ROUTE = {"ocr": "tier2_ocr", "vlm_verified_by_ocr": "tier3_vlm+ocr_gate", "vlm_unverified": "tier3_vlm_unverified"}


def _crop_view(f):
    pano, head, pitch, _ = os.path.basename(f)[:-4].rsplit("_", 3)
    return {"pano_id": pano, "heading": float(head), "pitch": float(pitch), "fov": 90}


def single_camera_basis(dist_m, cfg):
    """D45: plain basis of a single-camera asset's uncertainty (the band of config.single_cam_unc_bands it falls in)"""
    u = uncertainty_for(dist_m, cfg)
    where = f"one camera, {dist_m:.0f} m away" if dist_m is not None else "one camera, distance unknown"
    if dist_m is not None and dist_m <= cfg.single_cam_unc_bands[0][0]:
        return (f"single-camera estimate ({where}): 8 in 10 single-camera estimates of two-camera poles at this distance "
                f"were within {u:g} m of the two-camera point (a consistency check, not surveyed truth)")
    return (f"single-camera estimate ({where}): an earlier surveyed check found a typical (median) error of 4.55 m for "
            f"poles 8–15 m from the camera, so the circle is ±{u:g} m; about half of such estimates fall inside it")


PREDICTED_KEYS = ("lat", "lon", "method", "n_cameras", "uncertainty_m", "reason")


def build_export(area_name, cfg, buildings, results, views, vlm_bld, ocr_res, assets, missing, gaps, queue,
                 dashboard, panos, run_stats, positions=None):
    B = {b["building_id"]: b for b in buildings}
    V = {v["fp"]: v for v in views}
    VB = {r["fp"]: r for r in vlm_bld}
    P = {p["pano_id"]: p for p in panos}
    sign_ev = {}
    for r in ocr_res:
        if r.get("fp") and r.get("tier") in (2, 3):
            cur = sign_ev.get(r["fp"])
            if cur is None or (r["tier"], -r.get("best_conf", 0)) < (cur["tier"], -cur.get("best_conf", 0)): sign_ev[r["fp"]] = r
    qb, qa = defaultdict(list), {}
    for q in queue:
        if q["item_type"] == "building": qb[q["building_id"]].append(q)
        else: qa[(round(q["lat"], 7), round(q["lon"], 7))] = q
    price = lambda i, o: (i or 0) / 1e6 * cfg.vlm_in_per_m + (o or 0) / 1e6 * cfg.vlm_out_per_m
    blds = []
    for m in results:
        bid = m["building_id"]; b = B.get(bid, {}); v = V.get(bid); vb = VB.get(bid, {}); se = sign_ev.get(bid); rq = qb.get(bid, [])
        vcalls = (1 if vb.get("in") else 0) + (1 if vb.get("floors_a") is not None else 0)
        # P6: runs that record the floors call's tokens get an exact cost (use call + floors call); older runs keep the
        # old approximation (use-call price x calls), which the app shows as "cost not recorded" when it is 0
        exact = "floors_in" in vb
        vusd = (price(vb.get("in"), vb.get("out")) + price(vb.get("floors_in"), vb.get("floors_out")) if exact else
                price(vb.get("in"), vb.get("out")) * max(vcalls, 1) if vcalls else 0)
        blds.append({
            "id": bid, "type": "building", "lat": m["lat"], "lon": m["lon"], "street": m["street"],
            "footprint": {"source": "OSM", "osm_id": bid, "area_m2": m["area_m2"], "frontage_m": m["frontage_m"],
                          "depth_m": b.get("depth_m"), "polygon_latlon": b.get("footprint_latlon")},
            "attributes": {
                "use": {"value": m["obs_use"], "route": m.get("use_route") or ("tier3_vlm" if m["obs_use"] else None),
                        "validated": cfg.validation.get("use_sign", "not measured") if m.get("use_route") == "sign_text"
                                     else cfg.validation["use"]},
                "property_identifiers": m.get("property_ids", []),
                "floors": {"value": m["obs_floors"], "status": m["floors_status"],
                           "route": "tier3_vlm_fewshot" if m["obs_floors"] is not None else None, "validated": cfg.validation["floors"]},
                "name": {"value": m.get("name"), "quality": m.get("name_quality"), "route": NAME_ROUTE.get(m.get("name_src")),
                         "google_confirmed": m.get("name_verified_google"), "google_name": m.get("google_name"),
                         "google_place_id": m.get("google_place_id")},
                "shop_units": m.get("shop_units"),
                "condition": {"value": m.get("condition"), "withheld": True, "why": cfg.validation["condition"]}},
            "register": {"source": m.get("register_source") or "SYNTHETIC", "property_id": m.get("property_id"),
                         "record_use": m.get("record_use"), "record_floors": m.get("record_floors"),
                         "record_area_m2": m.get("record_area"), "record_dist_m": m.get("record_dist_m"),
                         # D43: paired by location (never by id): how sure the pairing is, and the gap to the next building
                         "match_confidence": m.get("match_confidence"), "match_margin_m": m.get("match_margin_m")},
            "match_status": m["match_status"], "discrepancies": m["discrepancies"], "reasons": m["reasons"],
            "evidence_basis": m.get("evidence", {}), "severity": m["severity"], "google_flags": m.get("ref_flags", []),
            "review": {"queued": bool(rq), "priority": min((q["priority"] for q in rq), default=None),
                       "reasons": sorted({x for q in rq for x in q["reasons"]}), "status": "pending" if rq else None,
                       "appeal_photo_path": None, "appeal_note": None},
            "evidence": {"views": [{k: w.get(k) for k in ("pano_id", "heading", "pitch", "dist_m", "side")} for w in b.get("views", [])][:6],
                         "attribute_view": ({k: v[k] for k in ("pano_id", "heading", "pitch", "fov", "x1", "y1", "x2", "y2")} if v and vb else None),
                         "sign_view": ({**_crop_view(se["file"]), "ocr_text": se.get("best"), "ocr_conf": se.get("best_conf"),
                                        "tier": se["tier"]} if se else None)},
            # D27/D33: predicted position (triangulated / wall_hit / wall_centre / footprint_centre); lat/lon stay the centroid
            **({"predicted_position": {k: positions[bid][k] for k in PREDICTED_KEYS} if bid in positions else None}
               if positions is not None else {}),
            "cost": {"vlm_calls": vcalls, "vlm_usd": round(vusd, 6), **({"recorded": True} if exact else {})}})
    ast = []
    for i, a in enumerate(assets):
        ev = [{"pano_id": pid, "heading": round(bearing_between(P[pid]["camera_lat"], P[pid]["camera_lon"], a["lat"], a["lon"]), 1),
               "pitch": 0, "fov": 60, "source": P[pid].get("source")} for pid in a.get("pano_ids", [])[:4] if pid in P]
        unc = a.get("max_residual_m")
        pos = (round(a["lat"], 7), round(a["lon"], 7))
        cam_d = camera_distance(a, P)                     # D45: single-camera uncertainty grows with camera distance
        ast.append({"id": f"asset-{i:04d}", "type": a["cls"], "lat": a["lat"], "lon": a["lon"], "street": a.get("street"),
                    "confidence": a.get("confidence"), "n_detections": a.get("n_detections"), "cameras_used": a.get("cameras_used"),
                    "method": a.get("method"),
                    "uncertainty_m": round(max(unc, 0.5), 2) if unc is not None else uncertainty_for(cam_d, cfg),
                    "uncertainty_basis": "triangulation residual (2+ cameras)" if unc is not None else single_camera_basis(cam_d, cfg),
                    "camera_distance_m": cam_d,
                    "route": "tier1_yolo + geometry", "register": {"source": "SYNTHETIC", **a.get("register", {})},
                    "review": {"queued": pos in qa, "priority": qa[pos]["priority"] if pos in qa else None,
                               "reasons": qa[pos]["reasons"] if pos in qa else [], "status": "pending" if pos in qa else None},
                    "evidence": {"views": ev}})
    g60 = [{"id": f"gap60-{k:03d}", "type": "streetlight_gap", "interval_m": 60, **g} for k, g in enumerate(gaps.get("60", []))]
    meta = {"area": area_name, "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "pipeline": {"detector": f"YOLOv8s {os.path.basename(os.path.dirname(os.path.dirname(cfg.yolo_weights)))}",
                         "ocr": f"PaddleOCR en+ta ({run_stats.get('ocr_mode')})", "vlm": cfg.vlm_model,
                         "name_gate": cfg.name_gate, "footprints": "OSM", "reference": "Google Places (New)"},
            "registers": "SYNTHETIC property + asset registers with planted errors (no open municipal data)",
            "counts": {"buildings": len(blds), "assets": len(ast), "missing_asset_records": len(missing),
                       "streetlight_gaps_60m": len(g60), "review_items": len(queue)}, "run": run_stats}
    return {"meta": meta, "dashboard": dashboard, "buildings": blds, "assets": ast, "missing_asset_records": missing,
            "streetlight_gaps": g60, "review_queue": queue}


def to_geojson(export):
    f = lambda g, p: {"type": "Feature", "geometry": g, "properties": p}
    pt = lambda o: {"type": "Point", "coordinates": [o["lon"], o["lat"]]}
    feats = [f(pt(b), {"id": b["id"], "kind": "building", "street": b["street"], "use": b["attributes"]["use"]["value"],
                       "floors": b["attributes"]["floors"]["value"], "match_status": b["match_status"], "severity": b["severity"],
                       "review": b["review"]["queued"],
                       "name": b["attributes"]["name"]["value"] if b["attributes"]["name"]["quality"] == "good" else None})
             for b in export["buildings"]]
    feats += [f(pt(a), {"id": a["id"], "kind": a["type"], "confidence": a["confidence"], "street": a["street"],
                        "uncertainty_m": a["uncertainty_m"], "register_status": a["register"].get("status")}) for a in export["assets"]]
    feats += [f({"type": "LineString", "coordinates": [[g["start"][1], g["start"][0]], [g["end"][1], g["end"][0]]]},
                {"id": g["id"], "kind": "streetlight_gap", "street": g["street"], "length_m": g["length_m"], "gap_type": g["gap_type"]})
              for g in export["streetlight_gaps"]]
    feats += [f(pt(u), {"id": u["id"], "kind": "unmapped_business", "name": u["name"], "street": u["street"],
                        "approximate": True}) for u in export.get("unmapped_businesses", [])]
    return {"type": "FeatureCollection", "features": feats}
