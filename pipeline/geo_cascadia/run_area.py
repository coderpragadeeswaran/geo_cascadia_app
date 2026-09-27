"""Orchestrator: polygon (+ optional street list) -> full analysis -> export. Resumable per stage."""
import os, json, time
from collections import Counter
from shapely.geometry import shape
from .config import Config
from .streetview import StreetView
from .area import Area
from .plan import capture_plan, building_register
from .detect import run_detection
from .geometry import locate_assets, fuse_and_vote_streetlights, signs_by_building, building_views
from .buildloc import building_rays, locate_unmapped_buildings, predict_positions
from .ocr import run_ocr
from .vlm import VLM, run_names, run_building_attrs, finalize_buildings
from .reference import street_names, places_crosscheck
from .match import synthetic_property_register, match_properties, score_planted, asset_layer, review_queue
from .signuse import fill_use_from_signs
from .textmatch import name_quality
from .workspace import build_dashboard, QueryEngine
from .export import build_export, to_geojson
from .unmapped import unmapped_businesses


def _print_progress(stage, done, total):
    print(f"\r  [{stage}] {done}/{total}", end="" if done < total else "\n", flush=True)


def run_area(polygon, out_dir, cfg=None, area_name="area", street_filter=None, progress=None, resume=True, panos=None,
             way_ids=None, ms_fill=True, on_stage=None, plan_check=None, ocr_runner=None):
    """polygon: shapely (lon/lat) or GeoJSON geometry. street_filter: OSM street names to restrict to.
    panos: optional pre-discovered panorama list (skips discovery).
    on_stage(name, seconds): called when a stage finishes (P6 worker: live progress).
    plan_check(plan): called after the capture plan, BEFORE any Street View photo is fetched; it may raise to stop
    the run (P6 worker: cost cap -> "needs approval"). The plan is saved first, so a resumed run reuses it.
    ocr_runner(dets, cfg, out_dir, progress): runs the OCR stage instead of run_ocr and returns the same
    (results, names, stats) (P6c worker: OCR in its own process). None = run_ocr here, unchanged."""
    cfg = (cfg or Config()).resolve()
    progress = progress or _print_progress
    os.makedirs(out_dir, exist_ok=True)
    poly = shape(polygon) if isinstance(polygon, dict) else polygon
    J = lambda n: f"{out_dir}/{n}.json"
    load = lambda n: json.load(open(J(n))) if resume and os.path.exists(J(n)) else None
    save = lambda n, o: json.dump(o, open(J(n), "w"))
    T, t0 = {}, time.time()
    sv = StreetView(cfg.maps_key)
    def stage(name):
        T[name] = round(time.time() - stage.t, 1); stage.t = time.time(); print(f"✓ {name} ({T[name]} s)")
        if on_stage: on_stage(name, T[name])
    stage.t = time.time()

    # 1. panoramas
    panos = panos or load("panos")
    if panos is None:
        panos, n_grid = sv.discover(poly, cfg.grid_step_m, cfg.search_radius_m)
    save("panos", panos)
    if not panos: raise RuntimeError("NO_STREET_VIEW: Google has no outdoor Street View imagery on this selection")
    stage("panoramas")
    # 2. area model (Overpass is cached, so this is cheap on resume)
    area = Area(poly, f"{cfg.data_dir}/overpass_cache", cfg.ray_max_range_m)
    n_fp = area.load_footprints(ms_fill=ms_fill)
    sel = area.load_streets(panos, cfg, street_filter, way_ids)
    if not sel: raise RuntimeError("NO_STREETS: no road of the selection lies inside the area")
    save("streets", area.street_records())
    stage("area")
    # 3. capture plan + building register
    plan = load("plan")
    if plan is None:
        plan, anomalies = capture_plan(area, panos, cfg); save("plan", plan); save("plan_anomalies", anomalies)
    buildings = load("buildings")
    if buildings is None:
        buildings = building_register(area, plan); save("buildings", buildings)
    n_views = sum(len(e["views"]) for e in plan)
    n_unmapped = sum(v["footprint"] is None for e in plan for v in e["views"])
    coverage = {"panoramas": len(panos), "user_photospheres": sum(p.get("source") == "user" for p in panos),
                "cameras_planned": len(plan), "views_planned": n_views, "views_facing_no_mapped_building": n_unmapped,
                "footprints": area.fp_counts, "osm_built_fraction": getattr(area, "osm_built_frac", None),
                "buildings_registered": len(buildings),
                "buildings_by_source": dict(Counter(b.get("footprint_source", "osm") for b in buildings))}
    frac = n_unmapped / max(n_views, 1)
    coverage["verdict"] = ("no Street View cameras on the selected road" if not plan else
                           "full: footprints on most frontages" if frac < 0.25 else
                           f"partial: {100*frac:.0f}% of views face no mapped building (assets and signs still analysed)")
    save("coverage", coverage); print("coverage:", coverage)
    if not plan: raise RuntimeError("NO_CAMERAS: Street View exists nearby but none on the selected road")
    if plan_check: plan_check(plan)
    stage("plan")
    # 4. detection
    dets, det_stats = run_detection(plan, sv, cfg, out_dir, progress)
    stage("detect")
    # 5. geometry
    geo = [d for d in dets if d["geom_ok"]]
    assets = fuse_and_vote_streetlights(locate_assets([d for d in geo if d["cls"] in ("pole", "lamp_head")], area.frame, cfg),
                                        dets, area.frame, cfg)
    assets = [a for a in assets if a.get("lat")]
    signs = signs_by_building(dets, area)
    views = building_views(dets, area)
    save("assets", assets); save("building_views", views)
    # predicted building position by the fixed rule (D27, D28): triangulated (>= 2 cameras, plausible) / wall_hit /
    # wall_centre (road-facing wall midpoint, D33) / footprint_centre.
    # lat/lon stay the footprint centroid. Same code for every area and every live street.
    brays = building_rays(dets, area, ("building", "signboard"))
    bpos = predict_positions(dets, area, buildings, {r["name"]: r["geom"] for r in area.streets}, cfg,
                             rays=[r for r in brays if r["cls"] == "building"])
    bfree, bfree_stats = locate_unmapped_buildings(dets, area, cfg, rays=brays)
    save("building_positions", {"by_building": bpos, "no_footprint": bfree, "no_footprint_stats": bfree_stats})
    stage("geometry")
    # 6. OCR
    ocr_res, ocr_names, ocr_stats = (ocr_runner or run_ocr)(dets, cfg, out_dir, progress)
    stage("ocr")
    # 7. VLM
    vlm = VLM(cfg)
    vnames = run_names(ocr_res, vlm, cfg, out_dir, progress)
    router = None
    if cfg.use_router_path and os.path.exists(cfg.use_router_path):
        from .localuse import UseRouter
        router = UseRouter(cfg.use_router_path, cfg.device)
    vbld, shots_ok = run_building_attrs(views, sv, vlm, cfg, out_dir, progress, router=router)
    final = finalize_buildings(buildings, ocr_res, ocr_names, vnames, vbld, cfg)
    # D32: a building whose use is still unknown but has a readable business sign is commercial (rule, no model call)
    final, sign_use_stats = fill_use_from_signs(final, ocr_res, cfg)
    print("use from sign text:", sign_use_stats)
    ub, ub_stats = unmapped_businesses(dets, ocr_res, area.frame, vlm, cfg, out_dir)
    save("unmapped_businesses", ub); print("unmapped businesses:", ub_stats)
    save("final_attributes", final)
    stage("vlm")
    # 8. reference layers
    names = load("street_names")
    if names is None:
        names = street_names(plan, cfg); save("street_names", names)
    xref, pstats = places_crosscheck(area, plan, buildings, final, cfg, out_dir, progress)
    stage("reference")
    # 9. registers + matching (street kinds use OSM names, display uses resolved names)
    kind = {r["name"]: r["kind"] for r in area.streets}
    register, truth = synthetic_property_register(buildings, kind, cfg)
    results = match_properties(buildings, final, register, cfg)
    for m in results:
        x = xref.get(m["building_id"], {})
        m.update(name_verified_google=x.get("name_verified"), google_name=x.get("google_name"),
                 google_place_id=x.get("google_place_id"), ref_flags=x.get("ref_flags", []))
        m["name_quality"] = name_quality(m.get("name"), m.get("name_src"), m["name_verified_google"])
        if m["name_quality"] != "good": m["ref_flags"] = [f for f in m["ref_flags"] if f != "sign_not_in_google_within_40m"]
    A, missing, gaps, asset_score = asset_layer(assets, plan, area, cfg)
    nm = lambda s: names.get(s, s)
    for coll in (results, A, missing, buildings, ub): [o.update(street=nm(o.get("street"))) for o in coll]
    for g in gaps.values(): [o.update(street=nm(o["street"])) for o in g]
    queue = review_queue(results, A)
    planted = score_planted(results, truth)
    stage("match")
    # 10. dashboard + export
    tiers = Counter(r["tier"] for r in ocr_res)
    run_stats = {"coverage": coverage, "street_view_requests": sv.n_images, "street_view_cost_usd_notional": round(sv.n_images * cfg.sv_price, 2),
                 "views_planned": sum(len(e["views"]) for e in plan), "sign_crops_total": len(ocr_res),
                 "crops_read_by_ocr": tiers.get(2, 0), "crops_discarded_no_text": tiers.get(0, 0) + tiers.get(1, 0),
                 "crops_escalated": tiers.get(3, 0), "crops_skipped_fast_mode": tiers.get(-1, 0),
                 "ocr_mode": ocr_stats["mode"], "ocr_sec_per_crop": ocr_stats["sec_per_crop"],
                 "buildings_use_local": sum((b.get("vlm") or {}).get("use_route") == "tier1_local_clip" for b in vbld),
                 "buildings_use_vlm": sum((b.get("vlm") or {}).get("use_route", "tier3_vlm") == "tier3_vlm" for b in vbld if "vlm" in b),
                 "buildings_use_sign": sign_use_stats["filled"],
                 "vlm_calls": vlm.calls, "vlm_cost_usd": round(vlm.cost(), 4), "places_calls": pstats["places_calls"],
                 "device": cfg.device, "floors_examples_found": shots_ok, "stage_seconds": T,
                 "total_minutes": round((time.time() - t0) / 60, 1),
                 "validation": cfg.validation, "planted_error_scores": planted, "asset_register_scores": asset_score}
    dash = build_dashboard(results, A, gaps, queue, run_stats)
    dash["kpi"]["unmapped_businesses"] = len(ub)
    exp = build_export(area_name, cfg, buildings, results, views, vbld, ocr_res, A, missing, gaps, queue, dash, panos, run_stats,
                       positions=bpos)
    exp["unmapped_businesses"] = ub; exp["meta"]["counts"]["unmapped_businesses"] = len(ub)
    save("dashboard", dash); save("export", exp)
    json.dump(to_geojson(exp), open(f"{out_dir}/export.geojson", "w"))
    stage("export")
    print(f"\nDONE {area_name}: {len(results)} buildings | {len(ub)} unmapped businesses | {len(A)} assets | {len(queue)} review items | "
          f"{run_stats['total_minutes']} min | SV {sv.n_images} images | VLM ${run_stats['vlm_cost_usd']}")
    return exp, QueryEngine(results, A, gaps, queue)
