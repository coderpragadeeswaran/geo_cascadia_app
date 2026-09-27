"""Trust page data (P5, D29).

`cards()` and `experiments()` quote ONLY data/model_card.json: every number carries `src`, the dotted path of the value
in model_card (pytest resolves each one). The plain one-line verdict is a template filled with those same values.
`consistency()` lists, for all areas, every place a stored counter or story sentence differs from the computed count,
with both values and where it appears in the app (`jump`).
"""
import re

from . import hood, views
from .streetgeo import gap_consistency


def get(mc, path):
    """model_card value at a dotted path ('floors.ward29.exact'); KeyError when missing."""
    x = mc
    for k in path.split("."):
        x = x[int(k)] if isinstance(x, list) else x[k]
    return x


def _num(mc, path, label, kind="pct", n=None, n_src=None):
    v = get(mc, path)
    out = {"label": label, "value": v, "kind": kind if isinstance(v, (int, float)) else "text", "src": path}
    if n is not None or n_src:
        out["n"] = n if n is not None else get(mc, n_src)
        out["n_src"] = n_src or path
    return out


def _pct(v):
    return f"{round(v * 100)}%" if isinstance(v, (int, float)) else str(v)


def _key_n(key):
    """n written in a model_card key name, e.g. crop_level_n31 → 31 (the card says where it comes from)"""
    m = re.search(r"_n(\d+)$", key)
    return int(m.group(1)) if m else None


