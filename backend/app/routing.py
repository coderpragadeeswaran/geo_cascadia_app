"""Routing and cost (P8): which model handled what, with counts, latency and $ per route, computed from a run's own files.

Sources (read-only, no model calls):
- vlm_buildings.json: one row per building photo; `vlm.use_route` says whether the local CLIP router or the cloud model
  (Nova Lite) decided the use; the use call's tokens (`in`/`out`) and latency (`lat_s`); the floors call's tokens
  (`floors_in`/`floors_out`) only in runs made after P6 (D34).
- vlm_names.json: one cloud name check per building with readable sign text (tokens, latency).
- vlm_unmapped.json: one cloud check per candidate business sign (no tokens stored: the same prompt as the name check).
- the run's own cost counter (meta.run.vlm_calls / vlm_cost_usd) and the pipeline's token prices (Config).
- model_card.json for the detector / OCR speeds and every accuracy number.

Every $ carries a status: measured (tokens × price), derived (run counter minus the measured calls), estimate (calls ×
the measured cost of the same prompt) or not recorded.

Why this exists (P8 item 1): model_card's Ward 29 "with router $0.056 / 339 calls" is the counter of a RESUMED run that
re-used the name and business-sign checks from saved files, so it counts only the use (73) and floors (266) calls. Its
"without router $0.089 / 782 calls" counts all four kinds. Like for like, the router saves 193 use calls, not 443.
"""
import statistics

from geo_cascadia.config import Config

_CFG = Config()
P_IN, P_OUT = _CFG.vlm_in_per_m, _CFG.vlm_out_per_m          # USD per million tokens (Nova Lite), the pipeline's own prices
LOCAL = "tier1_local_clip"


def _usd(tok_in, tok_out):
    return tok_in / 1e6 * P_IN + tok_out / 1e6 * P_OUT


