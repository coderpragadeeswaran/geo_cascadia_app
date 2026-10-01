"""p7a_reapply.py — apply D42–D45 to an analysed area from its SAVED files only.

    backend\\.venv\\Scripts\\python tools\\p7a_reapply.py data/areas/<slug> [...] [--write] [--register data/registers/<file>.json]

No YOLO / OCR / cloud-AI / Street View / Places calls. The only network use is OpenStreetMap (and, for an area built on
Microsoft outlines, the Microsoft footprint tile) to rebuild the building outlines the signs' lines of sight are cast
into; both are cached under data/cache/. The same pipeline functions a live run calls do the work:

  0. regression: the saved OCR / cloud-model / attribute files must reproduce the saved attributes (finalize_buildings +
     fill_use_from_signs) and the saved export's register matching (the pre-D42 register) — else nothing is written.
  1. D44  signlink.link_signs → relink_ocr / relink_vlm_names → finalize_buildings → fill_use_from_signs (D32) →
          the Google check (reference.crosscheck_with_places on the run's cached places) → businesses with no mapped
          building (unmapped.unmapped_businesses with the run's cached cloud verdicts only; new candidates are counted as
          "not checked")
  2. D42  register.observed_register (seeded by the area name) — saved as planted_register_mistakes.json
  3. D43  register.match_by_location (records without building ids) + recovery_scores + pairing_accuracy
  4. D45  single-camera asset uncertainty from poleunc.uncertainty_for(camera distance)
  5. review queue, dashboard, export (export.build_export for the building records), export.geojson, final_attributes.json,
     sign_links.json. The previous files are copied to data/cache/p7a_before/<slug>/ first.
Prints a before/after report (JSON). --register uses an imported real register (tools/import_register.py) instead of the
synthetic one: nothing is planted, so no recovery scores.
"""
import argparse
import json
import os
import shutil
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

from shapely.geometry import box  # noqa: E402

import geo_cascadia.area as GA  # noqa: E402
from geo_cascadia.area import Area  # noqa: E402
from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.export import build_export, single_camera_basis, to_geojson  # noqa: E402
from geo_cascadia.match import match_properties, review_queue, synthetic_property_register  # noqa: E402
from geo_cascadia.poleunc import camera_distance, uncertainty_for  # noqa: E402
from geo_cascadia.reference import crosscheck_with_places, places_from_cache  # noqa: E402
from geo_cascadia.register import hide_truth, match_by_location, observed_register, pairing_accuracy, recovery_scores  # noqa: E402
from geo_cascadia.signlink import link_signs, ocr_names, relink_ocr, relink_vlm_names  # noqa: E402
from geo_cascadia.signuse import fill_use_from_signs  # noqa: E402
from geo_cascadia.textmatch import name_quality  # noqa: E402
from geo_cascadia.unmapped import unmapped_businesses  # noqa: E402
from geo_cascadia.vlm import finalize_buildings  # noqa: E402
from geo_cascadia.workspace import build_dashboard  # noqa: E402

# the busy public Overpass server times out on building queries; this mirror answers (same data model, cached as usual)
GA.MIRRORS = ["https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter",
              "https://overpass.kumi.systems/api/interpreter", "https://overpass.openstreetmap.ru/api/interpreter"]
PAD_DEG = 0.0007
ATTR_KEYS = ("use", "floors", "floors_status", "name", "name_src", "name_review")


def load(folder, name, default=None):
    p = os.path.join(folder, f"{name}.json")
    if not os.path.isfile(p):
        if default is not None:
            return default
        raise SystemExit(f"{folder}: {name}.json missing")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save(folder, name, obj, ext="json"):
    with open(os.path.join(folder, f"{name}.{ext}"), "w", encoding="utf-8") as f:
        json.dump(obj, f)


def area_model(folder, dets, cfg):
    """the building outlines around the cameras (OSM, plus Microsoft where the run used them), as the pipeline loads them"""
    la = [d["camera_lat"] for d in dets]
    lo = [d["camera_lon"] for d in dets]
    poly = box(min(lo) - PAD_DEG, min(la) - PAD_DEG, max(lo) + PAD_DEG, max(la) + PAD_DEG)
    a = Area(poly, os.path.join(ROOT, "data", "cache", "p45_overpass"), cfg.ray_max_range_m)
    ms = ((load(folder, "coverage", {}).get("footprints") or {}).get("microsoft") or 0) > 0
    a.load_footprints(ms_fill=ms)
    return a


