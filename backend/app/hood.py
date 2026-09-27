"""Under the Hood (P5, D29): the pipeline story of one area, every number computed.

Sources, never story[] text or meta.run counters (D2):
- the area's records (export.json shape, via the bundle: DB or JSON store, same result);
- the run's own files next to export.json: panos, plan, plan_anomalies, _views_done, detections, ocr, building_views,
  vlm_unmapped (read-only; no images, no model calls).
Stage timings and the run's cost counters come from RESUMED runs: returned only with `representative: false` and the
badge text (D1). Ward 29 (and Trichy's VLM spend) cost comes from model_card.json, labelled as such.

`hood()` returns flat numbers (`n`, each with a source in `src`) plus the structures the page draws (chapters' parts,
Sankey, sign funnel, route splits, per-street table, story with corrections). `examples()` returns up to 3 REAL items
for one step or branch, with the reason they belong there.
"""
import json
import math
import os
import re
import threading
from collections import Counter, defaultdict

from .evidence import view_key

RESUMED_BADGE = "resumed run, not representative"
TIER = {-1: "skipped", 0: "watermark", 1: "no_text", 2: "ocr", 3: "vlm"}
TIER_LABEL = {"skipped": "skipped (CPU fast-mode cap)", "watermark": "Google watermark", "no_text": "no readable text",
              "ocr": "read by OCR", "vlm": "unclear: sent to the VLM"}
GATE = (("full_frame", "box fills the whole photo"), ("top_cut", "roof cut off at the top"),
        ("bottom_cut", "base cut off at the bottom"), ("sliver", "thin sliver at the photo edge"))
GATE_OTHER = "implausibly tall box"
POS_METHODS = ("triangulated", "wall_hit", "footprint_centre")


def gate_reason(q):
    """Why a building box failed the quality gate (the same rule as tools/build_run_report.py); None = usable."""
    if q.get("reliable"):
        return None
    for k, label in GATE:
        if q.get(k):
            return label
    return GATE_OTHER