def cards(mc):
    """One card per result type: what was measured, the sample size, the result, the baseline and a plain verdict."""
    if not mc:
        return []
    out = []
    lr = "building_use.local_router"
    out.append({
        "id": "use", "title": "Building use", "measured": get(mc, "building_use.vlm_accuracy.metric"),
        "method": get(mc, f"{lr}.method"),
        "result": _num(mc, f"{lr}.ward29_heldout.routed", "routed (local model first, VLM when unsure)", n_src=f"{lr}.ward29_heldout.n"),
        "baseline": _num(mc, f"{lr}.ward29_heldout.vlm_only", "every building sent to the VLM", n_src=f"{lr}.ward29_heldout.n"),
        "more": [_num(mc, f"{lr}.ward29_heldout.local_only", "local model only", n_src=f"{lr}.ward29_heldout.n"),
                 _num(mc, f"{lr}.ward29_heldout.escalated", "share sent on to the VLM"),
                 _num(mc, "building_use.vlm_accuracy.value", "VLM on hand-labelled buildings", n_src="building_use.vlm_accuracy.n"),
                 _num(mc, f"{lr}.trichy_unseen.routed", "routed, unseen city (Trichy)", n_src=f"{lr}.trichy_unseen.n")],
        "verdict": (f"Right on {_pct(get(mc, f'{lr}.ward29_heldout.routed'))} of {get(mc, f'{lr}.ward29_heldout.n')} held-out "
                    f"buildings, the same as sending every building to the cloud model ({_pct(get(mc, f'{lr}.ward29_heldout.vlm_only'))}), "
                    f"and {_pct(get(mc, f'{lr}.trichy_unseen.routed'))} of {get(mc, f'{lr}.trichy_unseen.n')} in a city it never saw."),
        "caveat": "Small samples: a few buildings either way move these percentages a lot.", "section": "use"})
    out.append({
        "id": "floors", "title": "Number of floors", "measured": "visible floors vs hand labels, Ward 29",
        "method": get(mc, "floors.method"),
        "result": _num(mc, "floors.ward29.exact", "exactly right", n_src="floors.ward29.n"),
        "baseline": _num(mc, "floors.ward29.baseline_exact", "exactly right before the few-shot prompt", n_src="floors.ward29.n"),
        "more": [_num(mc, "floors.ward29.within_1", "within one floor", n_src="floors.ward29.n"),
                 _num(mc, "floors.trichy_unseen.exact", "exactly right, unseen city (Trichy)", n_src="floors.trichy_unseen.n"),
                 _num(mc, "floors.trichy_unseen.note", "note (Trichy)")],
        "verdict": (f"Exactly right on {_pct(get(mc, 'floors.ward29.exact'))} of {get(mc, 'floors.ward29.n')} buildings and within one "
                    f"floor on {_pct(get(mc, 'floors.ward29.within_1'))}; the plain prompt managed {_pct(get(mc, 'floors.ward29.baseline_exact'))}."),
        "caveat": "Counts behind low roofs or trees are marked as estimates and go to review.", "section": "floors"})
    cl = "names.crop_level_n31"
    out.append({
        "id": "names", "title": "Shop names", "measured": "sign crops read correctly vs hand labels",
        "method": get(mc, "ocr.engine") + "; VLM only when OCR is unsure, and a VLM name is kept only if OCR supports it",
        "result": _num(mc, f"{cl}.routed_ocr_then_vlm", "OCR first, VLM when unsure", n=_key_n("crop_level_n31"), n_src=cl),
        "baseline": _num(mc, f"{cl}.all_vlm", "every crop sent to the VLM", n=_key_n("crop_level_n31"), n_src=cl),
        "more": [_num(mc, f"{cl}.ocr_only", "OCR only", n=_key_n("crop_level_n31"), n_src=cl),
                 _num(mc, "names.full_view_n16.routed", "whole photos, routed", n=_key_n("full_view_n16"), n_src="names.full_view_n16"),
                 _num(mc, "names.full_view_n16.cost_ratio", "all-VLM cost vs routed (whole photos)"),
                 _num(mc, "names.google_confirmed.ward29", "names also found on Google (Ward 29)"),
                 _num(mc, "names.vlm_only_names_confirmed", "VLM-only names confirmed")],
        "verdict": (f"Reading signs with OCR first gets {_pct(get(mc, f'{cl}.routed_ocr_then_vlm'))} of {_key_n('crop_level_n31')} "
                    f"sign crops right, better than sending every crop to the cloud model ({_pct(get(mc, f'{cl}.all_vlm'))})."),
        "caveat": "Tamil and partly readable signs are flagged, not trusted.", "section": "names"})
    # D32: use from a readable business sign. A fixed rule, not measured: no model_card number exists, so none is shown.
    out.append({
        "id": "use_sign", "title": "Building use from a shop sign", "measured": "not measured against hand labels",
        "method": "fixed rule: when no clear photo of the building exists, a readable business sign linked to it (not a house "
                  "name plate, not a small plate) counts it as a shop or business; a use decided by a model is never changed",
        "result": {"label": "accuracy", "value": "not measured", "kind": "text", "src": None},
        "baseline": None, "more": [],
        "verdict": "Used only for buildings with no clear photo of their front: a readable shop sign on the building counts it "
                   "as a shop or business.",
        "caveat": "Known limits: adverts/posters can mislead; OCR garble can pass. A random spot-check is planned.",
        "section": "use"})
    pc = "detector.per_class"
    out.append({
        "id": "streetlights", "title": "Streetlight seen / not seen", "measured": get(mc, "detector.test_set"),
        "method": get(mc, "detector.production"),
        "result": _num(mc, f"{pc}.lamp_head.R", "lamp heads found (recall)", n_src=f"{pc}.lamp_head.n"),
        "baseline": _num(mc, f"{pc}.lamp_head.P", "lamp boxes that are real lamps (precision)", n_src=f"{pc}.lamp_head.n"),
        "more": [_num(mc, "streetlights.detector_no_lamp_verdict", "detector 'no lamp' verdicts checked by eye"),
                 _num(mc, "streetlights.vlm_lamp_check", "VLM lamp check (rejected)"),
                 _num(mc, f"{pc}.pole.R", "poles found (recall)", n_src=f"{pc}.pole.n")],
        "verdict": (f"The detector finds {_pct(get(mc, f'{pc}.lamp_head.R'))} of lamp heads in a photo "
                    f"(n={get(mc, f'{pc}.lamp_head.n')}), so a dark stretch means no streetlight was seen, not proof there is none. "
                    "It cannot tell whether a lamp works."),
        "caveat": "Lamps are small in the photo; a missed lamp makes a stretch look darker than it is.", "section": "detector"})
    g = "gate1_position"
    if g in mc:
        gm = mc[g]
        front = (gm.get("vs OSM front-wall centre") or {}).get("ward29") or {}
        cam = "gate1_position.vs OSM front-wall centre.ward29.camera-derived (triangulated + wall_hit)"
        base = "gate1_position.vs OSM front-wall centre.ward29.baseline: footprint centroid for every building (uses the map)"
        card = {"id": "position", "title": "Building position", "measured": f"predicted point vs target ≤ {gm.get('target_m')} m (FarmwiseAI Gate 1)",
                "method": get(mc, "gate1_position.rule.triangulated"),
                "result": _num(mc, "gate1_position.status", "status"),
                "baseline": None, "more": [],
                "verdict": get(mc, "gate1_position.status_note"),
                "caveat": ("Organiser guidance: OpenStreetMap footprints are accepted as the reference; the position is the "
                           "centre of the building's front. The front-wall-centre method is that point by construction, so only "
                           "camera-derived positions are scored here. No surveyed reference exists."),
                "section": "gate1"}
        if "camera-derived (triangulated + wall_hit)" in front:
            card["result"] = _num(mc, f"{cam}.median_m", "camera-derived: median distance to the centre of the OSM front wall",
                                  kind="m", n_src=f"{cam}.n")
            card["more"].append(_num(mc, f"{cam}.within_3_5_m_pct", "camera-derived within 3.5 m of the front-wall centre (%)",
                                     kind="pctn", n_src=f"{cam}.n"))
            card["more"].append(_num(mc, "gate1_position.status", "status"))
            card["baseline"] = _num(mc, f"{base}.median_m", "the footprint centroid: median distance to the front-wall centre",
                                    kind="m", n_src=f"{base}.n")
        out.append(card)
    return out


