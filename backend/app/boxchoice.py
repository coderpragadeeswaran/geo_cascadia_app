"""Which detection box is "this building" on a building's evidence photo (D62, M3 "occlusion-aware visible span").

Display only: positions, Gate 1, register matches, review items, reports and every count keep using the analysis' own
box choice. This only decides which box the app draws orange.

Today's rule (the pipeline's building_views) gives a building the box whose CENTRE line of sight hits its outline first.
That picks a wrong box on about a quarter of photos (a small building in front of a big one takes the big one's box; a
compound wall gets the house's box). M3 instead compares the box's horizontal extent with the part of the outline that is
VISIBLE from the camera, after nearer outlines hide what is behind them:
  - one line of sight per 4 px image column (161 per 640 px photo), cast into every outline within 60 m (from 1.5 m out;
    outlines the camera stands in are skipped); the first outline each line meets is what that column sees;
  - the building's visible columns V = columns whose first outline is the building;
  - each building box's columns S = columns between its left and right edge (the nearest column for a sliver);
  - score = |S ∩ V| / |S ∪ V|; the box with the highest score (ties: detector confidence) is the building's,
    unless the best score is below 0.4: then "can't tell".
Parameters frozen in the Part 2 experiment (D61 follow-up, development half only; tested once on a held-out half):
test n = 33, correct 84.8 %, wrong box 12.1 % (today 75.8 % / 24.2 %). No re-tuning here.

Outlines: the same set the run's area stage used (OpenStreetMap, + Microsoft where the run used them), loaded with the
pipeline's own Area around the run's cameras: the cached Overpass answers first, else the app's local copy (D53), else
Overpass. Results go to data/areas/<slug>/box_choice.json (tools/box_choice.py; new worker areas in the background).
"""
import datetime as dt
import hashlib
import json
import math
import os
import pickle
import threading

STEP = 4
COLS = list(range(0, 641, STEP))
MAX_R = 60.0
START_M = 1.5
MIN_OVERLAP = 0.4
PAD_DEG = 0.0007
RULE = ("M3 visible span: per 4 px image column, the first building outline the camera's line of sight meets (60 m, "
        "outlines the camera stands in skipped); the box whose columns best overlap the building's visible columns "
        f"(IoU; ties by detector confidence); none below {MIN_OVERLAP}")
_AREA_LOCK = threading.Lock()


def view_key(pano, heading, pitch, fov):
    return f"{pano}|{round(float(heading), 1)}|{round(float(pitch or 0), 1)}|{int(round(float(fov or 90)))}"


def _source(cache_dir, prev):
    """outline source for this computation: the run-era Overpass cache first, else whatever the process uses (D53)"""
    def src(kind, arg):
        if kind == "overpass":
            p = os.path.join(cache_dir, hashlib.md5(arg.encode()).hexdigest() + ".pkl")
            if os.path.exists(p):
                with open(p, "rb") as f:
                    return pickle.load(f)
        elif kind == "microsoft":
            mnx, mny, mxx, mxy = arg
            cp = os.path.join(os.path.dirname(cache_dir), "ms_cache",
                              hashlib.md5(f"{mnx:.5f},{mny:.5f},{mxx:.5f},{mxy:.5f}".encode()).hexdigest() + ".json")
            if os.path.exists(cp):
                return None                                  # the pipeline reads its own tile cache
        return prev(kind, arg) if prev else None
    return src


def area_for(folder, dets, cache_dir):
    """the pipeline's Area around the run's cameras with the outlines the run used"""
    from shapely.geometry import box as sbox
    import geo_cascadia.area as A
    from geo_cascadia.config import Config
    la = [d["camera_lat"] for d in dets]
    lo = [d["camera_lon"] for d in dets]
    poly = sbox(min(lo) - PAD_DEG, min(la) - PAD_DEG, max(lo) + PAD_DEG, max(la) + PAD_DEG)
    try:
        with open(os.path.join(folder, "coverage.json"), encoding="utf-8") as f:
            ms = ((json.load(f).get("footprints") or {}).get("microsoft") or 0) > 0
    except (OSError, ValueError):
        ms = False
    with _AREA_LOCK:
        prev = A.MAP_SOURCE
        A.MAP_SOURCE = _source(cache_dir, prev)
        try:
            a = A.Area(poly, cache_dir, Config().ray_max_range_m)
            a.load_footprints(ms_fill=ms)
        finally:
            A.MAP_SOURCE = prev
    return a


def first_hits(a, cam, heading, pitch, fov):
    """per image column: the first outline id its line of sight meets (None: nothing within 60 m)"""
    from shapely.geometry import LineString, Point, box as sbox
    from geo_cascadia.geo import pixel_to_bearing
    near = [int(i) for i in a.tree.query(sbox(cam[0] - MAX_R, cam[1] - MAX_R, cam[0] + MAX_R, cam[1] + MAX_R))]
    polys = [(a.fp_ids[i], a.footprints[i]) for i in near]
    P = Point(cam)
    own = {fp for fp, p in polys if p.contains(P)}
    out = []
    for u in COLS:
        r = math.radians(pixel_to_bearing(heading, u, 640, fov))
        ray = LineString([(cam[0] + START_M * math.sin(r), cam[1] + START_M * math.cos(r)),
                          (cam[0] + MAX_R * math.sin(r), cam[1] + MAX_R * math.cos(r))])
        best = None
        for fp, p in polys:
            if fp in own:
                continue
            it = ray.intersection(p)
            if it.is_empty:
                continue
            d = P.distance(it)
            if best is None or d < best[0]:
                best = (d, fp)
        out.append(best[1] if best else None)
    return out