def _slug_key(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


class RunFiles:
    """The run files of each area, loaded once per file change (small slices only)."""
    NAMES = ("panos", "plan", "plan_anomalies", "_views_done", "detections", "ocr", "building_views", "vlm_unmapped")

    def __init__(self, areas_dir):
        self.dir = areas_dir
        self._cache, self._lock = {}, threading.Lock()

    def get(self, slug):
        folder = os.path.join(self.dir, slug)
        stamp = tuple(os.path.getmtime(os.path.join(folder, f"{n}.json")) if os.path.isfile(os.path.join(folder, f"{n}.json"))
                      else None for n in self.NAMES)
        with self._lock:
            hit = self._cache.get(slug)
        if hit and hit[0] == stamp:
            return hit[1]
        F = {}
        for n in self.NAMES:
            p = os.path.join(folder, f"{n}.json")
            if os.path.isfile(p):
                with open(p, encoding="utf-8") as f:
                    F[n] = json.load(f)
        F["present"] = sorted(k for k in F)
        dets = [{k: d.get(k) for k in ("pano_id", "heading", "pitch", "fov", "cls", "conf", "x1", "y1", "x2", "y2", "geom_ok",
                                       "source", "crop", "street", "footprint_faced")} for d in F.get("detections") or []]
        F["detections"] = dets
        F["ocr"] = [{k: o.get(k) for k in ("file", "fp", "pano_id", "heading", "pitch", "det_conf", "tier", "reason", "best",
                                          "clean", "best_conf")} for o in F.get("ocr") or []]
        with self._lock:
            self._cache[slug] = (stamp, F)
        return F


# ---------------------------------------------------------------------------------------------------------------- facts
OFF_STREET_M = 15.0          # plan.py capture_plan: a panorama farther than this from every street piece is not assigned


def skipped_panoramas(bundle, F):
    """Panoramas the planner did not use, split by its rules: off_street (> 15 m from every analysed street) and
    thinned (on the street, but a stop was already chosen within cfg.thin_m / min_sep_m, or the street piece is
    shorter than cfg.min_seg_m). Returns {pano_id: ("off_street" | "thinned", distance_to_street_m)}."""
    from shapely.geometry import LineString, Point
    panos, plan, anom = F.get("panos") or [], F.get("plan") or [], F.get("plan_anomalies") or []
    if not panos:
        return {}
    lat0 = panos[0]["camera_lat"]
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110540.0
    P = lambda la, lo: (lo * kx, la * ky)
    lines = []
    for st in bundle["streets"]:
        g = st.get("geometry") or {}
        parts = [g["coordinates"]] if g.get("type") == "LineString" else g.get("coordinates") or []
        lines += [LineString([P(q[1], q[0]) for q in part]) for part in parts if len(part) > 1]
    used = {e["pano_id"] for e in plan} | {a["pano_id"] for a in anom}
    out = {}
    for p in panos:
        if p["pano_id"] in used:
            continue
        pt = Point(P(p["camera_lat"], p["camera_lon"]))
        d = min((ln.distance(pt) for ln in lines), default=1e9)
        out[p["pano_id"]] = ("off_street" if d > OFF_STREET_M else "thinned", round(d, 1))
    return out

def _views(plan):
    out = []
    for e in plan:
        for v in e.get("views") or []:
            out.append({"pano_id": e["pano_id"], "heading": v["heading"], "pitch": v.get("pitch") or 0, "fov": v.get("fov") or 90,
                        "side": v.get("side"), "footprint": v.get("footprint"), "street": e.get("street"),
                        "lat": e.get("camera_lat"), "lon": e.get("camera_lon"), "source": e.get("source")})
    return out


def facts(bundle, F, model_card=None):
    """Every countable fact of the story, computed. Returns (n, src): values and where each comes from."""
    B, A, U = bundle["buildings"], bundle["assets"], bundle["unmapped_businesses"]
    G, Q = bundle["streetlight_gaps"], bundle["review_queue"]
    n, src = {}, {}

    def put(key, value, source):
        n[key], src[key] = value, source

    # streets
    streets = bundle["streets"]
    put("streets", len(streets), "streets.json: analysed streets")
    put("streets_m", round(sum(s.get("length_m") or 0 for s in streets)), "streets.json: sum of length_m")
    # panoramas and camera stops
    panos, plan, anom = F.get("panos") or [], F.get("plan") or [], F.get("plan_anomalies") or []
    pano_ids = {p["pano_id"] for p in panos}
    plan_ids, anom_ids = {e["pano_id"] for e in plan}, {a["pano_id"] for a in anom}
    put("panoramas", len(panos), "panos.json: entries")
    put("panoramas_user", sum(p.get("source") == "user" for p in panos), "panos.json: source == 'user'")
    put("panoramas_google", n["panoramas"] - n["panoramas_user"], "panos.json: source == 'google'")
    put("cameras", len(plan), "plan.json: camera stops")
    put("cameras_user", sum(e.get("source") == "user" for e in plan), "plan.json: stops on a user photosphere")
    put("cameras_inside_footprint", sum(a.get("reason") == "camera_inside_footprint" for a in anom),
        "plan_anomalies.json: reason == camera_inside_footprint")
    put("cameras_dropped_other", len(anom) - n["cameras_inside_footprint"], "plan_anomalies.json: other reasons")
    put("panoramas_not_selected", len(pano_ids - plan_ids - anom_ids), "panos.json minus plan.json and plan_anomalies.json stops")
    skip = Counter(k for k, _ in skipped_panoramas(bundle, F).values())
    put("panoramas_off_street", skip.get("off_street", 0), "not used: > 15 m from every analysed street (plan.py assignment rule)")
    put("panoramas_thinned", skip.get("thinned", 0), "not used: on the street but thinned (cfg.thin_m 12 m / min_sep_m 6 m) "
        "or on a street piece < cfg.min_seg_m 25 m")
    # photos (views)
    V = _views(plan)
    put("views", len(V), "plan.json: views of all stops")
    put("views_mapped", sum(v["footprint"] is not None for v in V), "plan.json: views facing a building footprint")
    put("views_unmapped", n["views"] - n["views_mapped"], "plan.json: views with footprint == null")
    put("views_fetched", len(F.get("_views_done") or []), "_views_done.json: views fetched")
    put("views_tilted", sum(bool(v["pitch"]) for v in V), "plan.json: views with pitch > 0")
    # detections
    D = F.get("detections") or []
    by = Counter(d["cls"] for d in D)
    put("boxes", len(D), "detections.json: boxes")
    for c in ("building", "signboard", "pole", "lamp_head"):
        put(f"boxes_{c}", by.get(c, 0), f"detections.json: cls == {c}")
    mapped_view = {view_key(v["pano_id"], v["heading"], v["pitch"], v["fov"]): v["footprint"] is not None for v in V}
    for c in ("building", "signboard", "pole", "lamp_head"):      # which photos the boxes came from (Sankey ribbons)
        on = [mapped_view.get(view_key(d["pano_id"], d["heading"], d["pitch"], d["fov"])) for d in D if d["cls"] == c]
        put(f"boxes_{c}_mapped", sum(x is True for x in on), f"detections.json {c} boxes on views facing a footprint")
        put(f"boxes_{c}_unmapped", sum(x is False for x in on), f"detections.json {c} boxes on views facing no footprint")
    put("boxes_geom_ok", sum(bool(d["geom_ok"]) for d in D), "detections.json: geom_ok")
    put("boxes_tilted", sum((not d["geom_ok"]) and bool(d["pitch"]) for d in D), "detections.json: not geom_ok, pitch > 0")
    put("boxes_user", sum((not d["geom_ok"]) and not d["pitch"] for d in D), "detections.json: not geom_ok, user photosphere")
    # signs
    O = F.get("ocr") or []
    t = Counter(TIER.get(o.get("tier"), str(o.get("tier"))) for o in O)
    put("sign_crops", len(O), "ocr.json: sign crops")
    for k in ("ocr", "vlm", "no_text", "watermark", "skipped"):
        put(f"signs_{k}", t.get(k, 0), f"ocr.json: tier == {k}")
    put("signs_read", n["signs_ocr"] + n["signs_vlm"], "ocr.json: tier 2 (OCR) + tier 3 (sent to the VLM)")
    names = [(b.get("attributes") or {}).get("name") or {} for b in B]
    named = [x for x in names if x.get("value")]
    put("named", len(named), "export.json buildings[].attributes.name.value")
    put("named_good", sum(x.get("quality") == "good" for x in named), "name.quality == good")
    put("named_google", sum(bool(x.get("google_confirmed")) for x in named), "name.google_confirmed")
    for r in ("tier2_ocr", "tier3_vlm+ocr_gate", "tier3_vlm_unverified"):
        put(f"name_route_{_slug_key(r)}", sum(x.get("route") == r for x in named), f"name.route == {r}")
    vu = F.get("vlm_unmapped") or {}
    put("unmapped_checked", len(vu), "vlm_unmapped.json: sign candidates the VLM checked")
    put("unmapped_not_business", sum(not (v.get("is_sign") and v.get("sign_type") == "business") for v in vu.values()),
        "vlm_unmapped.json: not a business sign")
    put("unmapped_kept", len(U), "export.json unmapped_businesses[]")
    # buildings: views, use, floors
    bv = {q["fp"]: q for q in F.get("building_views") or []}
    ids = [b["id"] for b in B]
    put("buildings", len(B), "export.json buildings[]")
    put("buildings_with_box", sum(i in bv for i in ids), "buildings with a row in building_views.json")
    put("buildings_usable", sum(i in bv and bv[i].get("reliable") for i in ids), "building_views.json: reliable")
    put("buildings_no_box", n["buildings"] - n["buildings_with_box"], "buildings with no building box in any view")
    put("buildings_rejected", n["buildings_with_box"] - n["buildings_usable"], "building box failed the quality gate")
    gate = Counter(gate_reason(bv[i]) for i in ids if i in bv and not bv[i].get("reliable"))
    for _, label in (*GATE, (None, GATE_OTHER)):
        put(f"gate_{_slug_key(label)}", gate.get(label, 0), f"building_views.json quality flags: {label}")
    put("footprints_unregistered_with_box", len(set(bv) - set(ids)), "building_views.json rows for footprints not in the export")
    attr = lambda b, k: (b.get("attributes") or {}).get(k) or {}
    ur = Counter(attr(b, "use").get("route") for b in B)
    put("use_local", ur.get("tier1_local_clip", 0), "use.route == tier1_local_clip")
    put("use_vlm", ur.get("tier3_vlm", 0), "use.route == tier3_vlm")
    put("use_sign", ur.get("sign_text", 0), "use.route == sign_text (readable business sign, D32)")
    put("use_unknown", sum(attr(b, "use").get("value") is None for b in B), "use.value is null (D9)")
    fs = Counter(attr(b, "floors").get("status") for b in B)
    for k in ("measured", "low_confidence", "not_measured"):
        put(f"floors_{k}", fs.get(k, 0), f"floors.status == {k}")
    uv = Counter(attr(b, "use").get("value") or "not classified" for b in B)
    n["use_values"], src["use_values"] = dict(uv), "use.value per building"
    # positions
    am = Counter((a.get("type"), a.get("method") == "triangulated") for a in A)
    put("assets", len(A), "export.json assets[]")
    put("streetlights", sum(a.get("type") == "streetlight" for a in A), "assets[].type == streetlight")
    put("poles", sum(a.get("type") == "pole" for a in A), "assets[].type == pole")
    put("assets_triangulated", sum(a.get("method") == "triangulated" for a in A), "assets[].method == triangulated")
    put("assets_approximate", n["assets"] - n["assets_triangulated"], "assets[].method != triangulated")
    put("assets_2plus_cameras", sum((a.get("cameras_used") or 0) >= 2 for a in A), "assets[].cameras_used >= 2")
    for ty in ("streetlight", "pole"):
        put(f"{ty}_triangulated", am.get((ty, True), 0), f"{ty}s with method == triangulated")
        put(f"{ty}_approximate", am.get((ty, False), 0), f"{ty}s with another method")
    pp = [b.get("predicted_position") or {} for b in B]
    pm = Counter(p.get("method") for p in pp)
    for m in POS_METHODS:
        put(f"pos_{m}", pm.get(m, 0), f"buildings[].predicted_position.method == {m}")
    put("pos_rejected", sum(bool(p.get("reason")) for p in pp), "predicted_position.reason set (triangulation rejected)")
    put("pos_none", sum(not p for p in pp), "no predicted_position")
    # matching and findings
    ms = Counter(b.get("match_status") for b in B)
    for k in ("matched", "discrepancy", "no_record"):
        put(f"match_{k}", ms.get(k, 0), f"buildings[].match_status == {k}")
    put("matched_use_unknown", sum(b.get("match_status") == "matched" and attr(b, "use").get("value") is None for b in B),
        "matched, but use not known (so use was not compared)")
    dt = Counter(d for b in B for d in b.get("discrepancies") or [] if d != "missing_record")
    n["discrepancy_types"], src["discrepancy_types"] = dict(dt), "buildings[].discrepancies"
    put("gaps", len(G), "export.json streetlight_gaps[] (60 m)")
    put("gaps_m", round(sum(g.get("length_m") or 0 for g in G)), "sum of recorded streetlight_gaps[].length_m")
    put("review_items", len(Q), "review queue items")
    put("review_waiting", sum(q.get("status") == "pending" for q in Q), "review items still waiting")
    return n, src


# ------------------------------------------------------------------------------------------------------ structures
def sankey(n):
    """Pipeline flow. Each column has its own unit (panoramas, photos, boxes, results); ribbons show which part of one
    column feeds the next. `drop` segments are branches that leave the pipeline, with a reason and examples."""
    def seg(id, label, value, kind="kept", ex=None, reason=None):
        return {"id": id, "label": label, "value": value, "kind": kind, "examples": ex, "reason": reason}
    cols = [
        {"unit": "panoramas", "title": "Street View panoramas", "segments": [
            seg("stops", "chosen as camera stops", n["cameras"], ex="cameras.kept"),
            seg("off_street", "not on an analysed street", n["panoramas_off_street"], "idle", ex="panos.off_street",
                reason="more than 15 m from every analysed street (side lanes, junctions)"),
            seg("thinned", "on the street, thinned", n["panoramas_thinned"], "idle", ex="panos.thinned",
                reason="a camera stop was already chosen a few metres away (stops are kept at least 12 m apart along the road)"),
            seg("inside", "camera inside a building outline", n["cameras_inside_footprint"], "drop", ex="cameras.inside",
                reason="the camera point falls inside a mapped building, so its directions are unreliable")]},
        {"unit": "photos", "title": "Photos (views)", "segments": [
            seg("mapped", "face a mapped building", n["views_mapped"], ex="views.mapped"),
            seg("unmapped", "map has no building outline", n["views_unmapped"], "idle", ex="views.unmapped",
                reason="no OpenStreetMap outline there: lights and signs are still analysed")]},
        {"unit": "boxes", "title": "Detector boxes", "segments": [
            seg("building", "building", n["boxes_building"], ex="det.building"),
            seg("signboard", "sign", n["boxes_signboard"], ex="det.signboard"),
            seg("pole", "pole", n["boxes_pole"], ex="det.pole"),
            seg("lamp_head", "lamp head", n["boxes_lamp_head"], ex="det.lamp_head")]},
        {"unit": "results", "title": "Results", "groups": [
            {"id": "g_buildings", "from": ["building"], "unit": "buildings", "segments": [
                seg("usable", "usable view: use and floors", n["buildings_usable"], ex="bld.usable"),
                seg("rejected", "box failed the quality gate", n["buildings_rejected"], "drop", ex="bld.rejected",
                    reason="sliver at the edge, roof or base cut off, whole-photo or implausible box"),
                seg("no_box", "no building box in any photo", n["buildings_no_box"], "drop", ex="bld.no_box",
                    reason="no level photo showed a building box for this outline")]},
            {"id": "g_signs", "from": ["signboard"], "unit": "sign crops", "segments": [
                seg("read", "text read (OCR or VLM)", n["signs_read"], ex="signs.ocr"),
                seg("no_text", "no readable text", n["signs_no_text"], "drop", ex="signs.no_text", reason="OCR found no name-like text"),
                seg("watermark", "Google watermark", n["signs_watermark"], "drop", ex="signs.watermark",
                    reason="the box was Google's own imagery watermark"),
                seg("skipped", "skipped (fast-mode cap)", n["signs_skipped"], "drop", ex=None, reason="CPU fast mode reads the best 3 crops per building")]},
            {"id": "g_assets", "from": ["pole", "lamp_head"], "unit": "poles and streetlights", "segments": [
                seg("triangulated", "triangulated (2+ cameras)", n["assets_triangulated"], ex="assets.triangulated"),
                seg("approximate", "approximate (one camera)", n["assets_approximate"], "drop", ex="assets.approximate",
                    reason="seen from one camera position: position is an estimate and goes to review")]}]},
    ]
    for c in cols:
        for g in c.get("groups", [c]):
            g["segments"] = [s for s in g["segments"] if s["value"] or s["kind"] == "kept"]
    return {"columns": cols}


def sign_funnel(n):
    return [
        {"key": "crops", "label": "sign boxes cropped", "value": n["sign_crops"], "unit": "crops", "examples": "signs.all"},
        {"key": "read", "label": "text read (OCR, or OCR then VLM)", "value": n["signs_read"], "unit": "crops", "examples": "signs.ocr"},
        {"key": "named", "label": "buildings given a name", "value": n["named"], "unit": "buildings", "examples": "names.named"},
        {"key": "good", "label": "name read clearly", "value": n["named_good"], "unit": "buildings", "examples": "names.good"},
        {"key": "google", "label": "also found on Google Maps", "value": n["named_google"], "unit": "buildings", "examples": "names.google"},
    ]


def per_street(bundle, F):
    plan = F.get("plan") or []
    cams, views = Counter(e.get("street") for e in plan), Counter()
    for e in plan:
        views[e.get("street")] += len(e.get("views") or [])
    rows = []
    for s in bundle["streets"]:
        keys = {s["name"], s.get("osm_name")} - {None}
        on = lambda xs: [x for x in xs if x.get("street") == s["name"]]
        Bs, As, Gs = on(bundle["buildings"]), on(bundle["assets"]), on(bundle["streetlight_gaps"])
        rows.append({"street": s["name"], "length_m": round(s.get("length_m") or 0),
                     "cameras": sum(cams.get(k, 0) for k in keys), "views": sum(views.get(k, 0) for k in keys),
                     "buildings": len(Bs), "no_record": sum(b.get("match_status") == "no_record" for b in Bs),
                     "discrepancy": sum(b.get("match_status") == "discrepancy" for b in Bs),
                     "use_unknown": sum(((b.get("attributes") or {}).get("use") or {}).get("value") is None for b in Bs),
                     "streetlights": sum(a.get("type") == "streetlight" for a in As), "poles": sum(a.get("type") == "pole" for a in As),
                     "gaps": len(Gs), "gap_m": round(sum(g.get("length_m") or 0 for g in Gs))})
    return sorted(rows, key=lambda r: -r["length_m"])


def _pl(k, one, many=None):
    return f"{k:,} {one if k == 1 else (many or one + 's')}"


def story(n, verdict, stored):
    """The run report's nine sentences, rebuilt from computed numbers (same wording, singular/plural fixed). Each
    sentence carries the stored text and, when different, why it changed."""
    sent = [
        (f"Found {_pl(n['panoramas'], 'Street View panorama')} ({_pl(n['panoramas_user'], 'user photosphere')}, excluded from geometry).",
         "panoramas"),
        (f"Planned {_pl(n['cameras'], 'camera stop')} and {_pl(n['views'], 'view')} instead of a full 12-heading sweep.", "cameras"),
        (f"{_pl(n['views_unmapped'], 'view')} {'faces' if n['views_unmapped'] == 1 else 'face'} frontage with no building outline in OSM"
         + (f" — map coverage verdict: {verdict}." if verdict else "."), "views"),
        (f"The detector drew {_pl(n['boxes'], 'box', 'boxes')}; {n['boxes_geom_ok']:,} {'was' if n['boxes_geom_ok'] == 1 else 'were'} usable for positioning.",
         "boxes"),
        (f"Located {_pl(n['assets'], 'pole/streetlight', 'poles/streetlights')}; {n['assets_triangulated']:,} triangulated from 2+ cameras, "
         f"{n['assets_approximate']:,} approximate (single camera).", "positions"),
        (f"{_pl(n['buildings'], 'building')} registered; {n['buildings_usable']:,} had a usable view for use/floors, "
         f"{n['buildings_no_box']:,} had no building box at all.", "buildings"),
        (f"{_pl(n['sign_crops'], 'sign crop')}: {n['signs_ocr']:,} read locally, {n['signs_vlm']:,} escalated; "
         f"{_pl(n['named'], 'building')} named, {n['named_google']:,} confirmed by Google.", "signs"),
        (f"{_pl(n['unmapped_kept'], 'business', 'businesses')} found on unmapped frontage (approximate points).", "unmapped"),
        (f"{_pl(n['review_items'], 'item')} sent to human review.", "review"),
    ]
    why = {
        "positions": "The stored sentence counts assets seen by 2+ cameras ({s2}); only {t} were actually triangulated (position "
                     "method), the rest fell back to a single-camera estimate.",
        "buildings": "The stored sentence counted rows of building_views.json, which include {u} footprints that are not "
                     "registered buildings; counted per registered building instead.",
    }
    out = []
    for i, (text, chapter) in enumerate(sent):
        old = stored[i] if i < len(stored) else None
        norm = lambda s: re.sub(r"[\s,]", "", s or "")
        changed = old is not None and norm(old) != norm(text)
        nums_old = re.findall(r"\d[\d,]*", old or "")
        nums_new = re.findall(r"\d[\d,]*", text)
        numbers_changed = [x.replace(",", "") for x in nums_old] != [x.replace(",", "") for x in nums_new]
        reason = None
        if changed:
            reason = why.get(chapter, "").format(s2=n["assets_2plus_cameras"], t=n["assets_triangulated"],
                                                  u=n["footprints_unregistered_with_box"]) if numbers_changed else None
            reason = reason or ("numbers recomputed from the records" if numbers_changed else "singular / plural wording")
        out.append({"chapter": chapter, "text": text, "stored": old, "changed": changed,
                    "kind": None if not changed else ("numbers" if numbers_changed else "wording"), "why": reason})
    return out


def cost(bundle, n, model_card):
    """D1: the stored runs' timings and cost counters are from resumed runs. What can be stated: model_card figures
    (Ward 29; Trichy's VLM spend), and counts from the records (VLM calls per building; calls with no recorded cost)."""
    run = bundle["meta"].get("run") or {}
    mc = model_card or {}
    ct = mc.get("cost_time") or {}
    price = ct.get("street_view_price_usd_per_image")
    B = bundle["buildings"]
    calls = sum(((b.get("cost") or {}).get("vlm_calls") or 0) for b in B)
    usd = sum(((b.get("cost") or {}).get("vlm_usd") or 0) for b in B)
    unrecorded = sum(1 for b in B if ((b.get("cost") or {}).get("vlm_calls") or 0) > 0 and not (b.get("cost") or {}).get("vlm_usd"))
    ward = bundle["slug"] == "ward29"
    gen = ((mc.get("generalisation") or {}).get(bundle["slug"]) or {})
    lines = [
        {"key": "street_view", "label": "Street View photos", "value": round(n["views_fetched"] * price, 2) if price else None,
         "detail": f"{n['views_fetched']:,} photos × ${price} per image", "source": "computed: _views_done.json × model_card price",
         "status": "computed" if price else "not recorded"},
        {"key": "vlm", "label": "Vision-language model (VLM) calls",
         "value": ct.get("ward29_vlm_usd_with_router") if ward else gen.get("vlm_usd"),
         "detail": ("with the local router; without it $" + str(ct.get("ward29_vlm_usd_without_router"))) if ward else
                   ("Trichy run" if gen.get("vlm_usd") is not None else "cost not recorded"),
         "source": "model_card.cost_time" if ward else ("model_card.generalisation" if gen.get("vlm_usd") is not None else None),
         "status": "model_card" if (ward or gen.get("vlm_usd") is not None) else "not recorded"},
        {"key": "places", "label": "Google Places look-ups", "value": None, "detail": "cost not recorded",
         "source": None, "status": "not recorded"},
    ]
    return {"lines": lines,
            "model_card": {"gpu_minutes": ct.get("ward29_full_run_gpu_minutes"), "source": "model_card.cost_time"} if ward else None,
            "records": {"vlm_calls": calls, "vlm_usd_recorded": round(usd, 6), "buildings_cost_not_recorded": unrecorded,
                        "source": "export.json buildings[].cost"},
            "run_counters": {"vlm_calls": run.get("vlm_calls"), "vlm_cost_usd": run.get("vlm_cost_usd"),
                             "street_view_requests": run.get("street_view_requests"), "places_calls": run.get("places_calls"),
                             "representative": False, "badge": RESUMED_BADGE},
            "timings": {"stage_seconds": run.get("stage_seconds") or {}, "total_minutes": run.get("total_minutes"),
                        "device": run.get("device"), "representative": False, "badge": RESUMED_BADGE}}


def hood(bundle, F, model_card=None):
    n, src = facts(bundle, F, model_card)
    cov = (bundle["meta"].get("run") or {}).get("coverage") or {}
    verdict = cov.get("verdict") or ((bundle.get("run_report") or {}).get("maps") or {}).get("verdict")
    share = round(n["views_unmapped"] / n["views"], 3) if n["views"] else None
    stored_story = (bundle.get("run_report") or {}).get("story") or []
    st = story(n, verdict, stored_story)
    return {"area": bundle["slug"], "name": bundle["name"], "files": F.get("present", []), "n": n, "src": src,
            "pipeline": bundle["meta"].get("pipeline") or {},
            "coverage": {"level": "full" if (verdict or "").startswith("full") else "partial" if verdict else None,
                         "verdict": verdict, "share_views_unmapped": share, "views": n["views"], "views_unmapped": n["views_unmapped"],
                         "buildings": n["buildings"], "unmapped_kept": n["unmapped_kept"]},
            "sankey": sankey(n), "sign_funnel": sign_funnel(n),
            "routes": {"use": {"local": n["use_local"], "vlm": n["use_vlm"], "sign": n["use_sign"], "unknown": n["use_unknown"]},
                       "names": {"ocr": n["name_route_tier2_ocr"], "vlm_gate": n["name_route_tier3_vlm_ocr_gate"],
                                 "vlm_only": n["name_route_tier3_vlm_unverified"]}},
            "streets": per_street(bundle, F), "story": st,
            "corrections": [s for s in st if s["changed"]], "cost": cost(bundle, n, model_card)}


# ------------------------------------------------------------------------------------------------------ examples
def _spread(xs, k=3):
    """k items spread over a stably ordered list (first, middle, last …), so examples are not all from one street."""
    if len(xs) <= k:
        return list(xs)
    return [xs[round(i * (len(xs) - 1) / (k - 1))] for i in range(k)]


def _box(d, target=True):
    return {"cls": d["cls"], "conf": round(float(d["conf"]), 3), "x1": d["x1"], "y1": d["y1"], "x2": d["x2"], "y2": d["y2"],
            "geom_ok": bool(d.get("geom_ok")), "target": target}


def _photo(v, boxes, title, reason, facts=None):
    return {"kind": "photo", "title": title, "reason": reason, "facts": facts or [],
            "view": {"pano_id": v["pano_id"], "heading": v["heading"], "pitch": v.get("pitch") or 0, "fov": v.get("fov") or 90},
            "boxes": boxes}


def _ref(kind, obj, reason, title=None):
    return {"kind": kind, "id": obj["id"], "title": title or obj.get("street") or obj["id"], "reason": reason}


def _map(title, reason, points=(), facts=None):
    return {"kind": "map", "title": title, "reason": reason, "points": list(points), "facts": facts or []}


EXAMPLE_KEYS = ("streets", "cameras.kept", "cameras.inside", "panos.not_selected", "panos.off_street", "panos.thinned", "views.mapped", "views.unmapped",
                "det.building", "det.signboard", "det.pole", "det.lamp_head", "det.tilted", "det.user",
                "signs.all", "signs.ocr", "signs.vlm", "signs.no_text", "signs.watermark",
                "use.local", "use.vlm", "use.sign", "use.unknown", "names.named", "names.good", "names.google",
                "names.ocr", "names.vlm_gate", "names.vlm_only",
                "floors.measured", "floors.low_confidence", "floors.not_measured",
                "bld.usable", "bld.rejected", "bld.no_box", "assets.triangulated", "assets.approximate",
                "pos.triangulated", "pos.wall_hit", "pos.footprint_centre", "pos.rejected",
                "match.matched", "match.discrepancy", "match.no_record", "gaps", "unmapped.kept")


def examples(bundle, F, key):
    """Up to 3 real items for a step or branch of the story, each with the reason it is there. None = unknown key."""
    if key not in EXAMPLE_KEYS:
        return None
    B, A = bundle["buildings"], bundle["assets"]
    attr = lambda b, k: (b.get("attributes") or {}).get(k) or {}
    D = F.get("detections") or []
    by_view = defaultdict(list)
    for d in D:
        by_view[view_key(d["pano_id"], d["heading"], d["pitch"], d["fov"])].append(d)
    plan = F.get("plan") or []
    V = _views(plan)
    head, grp = key.split(".")[0], key.split(".", 1)[-1]
    disp = {s.get("osm_name") or s["name"]: s["name"] for s in bundle["streets"]}
    nm = lambda raw: disp.get(raw, raw) if raw and not raw.startswith("(unnamed") else disp.get(raw, "Unnamed road")
    side = lambda x: (x or "").replace("_unmapped", ", no outline").replace("_", " ")
    cam = {p["pano_id"]: (p["camera_lat"], p["camera_lon"]) for p in F.get("panos") or []}
    T = "tech"                                   # facts flagged "tech" are developer detail: shown in Technical only (H3)

    def rays_of(views):
        """camera position + direction for each evidence view whose panorama position is known"""
        out = []
        for v in views or []:
            c = cam.get(v.get("pano_id"))
            if c:
                out.append({"lat": c[0], "lon": c[1], "heading": v.get("heading"), "fov": v.get("fov") or 90})
        return out

    def view_photo(v, reason, title, target=None):
        boxes = [_box(d, target=d is target) for d in sorted(by_view.get(view_key(v["pano_id"], v["heading"], v["pitch"], v["fov"]), []),
                                                              key=lambda d: -d["conf"])]
        return _photo(v, boxes, title, reason)

    if key == "streets":
        S = sorted(bundle["streets"], key=lambda s: -(s.get("length_m") or 0))
        return [_map(s["name"], f"{round(s.get('length_m') or 0):,} m analysed", facts=[["OSM name", s.get("osm_name") or s["name"], T]],
                     points=[]) | {"street": s["name"]} for s in _spread(S)]
    if key == "cameras.kept":
        out = []
        for e in _spread(plan):
            level = [v for v in e.get("views") or [] if not v.get("pitch")]
            dirs = {round(v["heading"]) for v in level}
            fps = sorted({v["footprint"] for v in level if v.get("footprint")})
            out.append(_map(nm(e.get("street")) or "camera stop",
                            f"camera stop photographing the frontage in {len(dirs)} {'direction' if len(dirs) == 1 else 'directions'} "
                            f"({len(e.get('views') or [])} photos, incl. tilted ones for rooflines); "
                            f"{len(fps)} mapped {'building' if len(fps) == 1 else 'buildings'} faced",
                            [{"lat": e["camera_lat"], "lon": e["camera_lon"], "label": "camera"}],
                            [["panorama", e["pano_id"], T], ["road bearing", f"{e.get('road_bearing')}°", T],
                             ["views", ", ".join(f"{v['side']} {v['heading']}°" for v in level), T]])
                       | {"rays": [{"lat": e["camera_lat"], "lon": e["camera_lon"], "heading": v["heading"], "fov": v.get("fov") or 90,
                                    "faces": v.get("footprint")} for v in level], "footprints": fps})
        return out
    if key == "cameras.inside":
        return [_map(nm(a.get("street")) or "dropped stop", "the camera point falls inside a mapped building outline, so the "
                     "planner dropped it", [{"lat": a["lat"], "lon": a["lon"], "label": "dropped camera", "drop": True}],
                     [["panorama", a["pano_id"], T], ["reason", a.get("reason"), T]]) | {"inside": True}
                for a in _spread(F.get("plan_anomalies") or [])]
    if head == "panos":
        sk = skipped_panoramas(bundle, F)
        P = [p for p in F.get("panos") or [] if p["pano_id"] in sk and (grp == "not_selected" or sk[p["pano_id"]][0] == grp)]
        near = lambda p, e: math.hypot((p["camera_lon"] - e["camera_lon"]) * 111320 * math.cos(math.radians(p["camera_lat"])),
                                       (p["camera_lat"] - e["camera_lat"]) * 110540)
        out = []
        for p in _spread(P):
            stops = sorted(plan, key=lambda e: near(p, e))[:3]
            kind, dist = sk[p["pano_id"]]
            why = (f"{round(dist)} m from the nearest analysed street, so the planner did not assign it to any street" if kind == "off_street"
                   else f"on the street, but a camera stop {round(near(p, stops[0]))} m away was already chosen "
                        "(stops are kept at least 12 m apart along the road)" if stops and near(p, stops[0]) <= 13
                   else f"on the street, but the planner thinned it: it lies on a street piece shorter than 25 m or within 12 m "
                        f"along the road of an earlier stop (nearest chosen stop {round(near(p, stops[0])) if stops else '?'} m away)")
            out.append(_map("panorama not used", why,
                            [{"lat": p["camera_lat"], "lon": p["camera_lon"], "label": "panorama not used", "drop": True}]
                            + [{"lat": e["camera_lat"], "lon": e["camera_lon"], "label": "camera stop"} for e in stops],
                            [["photo date", p.get("date")], ["panorama", p["pano_id"], T], ["source", p.get("source"), T]]))
        return out
    if head == "views":
        mapped = grp == "mapped"
        vs = [v for v in V if (v["footprint"] is not None) == mapped and not v["pitch"]]
        out = []
        for v in _spread(vs):
            ph = view_photo(v, "a planned photo facing a building that is on the map" if mapped else
                            "a planned photo where the map has no building outline: poles, lamps and signs are still read here, "
                            "but no building can be checked", f"{nm(v['street'])} · {side(v['side'])}")
            ph["rays"] = [{"lat": v["lat"], "lon": v["lon"], "heading": v["heading"], "fov": v["fov"], "faces": v["footprint"]}]
            ph["points"] = [{"lat": v["lat"], "lon": v["lon"], "label": "camera"}]
            ph["footprints"] = [v["footprint"]] if v["footprint"] else []
            out.append(ph)
        return out
    if head == "det":
        if grp in ("tilted", "user"):
            ds = [d for d in D if not d["geom_ok"] and bool(d["pitch"]) == (grp == "tilted")]
            why = ("tilted photo (looking up at the roofline): directions are not level, so this box is not used for positions"
                   if grp == "tilted" else "user-uploaded photosphere: its camera geometry is not reliable, so this box is not used for positions")
        else:
            ds = sorted((d for d in D if d["cls"] == grp and d["geom_ok"]), key=lambda d: -d["conf"])
            why = f"{grp.replace('_', ' ')} box, detector confidence shown on the box"
        out = []
        for d in _spread(ds):
            v = {"pano_id": d["pano_id"], "heading": d["heading"], "pitch": d["pitch"], "fov": d["fov"]}
            out.append(view_photo(v, why, f"{nm(d.get('street'))} · {d['cls'].replace('_', ' ')} {round(d['conf'] * 100)}%", target=d))
        return out
    if head == "signs":
        O = F.get("ocr") or []
        want = {"all": None, "ocr": 2, "vlm": 3, "no_text": 1, "watermark": 0}[grp]
        rows = [o for o in O if want is None or o.get("tier") == want]
        by_crop = {os.path.basename(d["crop"]): d for d in D if d.get("crop")}
        out = []
        for o in _spread(rows):
            d = by_crop.get(os.path.basename(o.get("file") or ""))
            v = {"pano_id": o["pano_id"], "heading": o["heading"], "pitch": o.get("pitch") or 0, "fov": (d or {}).get("fov") or 90}
            text = o.get("best") or o.get("clean") or ""
            tier = TIER.get(o.get("tier"), "?")
            reason = {"ocr": "OCR read the sign locally (no cloud call)", "vlm": "OCR was unsure, so the crop went to the VLM",
                      "no_text": "OCR found no name-like text", "watermark": "Google's watermark, not a real sign"}.get(tier, TIER_LABEL.get(tier, tier))
            ph = view_photo(v, reason, f"sign · {TIER_LABEL.get(tier, tier)}", target=d)
            if d is None:
                ph["note"] = "the crop's box is not stored for this view"
            ph["facts"] = [["OCR text", text or "—"], ["OCR confidence", o.get("best_conf"), T], ["pipeline reason", (o.get("reason") or "").replace("_", " "), T]]
            out.append(ph)
        return out
    pick = None
    if head == "use":
        route = {"local": "tier1_local_clip", "vlm": "tier3_vlm", "sign": "sign_text"}.get(grp)
        pick = [b for b in B if attr(b, "use").get("route") == route] if route else [b for b in B if attr(b, "use").get("value") is None]
        why = {"local": "use decided by the local model (CLIP + logistic regression), no cloud call",
               "vlm": "the local model was unsure, so the VLM decided the use",
               "sign": "no clear photo of the building, but a readable business sign is linked to it, so it counts as a business",
               "unknown": "no usable photo of this building, so its use is not known (shown, never hidden)"}[grp]
        return [_ref("building", b, why) for b in _spread(pick)]
    if head == "names":
        sel = {"named": lambda x: bool(x.get("value")), "good": lambda x: x.get("quality") == "good",
               "google": lambda x: bool(x.get("google_confirmed")), "ocr": lambda x: x.get("route") == "tier2_ocr",
               "vlm_gate": lambda x: x.get("route") == "tier3_vlm+ocr_gate", "vlm_only": lambda x: x.get("route") == "tier3_vlm_unverified"}[grp]
        why = {"named": "a sign name was kept for this building", "good": "the name was read clearly",
               "google": "a Google place with the same name is within 40 m", "ocr": "name read by OCR alone",
               "vlm_gate": "the VLM read the name and OCR supports it (gate 0.7)",
               "vlm_only": "only the VLM read this name; OCR does not support it, so it goes to review"}[grp]
        return [_ref("building", b, why, (attr(b, "name").get("value") or b["id"])) for b in _spread([b for b in B if sel(attr(b, "name"))])]
    if head == "floors":
        why = {"measured": "floor count read from a photo showing the roofline",
               "low_confidence": "floor count is an estimate: the roofline was not clearly visible",
               "not_measured": "no usable photo, so floors were not measured"}[grp]
        return [_ref("building", b, why) for b in _spread([b for b in B if attr(b, "floors").get("status") == grp])]
    if head == "bld":
        bv = {q["fp"]: q for q in F.get("building_views") or []}
        if grp == "no_box":
            return [_ref("building", b, "no level photo showed a building box for this outline: the map shows the outline and the "
                         "cameras that looked towards it") | {"map": True, "rays": rays_of((b.get("evidence") or {}).get("views"))}
                    for b in _spread([b for b in B if b["id"] not in bv])]
        rows = [(b, bv[b["id"]]) for b in B if b["id"] in bv and bool(bv[b["id"]].get("reliable")) == (grp == "usable")]
        out = []
        for b, q in _spread(rows):
            box = {"cls": "building", "conf": q.get("det_conf") or 0, "x1": q["x1"], "y1": q["y1"], "x2": q["x2"], "y2": q["y2"], "geom_ok": True, "target": True}
            reason = "the building's best box passed the quality gate" if grp == "usable" else f"quality gate: {gate_reason(q)}"
            out.append(_photo(q, [box], b.get("street") or b["id"], reason,
                              [["box width", f"{round((q.get('w_frac') or 0) * 100)}% of the photo"],
                               ["box height", f"{round((q.get('h_frac') or 0) * 100)}% of the photo"], ["building", b["id"], T]]))
        return out
    if head == "assets":
        tri = grp == "triangulated"
        xs = [a for a in A if (a.get("method") == "triangulated") == tri]
        why = "seen from 2+ camera positions; the rays cross at the pole" if tri else "seen from one camera position: an estimate, sent to review"
        return [_ref("asset", a, why) | {"rays": rays_of((a.get("evidence") or {}).get("views"))} for a in _spread(xs)]
    if head == "pos":
        if grp == "rejected":
            xs = [b for b in B if (b.get("predicted_position") or {}).get("reason")]
            return [_ref("building", b, (b["predicted_position"]["reason"])) for b in _spread(xs)]
        why = {"triangulated": "the front wall's two corners were located from 2+ camera positions",
               "wall_hit": "the best camera's line of sight meets the street-facing wall on the map",
               "footprint_centre": "no line of sight reached the front wall: the middle of the outline is used"}[grp]
        return [_ref("building", b, why) for b in _spread([b for b in B if (b.get("predicted_position") or {}).get("method") == grp])]
    if head == "match":
        why = {"matched": "a register entry is within 15 m and agrees", "discrepancy": "the register entry differs (synthetic register)",
               "no_record": "no register entry within 15 m (synthetic register)"}[grp]
        return [_ref("building", b, why) for b in _spread([b for b in B if b.get("match_status") == grp])]
    if key == "gaps":
        G = sorted(bundle["streetlight_gaps"], key=lambda g: -(g.get("length_m") or 0))
        return [{"kind": "gap", "id": g["id"], "title": g.get("street") or g["id"], "reason": f"{round(g.get('length_m') or 0):,} m with no "
                 f"streetlight seen within 60 m ({g.get('gap_type')})", "points": [], "line": [g["start"], g["end"]]} for g in _spread(G)]
    if key == "unmapped.kept":
        return [_ref("unmapped", u, u.get("position") or "business sign on frontage with no building outline", u.get("name") or u["id"])
                for u in _spread(bundle["unmapped_businesses"])]
    return []