def experiments(mc):
    """Production vs tried-and-dropped, one lane per topic, in the order the work was done within each lane."""
    if not mc:
        return []
    L = []

    def item(lane, name, status, numbers, why=None, src=None):
        L.append({"lane": lane, "name": name, "status": status, "numbers": numbers, "why": why, "src": src})

    for i, b in enumerate(get(mc, "detector.benchmark")):
        p = f"detector.benchmark.{i}"
        prod = "production" in b["model"]
        status = "production" if prod else ("rejected" if b.get("downstream") else ("replaced" if "old" in b["model"] else "tried"))
        nums = [{"label": "F1", "value": b["F1"], "kind": "num", "src": f"{p}.F1"},
                {"label": "pole recall", "value": b["pole_R"], "kind": "pct", "src": f"{p}.pole_R"},
                {"label": "lamp recall", "value": b["lamp_R"], "kind": "pct", "src": f"{p}.lamp_R"},
                {"label": "CPU ms / view", "value": b["cpu_ms"], "kind": "num", "src": f"{p}.cpu_ms"}]
        item("Detector", b["model"], status, nums, b.get("downstream") or (get(mc, "detector.decision") if prod else None), p)
    item("Floors", "plain prompt (baseline)", "replaced",
         [{"label": "exact", "value": get(mc, "floors.ward29.baseline_exact"), "kind": "pct", "src": "floors.ward29.baseline_exact"}],
         "the few-shot prompt below is more accurate", "floors.ward29.baseline_exact")
    for i, v in enumerate(get(mc, "floors.rejected_variants")):
        item("Floors", v.split(" (")[0], "rejected", [{"label": "result", "value": v, "kind": "text", "src": f"floors.rejected_variants.{i}"}],
             v[v.find("(") + 1:-1] if "(" in v else None, f"floors.rejected_variants.{i}")
    item("Floors", get(mc, "floors.method"), "production",
         [{"label": "exact", "value": get(mc, "floors.ward29.exact"), "kind": "pct", "src": "floors.ward29.exact"},
          {"label": "within 1", "value": get(mc, "floors.ward29.within_1"), "kind": "pct", "src": "floors.ward29.within_1"},
          {"label": "n", "value": get(mc, "floors.ward29.n"), "kind": "num", "src": "floors.ward29.n"}], None, "floors")
    gp = "building_use.google_places_as_use_signal"
    item("Building use", "Google Places type as the use", "rejected",
         [{"label": "accuracy", "value": get(mc, f"{gp}.value"), "kind": "pct", "src": f"{gp}.value"},
          {"label": "n", "value": get(mc, f"{gp}.n"), "kind": "num", "src": f"{gp}.n"}], "less accurate than looking at the photo", gp)
    fr = "building_use.local_router.full_ward29_run"
    item("Building use", "every building to the VLM", "replaced",
         [{"label": "VLM calls", "value": get(mc, f"{fr}.vlm_calls_before"), "kind": "num", "src": f"{fr}.vlm_calls_before"},
          {"label": "accuracy", "value": get(mc, f"{fr}.use_accuracy_before"), "kind": "pct", "src": f"{fr}.use_accuracy_before"}],
         "the local router gives the same accuracy with fewer cloud calls", fr)
    item("Building use", "local router (CLIP) first, VLM when unsure", "production",
         [{"label": "VLM calls", "value": get(mc, f"{fr}.vlm_calls_after"), "kind": "num", "src": f"{fr}.vlm_calls_after"},
          {"label": "accuracy", "value": get(mc, f"{fr}.use_accuracy_after"), "kind": "pct", "src": f"{fr}.use_accuracy_after"},
          {"label": "n", "value": get(mc, f"{fr}.n"), "kind": "num", "src": f"{fr}.n"}], None, fr)
    item("Shop names", "every photo to the VLM", "rejected",
         [{"label": "accuracy", "value": get(mc, "names.full_view_n16.all_vlm_per_view"), "kind": "pct", "src": "names.full_view_n16.all_vlm_per_view"},
          {"label": "cost vs routed", "value": get(mc, "names.full_view_n16.cost_ratio"), "kind": "text", "src": "names.full_view_n16.cost_ratio"}],
         "same accuracy as routing, at many times the cost", "names.full_view_n16")
    item("Shop names", "keep names the VLM read alone", "rejected",
         [{"label": "confirmed", "value": get(mc, "names.vlm_only_names_confirmed"), "kind": "text", "src": "names.vlm_only_names_confirmed"},
          {"label": "invented on non-business crops", "value": get(mc, "names.vlm_invented_names_on_non_business_crops"), "kind": "text",
           "src": "names.vlm_invented_names_on_non_business_crops"}], "VLM names are kept only when OCR supports them", "names")
    item("Shop names", "OCR first, VLM when unsure, OCR gate", "production",
         [{"label": "accuracy", "value": get(mc, "names.crop_level_n31.routed_ocr_then_vlm"), "kind": "pct",
           "src": "names.crop_level_n31.routed_ocr_then_vlm"}], None, "names.crop_level_n31")
    item("Streetlights", "VLM checks each lamp", "rejected",
         [{"label": "result", "value": get(mc, "streetlights.vlm_lamp_check"), "kind": "text", "src": "streetlights.vlm_lamp_check"}],
         "no VLM lamp verdict could be confirmed", "streetlights.vlm_lamp_check")
    item("Streetlights", "detector only", "production",
         [{"label": "'no lamp' verdicts", "value": get(mc, "streetlights.detector_no_lamp_verdict"), "kind": "text",
           "src": "streetlights.detector_no_lamp_verdict"}], None, "streetlights.detector_no_lamp_verdict")
    item("Withheld", "facade condition", "withheld",
         [{"label": "result", "value": get(mc, "withheld.facade_condition"), "kind": "text", "src": "withheld.facade_condition"}],
         "not better than always saying 'good', so never shown as a finding", "withheld.facade_condition")
    item("Withheld", "door numbers", "withheld",
         [{"label": "result", "value": get(mc, "withheld.door_numbers"), "kind": "text", "src": "withheld.door_numbers"}],
         "too imprecise: kept as an unverified field only", "withheld.door_numbers")
    return L