def _med(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return round(statistics.median(xs), 2) if xs else None


def _r(x, k=4):
    return None if x is None else round(x, k)


def calls(F, run):
    """The cloud calls of one run, by kind, with what is known about each kind's cost and latency."""
    vb = [r for r in F.get("vlm_buildings") or [] if "vlm" in r]
    vn = F.get("vlm_names") or []
    vu = F.get("vlm_unmapped") or {}
    use_local = [r for r in vb if (r["vlm"] or {}).get("use_route") == LOCAL]
    use_cloud = [r for r in vb if (r["vlm"] or {}).get("use_route") != LOCAL]
    fl_tok = [r for r in vb if "floors_in" in r]
    floors = fl_tok if fl_tok else [r for r in vb if r.get("floors_a") is not None]
    K = {
        "use": {"n": len(use_cloud), "usd": _usd(sum(r.get("in", 0) for r in use_cloud), sum(r.get("out", 0) for r in use_cloud)),
                "status": "measured", "lat_s": _med(r.get("lat_s") for r in use_cloud),
                "src": "vlm_buildings.json: use calls' tokens × Nova Lite price"},
        "floors": {"n": len(floors), "usd": _usd(sum(r["floors_in"] for r in fl_tok), sum(r["floors_out"] for r in fl_tok)) if fl_tok else None,
                   "status": "measured" if fl_tok else "not recorded", "lat_s": None,
                   "src": "vlm_buildings.json: floors calls' tokens × price" if fl_tok else "this run did not store the floors call's tokens"},
        "names": {"n": len(vn), "usd": _usd(sum(r.get("in", 0) for r in vn), sum(r.get("out", 0) for r in vn)), "status": "measured",
                  "lat_s": _med(r.get("lat_s") for r in vn), "src": "vlm_names.json: tokens × price"},
        "signs": {"n": len(vu), "usd": None, "status": "not recorded", "lat_s": None,
                  "src": "vlm_unmapped.json stores no tokens"},
    }
    total_n = sum(k["n"] for k in K.values())
    rc, rusd = run.get("vlm_calls"), run.get("vlm_cost_usd")
    # floors without tokens: the run's own counter minus the measured use calls, when the counter covers exactly use + floors
    if K["floors"]["usd"] is None and K["floors"]["n"] and rusd and rc == K["use"]["n"] + K["floors"]["n"]:
        K["floors"].update(usd=rusd - K["use"]["usd"], status="derived",
                           src=f"the run's cost counter (${rusd}, {rc} calls = {K['use']['n']} use + {K['floors']['n']} floors) "
                               f"minus the use calls' measured ${round(K['use']['usd'], 4)}")
    # business-sign checks: the run counter minus the rest when the counter covers every call; else the name check's
    # measured cost per call (same prompt, one sign crop)
    if K["signs"]["n"]:
        known = [k for k in ("use", "floors", "names") if K[k]["usd"] is not None]
        if rusd and rc == total_n and len(known) == 3:
            K["signs"].update(usd=max(0.0, rusd - sum(K[k]["usd"] for k in known)), status="derived",
                              src=f"the run's cost counter (${rusd}, all {rc} calls) minus the other measured calls")
        elif K["names"]["n"]:
            K["signs"].update(usd=K["signs"]["n"] * K["names"]["usd"] / K["names"]["n"], status="estimate",
                              src="checks × the name check's measured cost per call (the same prompt on one sign crop)")
    return K, use_local, use_cloud


def routing(bundle, F, n, model_card=None):
    """The Routing and cost chapter: tasks → local vs cloud routes, totals, all-cloud and every-photo comparisons, the
    n=31 accuracy comparisons, and (Ward 29) the model_card cost check."""
    mc = model_card or {}
    run = bundle["meta"].get("run") or {}
    K, use_local, use_cloud = calls(F, run)
    if not (F.get("vlm_buildings") or F.get("vlm_names")):
        return None
    det = mc.get("detector") or {}
    ocr = (mc.get("ocr") or {}).get("cpu_fast_mode") or {}
    per_use_call = K["use"]["usd"] / K["use"]["n"] if K["use"]["n"] else None

    def cloud(kind, label, unit="calls"):
        k = K[kind]
        return {"route": "cloud", "model": "Nova Lite", "label": label, "n": k["n"], "unit": unit, "usd": _r(k["usd"], 6),
                "usd_status": k["status"], "usd_src": k["src"],
                "usd_per_call": _r(k["usd"] / k["n"], 7) if k["usd"] is not None and k["n"] else None,
                "lat_s": k["lat_s"], "lat_src": "median seconds per call (vlm files' lat_s)" if k["lat_s"] is not None else "not recorded"}

    def local(model, label, value, unit, lat=None, lat_src="not measured"):
        return {"route": "local", "model": model, "label": label, "n": value, "unit": unit, "usd": 0, "usd_status": "no per-call charge",
                "usd_src": "runs on the analysis computer (GPU time, not billed per call)", "lat_s": lat, "lat_src": lat_src}

    gpu_ms, cpu_ms = det.get("gpu_ms_per_view"), det.get("cpu_ms_per_view")
    tasks = [
        {"key": "detect", "title": "Find objects in the photos", "input": n["views_fetched"] or n["views"], "input_unit": "photos",
         "routes": [local("YOLOv8s", f"{n['boxes']:,} boxes found", n["views_fetched"] or n["views"], "photos",
                          gpu_ms / 1000 if gpu_ms else None,
                          f"model card: {gpu_ms} ms per photo on a T4 GPU ({cpu_ms} ms on a CPU)" if gpu_ms else "not measured")]},
        {"key": "signs", "title": "Read shop signs", "input": n["sign_crops"], "input_unit": "sign crops",
         "routes": [local("PaddleOCR", f"{n['signs_ocr']:,} read, {n['signs_vlm']:,} unsure, {n['signs_no_text']:,} no text",
                          n["sign_crops"] - n["signs_skipped"], "crops", None,
                          (f"GPU not measured; model card CPU: {ocr.get('full_mode_sec_per_crop')} s per crop "
                           f"({ocr.get('sec_per_crop')} s in fast mode)") if ocr else "not measured"),
                    cloud("names", "name check: one best sign crop per building with readable text")]},
        {"key": "use", "title": "Building use (shop or home)", "input": len(use_local) + len(use_cloud), "input_unit": "building photos",
         "routes": [local("CLIP + logistic regression", "sure enough: decided locally", len(use_local), "buildings"),
                    cloud("use", "unsure: sent to the cloud model", "buildings")]},
        {"key": "floors", "title": "Number of floors", "input": K["floors"]["n"], "input_unit": "building photos",
         "routes": [cloud("floors", "every building photo (two solved examples + the photo: three images per call)", "buildings")]},
        {"key": "unmapped", "title": "Shop signs with no analysed building", "input": K["signs"]["n"], "input_unit": "candidate signs",
         "routes": [cloud("signs", "is it a business sign, and its name")]},
    ]
    kinds = ("use", "floors", "names", "signs")
    routed_n = sum(K[k]["n"] for k in kinds)
    known = [K[k]["usd"] for k in kinds if K[k]["n"]]
    routed_usd = sum(known) if all(x is not None for x in known) else None
    statuses = sorted({K[k]["status"] for k in kinds if K[k]["n"]})
    totals = {"calls": routed_n, "usd": _r(routed_usd), "status": "measured" if statuses == ["measured"] else
              "partly " + " / ".join(s for s in statuses if s != "measured") if routed_usd is not None else "not recorded",
              "run_counter": {"calls": run.get("vlm_calls"), "usd": run.get("vlm_cost_usd")}}
    # every building's use to the cloud model as well (no local router): + one use call per locally decided building
    all_cloud = None
    if per_use_call is not None and routed_usd is not None:
        all_cloud = {"calls": routed_n + len(use_local), "usd": _r(routed_usd + len(use_local) * per_use_call),
                     "extra_calls": len(use_local), "extra_usd": _r(len(use_local) * per_use_call, 5),
                     "src": f"routed total + {len(use_local)} locally decided buildings × the use call's measured ${per_use_call:.7f}"}
    # VLM on every photo: one call per planned photo at the measured cost of a one-photo call (the use call) — an estimate
    every = None
    one = per_use_call or (K["names"]["usd"] / K["names"]["n"] if K["names"]["n"] else None)
    lat = K["use"]["lat_s"] or K["names"]["lat_s"]
    if one is not None:
        every = {"photos": n["views"], "usd_per_call": _r(one, 7), "usd": _r(n["views"] * one),
                 "minutes": round(n["views"] * lat / _CFG.vlm_workers / 60, 1) if lat else None, "workers": _CFG.vlm_workers,
                 "lat_s": lat, "status": "estimate",
                 "src": f"{n['views']:,} planned photos × ${one:.7f} (the measured average cost of a one-photo use call)"
                        + (f"; time = photos × {lat} s median per call ÷ {_CFG.vlm_workers} calls at once" if lat else "")}
    lr = ((mc.get("building_use") or {}).get("local_router") or {})
    nm = (mc.get("names") or {})
    acc = []
    if lr.get("ward29_heldout"):
        h = lr["ward29_heldout"]
        acc.append({"task": "Building use", "n": h.get("n"), "src": "model_card.building_use.local_router.ward29_heldout",
                    "rows": [{"label": "cloud model only", "value": h.get("vlm_only")},
                             {"label": "local model only", "value": h.get("local_only")},
                             {"label": "routed (as run)", "value": h.get("routed"), "production": True}],
                    "note": f"routed = the local model first, the cloud model when it is unsure ({round((h.get('escalated') or 0) * 100)}% of these buildings)"})
    if nm.get("crop_level_n31"):
        c = nm["crop_level_n31"]
        acc.append({"task": "Shop names", "n": 31, "src": "model_card.names.crop_level_n31",
                    "rows": [{"label": "cloud model only", "value": c.get("all_vlm")},
                             {"label": "OCR only", "value": c.get("ocr_only")},
                             {"label": "routed (as run)", "value": c.get("routed_ocr_then_vlm"), "production": True}],
                    "note": "sign crops read correctly vs hand labels; routed = OCR first, the cloud model when OCR is unsure"})
    measured_every = None
    fv = nm.get("full_view_n16")
    nr = (mc.get("cost_time") or {}).get("names_routed_vs_all_vlm_usd")
    if fv and nr:
        measured_every = {"n": 16, "routed": fv.get("routed"), "all_vlm": fv.get("all_vlm_per_view"), "usd_routed": nr.get("routed"),
                          "usd_all_vlm": nr.get("all_vlm_every_view"), "ratio": fv.get("cost_ratio"),
                          "src": "model_card.names.full_view_n16 + model_card.cost_time.names_routed_vs_all_vlm_usd"}
    check = None
    ct = mc.get("cost_time") or {}
    fr = lr.get("full_ward29_run") or {}
    from .derived import MODEL_CARD_AREA
    if bundle["slug"] == MODEL_CARD_AREA and ct.get("ward29_vlm_usd_with_router") is not None:
        check = {"stored_with": ct.get("ward29_vlm_usd_with_router"), "stored_without": ct.get("ward29_vlm_usd_without_router"),
                 "stored_calls_with": fr.get("vlm_calls_after"), "stored_calls_without": fr.get("vlm_calls_before"),
                 "computed_with": totals["usd"], "computed_calls_with": routed_n,
                 "computed_without": (all_cloud or {}).get("usd"), "computed_calls_without": (all_cloud or {}).get("calls"),
                 "names_and_signs_calls": K["names"]["n"] + K["signs"]["n"],
                 "names_and_signs_usd": _r((K["names"]["usd"] or 0) + (K["signs"]["usd"] or 0)),
                 "why": (f"The model card's 'with router' figure (${ct.get('ward29_vlm_usd_with_router')}, {fr.get('vlm_calls_after')} calls) is "
                         f"the cost counter of a resumed run: it counts only the {K['use']['n']} use calls and {K['floors']['n']} floors calls. "
                         f"The {K['names']['n']} name checks and {K['signs']['n']} business-sign checks were re-used from saved files, so they "
                         f"are missing from it, while the 'without router' figure (${ct.get('ward29_vlm_usd_without_router')}, "
                         f"{fr.get('vlm_calls_before')} calls) includes them. Like for like, with the router: "
                         f"{routed_n} calls, about ${round(routed_usd, 3) if routed_usd is not None else '?'}.")}
    return {"tasks": tasks, "totals": totals, "all_cloud": all_cloud, "every_view": every, "accuracy": acc,
            "measured_every_view": measured_every, "model_card_check": check,
            "prices": {"in_per_m": P_IN, "out_per_m": P_OUT, "src": "pipeline Config (Nova Lite USD per million tokens)"},
            "street_view": {"photos": n["photos_fetched"], "usd_per_photo": ct.get("street_view_price_usd_per_image"),
                            "usd": round(n["photos_fetched"] * ct["street_view_price_usd_per_image"], 2)
                            if ct.get("street_view_price_usd_per_image") else None}}