def span(x1, x2):
    s = [i for i, u in enumerate(COLS) if x1 <= u <= x2]
    return s or [min(range(len(COLS)), key=lambda i: abs(COLS[i] - (x1 + x2) / 2))]


def choose(first, target, boxes):
    """M3 on one photo: (the chosen box or None, its score, every box's score)"""
    V = {i for i, fp in enumerate(first) if fp == target}
    scored = []
    for b in boxes:
        S = set(span(b["x1"], b["x2"]))
        scored.append((round(len(S & V) / len(S | V), 3) if S | V else 0.0, b))      # rounded as in the experiment
    if not scored:
        return None, 0.0, []
    s, b = max(scored, key=lambda t: (t[0], t[1]["conf"]))
    return (b if s >= MIN_OVERLAP else None), s, scored


def building_photos(exp, bviews):
    """each building's photo whose orange box is a building box: the attribute view (Front) when it has a stored box,
    else the pipeline's best match (building_views): [(building id, 'attr' | 'best', view, the analysis' box)]"""
    out = []
    for b in exp.get("buildings") or []:
        av = (b.get("evidence") or {}).get("attribute_view")
        if av:
            if all(av.get(k) is not None for k in ("x1", "y1", "x2", "y2")):
                out.append((b["id"], "attr", av, [av[k] for k in ("x1", "y1", "x2", "y2")]))
            continue
        q = bviews.get(b["id"])
        if q:
            out.append((b["id"], "best", q, [q[k] for k in ("x1", "y1", "x2", "y2")]))
    return out


def _iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def compute(folder, cache_dir):
    """box_choice.json content for one area folder (saved run files only; no photo, no model)"""
    rd = lambda n, d=None: json.load(open(os.path.join(folder, n), encoding="utf-8")) if os.path.isfile(os.path.join(folder, n)) else d
    dets, exp = rd("detections.json"), rd("export.json")
    if not dets or not exp:
        return None
    bviews = {q["fp"]: q for q in rd("building_views.json", []) or []}
    a = area_for(folder, dets, cache_dir)
    by_view = {}
    for d in dets:
        by_view.setdefault((d["pano_id"], float(d["heading"]), float(d["pitch"]), float(d["fov"])), []).append(d)
    first_cache, rows = {}, {}
    n = Counter()
    for bid, key, v, abox in building_photos(exp, bviews):
        k = (v["pano_id"], float(v["heading"]), float(v.get("pitch") or 0), float(v.get("fov") or 90))
        ds = by_view.get(k) or []
        bld = [d for d in ds if d["cls"] == "building"]
        vk = view_key(*k)
        if not bld or bid not in a.idx_of:
            rows.setdefault(bid, {})[vk] = {"view": key, "status": "not_computed",
                                            "why": "no building boxes stored" if not bld else "outline not found"}
            n["not_computed"] += 1
            continue
        if k not in first_cache:
            first_cache[k] = first_hits(a, a.L(ds[0]["camera_lat"], ds[0]["camera_lon"]), k[1], k[2], k[3])
        b, s, _ = choose(first_cache[k], bid, bld)
        old = max(bld, key=lambda d: _iou(abox, (d["x1"], d["y1"], d["x2"], d["y2"])))
        same = b is not None and b is old and _iou(abox, (old["x1"], old["y1"], old["x2"], old["y2"])) >= 0.5
        st = "cant_tell" if b is None else "same" if same else "changed"
        n[st] += 1
        rows.setdefault(bid, {})[vk] = {"view": key, "status": st, "score": round(s, 3),
                                        "box": [b["x1"], b["y1"], b["x2"], b["y2"]] if b else None, "analysis_box": abox}
    return {"rule": RULE, "params": {"column_px": STEP, "max_m": MAX_R, "min_overlap": MIN_OVERLAP},
            "computed": dt.date.today().isoformat(), "outlines": len(a.footprints), "counts": dict(n), "buildings": rows}


from collections import Counter  # noqa: E402


def write(folder, cache_dir):
    res = compute(folder, cache_dir)
    if res is None:
        return None
    with open(os.path.join(folder, "box_choice.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, separators=(",", ":"))
    return res


def write_later(folder, cache_dir, log):
    """a new worker area: computed in the background; until it lands the photo shows the analysis' own box"""
    def run():
        try:
            r = write(folder, cache_dir)
            log.info("box choice (D62) for %s: %s", os.path.basename(folder), (r or {}).get("counts"))
        except Exception as e:                                        # noqa: BLE001 - never fails the delivered result
            log.warning("box choice for %s not computed (%s): run tools/box_choice.py", os.path.basename(folder), type(e).__name__)
    threading.Thread(target=run, name="box-choice", daemon=True).start()