JUMPS = (("buildings_use", ("hood", "routed")), ("use_route", ("hood", "routed")), ("local_router", ("trust", "use")),
         ("triangulated", ("hood", "positions")), ("single_camera", ("hood", "positions")), ("floors.validated", ("trust", "floors")),
         ("streetlight_gaps", ("explore", "gaps")))


def _jump(field):
    for k, (page, section) in JUMPS:
        if k in field:
            return {"page": page, "section": section}
    return {"page": "hood", "section": "story"}


def consistency(bundles, files, model_card):
    """Every stored-vs-computed difference in every area, plus each corrected story sentence."""
    rows = []
    for b in bundles:
        exp = views.export_view(b)
        base = views.consistency(exp, b["run_report"], model_card) + gap_consistency(b["streetlight_gaps"], b.get("gap_display") or {})
        for r in base:
            rows.append({"area": b["slug"], "area_name": b["name"], **r, "jump": _jump(r["field"])})
        for s in hood.hood(b, files.get(b["slug"]), model_card)["corrections"]:
            rows.append({"area": b["slug"], "area_name": b["name"], "field": f"run_report.story ({s['chapter']})", "stored": s["stored"],
                         "computed": s["text"], "source": "run_report.json story[]", "note": s["why"], "kind": s["kind"],
                         "jump": {"page": "hood", "section": "story"}})
    return rows