class CachedVerdicts:
    """stands in for the cloud model in unmapped_businesses. vlm_unmapped.json (the run's own business checks) is read by
    unmapped_businesses itself; for any other crop this returns the run's cached answer to the SAME prompt (NAME_PROMPT)
    from the naming step (vlm_names.json), and for a crop the run never sent anywhere an empty answer, counted as not
    checked. Never calls anything."""
    def __init__(self, vlm_names):
        self.by_file = {os.path.basename(w.get("file") or ""): w.get("vlm") or {} for w in vlm_names}
        self.not_checked = self.reused = 0

    def converse(self, content, max_tokens=400):
        v = self.by_file.get(os.path.basename(content[0]["image"]))
        if v is None:
            self.not_checked += 1
            return "{}", {}
        self.reused += 1
        return json.dumps(v), {}

    @staticmethod
    def img(path):
        return {"image": path}


def summary(exp):
    B, A = exp["buildings"], exp["assets"]
    single = [a for a in A if a.get("method") != "triangulated"]
    return {"differs": sum(b["match_status"] == "discrepancy" for b in B),
            "not_in_register": sum(b["match_status"] == "no_record" for b in B),
            "use_not_known": sum(not (b["attributes"].get("use") or {}).get("value") for b in B),
            "names_read_clearly": sum((b["attributes"].get("name") or {}).get("quality") == "good" for b in B),
            "names_any": sum(bool((b["attributes"].get("name") or {}).get("value")) for b in B),
            "review_items": len(exp["review_queue"]),
            "unmapped_businesses": len(exp.get("unmapped_businesses") or []),
            "single_camera_circles": dict(sorted(Counter(round(a.get("uncertainty_m") or 0, 1) for a in single).items()))}


def regression(folder, cfg, buildings, ocr, vn, vb, final_saved, exp):
    names = ocr_names(ocr)
    f2, _ = fill_use_from_signs(finalize_buildings(buildings, ocr, names, vn, vb, cfg), ocr, cfg)
    F = {x["building_id"]: x for x in final_saved}
    bad = [x["building_id"] for x in f2 if any(x.get(k) != F.get(x["building_id"], {}).get(k) for k in ATTR_KEYS)]
    streets = load(folder, "streets")
    kind = {s["name"]: s.get("kind", "residential") for s in streets}
    reg, _ = synthetic_property_register(buildings, kind, cfg)
    E = {b["id"]: b for b in exp["buildings"]}
    old = match_properties(buildings, final_saved, reg, cfg)
    bad_m = [m["building_id"] for m in old if (m["match_status"], m["discrepancies"]) != (E[m["building_id"]]["match_status"], E[m["building_id"]]["discrepancies"])]
    return bad, bad_m


def reapply(folder, write=False, register_file=None):
    cfg = Config()
    slug = os.path.basename(os.path.normpath(folder))
    exp = load(folder, "export")
    if (exp["meta"].get("run") or {}).get("p7a_reapplied"):
        raise SystemExit(f"{slug}: already re-applied (meta.run.p7a_reapplied). The pre-P7a files are in data/cache/p7a_before/"
                         f"{slug}/; copy them back first to re-apply again.")
    before = summary(exp)
    buildings, dets, ocr = load(folder, "buildings"), load(folder, "detections"), load(folder, "ocr")
    vn, vb, final_saved = load(folder, "vlm_names", []), load(folder, "vlm_buildings", []), load(folder, "final_attributes")
    views, panos, plan = load(folder, "building_views", []), load(folder, "panos"), load(folder, "plan")
    names = load(folder, "street_names", {})
    bpos = (load(folder, "building_positions", {}) or {}).get("by_building") or {}
    raw_assets = load(folder, "assets")
    # older runs (no sign links yet) keep the planned outline in "fp"; a re-run starts from those
    ocr = [{**r, "fp": r.get("fp_planned", r.get("fp"))} for r in ocr]

    bad, bad_m = regression(folder, cfg, buildings, ocr, vn, vb, final_saved, exp)
    if bad or bad_m:
        raise SystemExit(f"{slug}: saved files do not reproduce the saved results ({len(bad)} attribute, {len(bad_m)} match "
                         f"differences, e.g. {(bad + bad_m)[:3]}) — nothing written")

    # ---------------------------------------------------------------- D44: signs by their own line of sight
    area = area_model(folder, dets, cfg)
    missing = {b["building_id"] for b in buildings} - set(area.fp_ids)
    if missing:
        raise SystemExit(f"{slug}: {len(missing)} registered outlines not found in the re-loaded outlines — nothing written")
    links = link_signs(dets, area, cfg.sign_link_margin_deg)
    ocr2 = relink_ocr(ocr, links)
    vn2 = relink_vlm_names(vn, ocr2)
    final = finalize_buildings(buildings, ocr2, ocr_names(ocr2), vn2, vb, cfg)
    final, sign_stats = fill_use_from_signs(final, ocr2, cfg)
    xref = crosscheck_with_places(area, buildings, final, places_from_cache(load(folder, "places_cache", {})), cfg)

    moved = []                                        # read signs whose building changed
    reg_ids = {b["building_id"] for b in buildings}
    for r in ocr2:
        if r.get("tier") in (2, 3) and r.get("fp") != r.get("fp_planned"):
            moved.append({"text": r.get("best") or r.get("clean") or r.get("text"), "tier": r["tier"], "from": r["fp_planned"],
                          "to": r["fp"], "dist_m": r.get("sign_dist_m"), "from_registered": r["fp_planned"] in reg_ids,
                          "to_registered": r["fp"] in reg_ids, "file": os.path.basename(r["file"])})

    # businesses with no mapped building: the run's cached cloud verdicts only (in a scratch copy of the cache)
    tmp = os.path.join(ROOT, "data", "cache", "p7a_tmp", slug)
    os.makedirs(tmp, exist_ok=True)
    src = os.path.join(folder, "vlm_unmapped.json")
    if os.path.isfile(src):
        shutil.copy(src, os.path.join(tmp, "vlm_unmapped.json"))
    stub = CachedVerdicts(vn)
    ub, ub_stats = unmapped_businesses(dets, ocr2, area.frame, stub, cfg, tmp, registered={b["building_id"] for b in buildings})
    ub_stats.update(not_checked_new_candidates=stub.not_checked, reused_naming_verdicts=stub.reused)

    # ---------------------------------------------------------------- D42 + D43: register and location matching
    if register_file:
        with open(register_file, encoding="utf-8") as f:
            register = json.load(f)["records"]
        truth = []
    else:
        register, truth = observed_register(buildings, final, bpos, cfg, exp["meta"]["area"])
    results, unmatched, pairs = match_by_location(buildings, final, hide_truth(register), bpos, cfg)
    for m in results:
        x = xref.get(m["building_id"], {})
        m.update(name_verified_google=x.get("name_verified"), google_name=x.get("google_name"),
                 google_place_id=x.get("google_place_id"), ref_flags=x.get("ref_flags", []))
        m["name_quality"] = name_quality(m.get("name"), m.get("name_src"), m["name_verified_google"])
        if m["name_quality"] != "good":
            m["ref_flags"] = [f for f in m["ref_flags"] if f != "sign_not_in_google_within_40m"]
    nm = lambda s: names.get(s, s)
    blds = [{**b, "street": nm(b["street"])} for b in buildings]
    for coll in (results, unmatched, ub):
        for o in coll:
            o["street"] = nm(o.get("street"))

    # ---------------------------------------------------------------- D45: single-camera uncertainty by distance
    P = {p["pano_id"]: p for p in panos}
    raw = [a for a in raw_assets if a.get("lat")]
    assets = [dict(a) for a in exp["assets"]]
    assert len(raw) == len(assets) and all(round(r["lat"], 7) == round(a["lat"], 7) for r, a in zip(raw, assets)), \
        f"{slug}: assets.json and export assets are not in the same order"
    for a, r in zip(assets, raw):
        if a.get("method") != "triangulated":
            d = camera_distance(r, P)
            a.update(uncertainty_m=uncertainty_for(d, cfg), uncertainty_basis=single_camera_basis(d, cfg), camera_distance_m=d)

    # ---------------------------------------------------------------- review queue, dashboard, export
    A = [{**a, "cls": a["type"]} for a in assets]
    queue = review_queue(results, A)
    run = dict(exp["meta"]["run"])
    run.update(planted_error_scores=recovery_scores(results, truth) if truth else None,
               register_matching=({"pairing": pairing_accuracy(pairs, register, truth), "records": len(register),
                                   "records_unmatched": len(unmatched)} if truth else {"records": len(register),
                                   "records_unmatched": len(unmatched), "pairing": None}),
               signs_relinked=sum(1 for v in links.values() if v["fp"] != v["planned"]), buildings_use_sign=sign_stats["filled"],
               p7a_reapplied={"from_saved_files": True, "register": "imported" if register_file else "observed (D42)",
                              "unmapped_not_checked": stub.not_checked, "unmapped_reused_naming_verdicts": stub.reused})
    dash = build_dashboard(results, A, {"60": exp["streetlight_gaps"]}, queue, run)
    dash["kpi"]["unmapped_businesses"] = len(ub)
    new = build_export(exp["meta"]["area"], cfg, blds, results, views, vb, ocr2, [], [], {}, queue, dash, panos, run,
                       positions=bpos if bpos else None)
    out = dict(exp)
    out["buildings"] = new["buildings"]
    out["assets"] = assets
    out["review_queue"] = queue
    out["dashboard"] = dash
    out["unmapped_businesses"] = ub
    out["register_unmatched"] = unmatched
    out["meta"] = {**exp["meta"], "run": run, "registers": ("IMPORTED property register (matched by location)" if register_file else
                   "SYNTHETIC property register copying the observations + planted mistakes (D42); matched by location (D43); "
                   "SYNTHETIC asset register"),
                   "counts": {**exp["meta"]["counts"], "review_items": len(queue), "unmapped_businesses": len(ub)}}
    after = summary(out)

    report = {"area": slug, "before": before, "after": after, "signs": {
        "sign_crops": len(links), "relinked": run["signs_relinked"], "read_signs_moved": len(moved),
        "read_moved_between_registered": sum(1 for m in moved if m["from_registered"] and m["to_registered"]),
        "read_now_no_outline": sum(1 for m in moved if m["to"] is None),
        "read_now_on_unregistered_outline": sum(1 for m in moved if m["to"] and not m["to_registered"])},
        "unmapped": ub_stats, "planted": truth and Counter(t["kind"] for t in truth), "recovery": run["planted_error_scores"],
        "pairing": run["register_matching"], "moved_examples": moved}
    if write:
        keep = os.path.join(ROOT, "data", "cache", "p7a_before", slug)
        os.makedirs(keep, exist_ok=True)
        for n in ("export.json", "export.geojson", "final_attributes.json", "dashboard.json"):
            if os.path.isfile(os.path.join(folder, n)) and not os.path.isfile(os.path.join(keep, n)):
                shutil.copy(os.path.join(folder, n), os.path.join(keep, n))
        save(folder, "final_attributes", final)
        save(folder, "sign_links", links)
        if not register_file:
            save(folder, "planted_register_mistakes", truth)
            save(folder, "register_synthetic", register)
        save(folder, "export", out)
        save(folder, "unmapped_businesses", ub)
        save(folder, "dashboard", dash)
        with open(os.path.join(folder, "export.geojson"), "w", encoding="utf-8") as f:
            json.dump(to_geojson(out), f)
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("folders", nargs="+")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--register", help="an imported register (tools/import_register.py output) instead of the synthetic one")
    ap.add_argument("--report", help="write the full reports (incl. every moved sign) to this JSON file")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    reports = []
    for f in a.folders:
        r = reapply(f, a.write, a.register)
        reports.append(r)
        print(json.dumps({k: v for k, v in r.items() if k != "moved_examples"}, ensure_ascii=False))
    if a.report:
        with open(a.report, "w", encoding="utf-8") as f:
            json.dump(reports, f, ensure_ascii=False, indent=1)
