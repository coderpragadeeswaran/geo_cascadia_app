"""Is a re-issued Street View panorama the same image? (D61)

Google re-issues panorama ids: a retired id's replacement 0–5 m away with the same capture month is almost certainly the
same imagery under a new id. Before the analysis' saved boxes are drawn on the replacement, the production detector is
re-run on the replacement photo (same heading / pitch / fov) and its boxes are compared with the saved ones. The rule
below was fixed before any replacement photo was fetched (docs/DECISIONS.md D61) and is not tuned.

Pure Python (no numpy / scipy), so the API's venv stays light; the detector itself runs in its own venv
(tools/detect_photos.py), called by tools/check_photos.py.
"""
import statistics

MIN_PAIR_IOU = 0.10          # below this a pair is not a match
STRONG_CONF = 0.5            # "strong" saved boxes must come back
STRONG_IOU = 0.5
MIN_STRONG = 2               # fewer strong saved boxes: can't tell
MEDIAN_IOU = 0.80
STRONG_RECALL = 0.80
MAX_SHIFT_PX = 6.0
MAX_MOVED_M = 5.0
MAX_VIEWS = 3                # spot-check views tried per panorama


def iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def _xy(b):
    return (float(b["x1"]), float(b["y1"]), float(b["x2"]), float(b["y2"]))


def hungarian_max(w):
    """Maximum-weight one-to-one assignment for a rows × cols weight matrix (lists); [(row, col)] for every row that
    got a column. Kuhn–Munkres on the negated, square-padded matrix (sizes here are a few dozen at most)."""
    n_r, n_c = len(w), (len(w[0]) if w else 0)
    if not n_r or not n_c:
        return []
    n = max(n_r, n_c)
    big = max(max(r) for r in w)
    cost = [[(big - w[i][j]) if i < n_r and j < n_c else big for j in range(n)] for i in range(n)]
    INF = float("inf")
    u, v, p, way = [0.0] * (n + 1), [0.0] * (n + 1), [0] * (n + 1), [0] * (n + 1)
    for i in range(1, n + 1):
        p[0], j0 = i, 0
        minv, used = [INF] * (n + 1), [False] * (n + 1)
        while True:
            used[j0] = True
            i0, delta, j1 = p[j0], INF, 0
            for j in range(1, n + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j], way[j] = cur, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(n + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    return [(p[j] - 1, j - 1) for j in range(1, n + 1) if p[j] and p[j] - 1 < n_r and j - 1 < n_c]


def compare(saved, new):
    """Saved boxes vs the detector's boxes on the replacement photo ({cls, conf, x1..y2} each)."""
    pairs = []                                   # (saved box, new box, iou)
    for cls in sorted({b["cls"] for b in saved} | {b["cls"] for b in new}):
        S = [b for b in saved if b["cls"] == cls]
        N = [b for b in new if b["cls"] == cls]
        w = [[iou(_xy(s), _xy(t)) for t in N] for s in S]
        for i, j in hungarian_max(w):
            if w[i][j] >= MIN_PAIR_IOU:
                pairs.append((S[i], N[j], w[i][j]))
    strong = [b for b in saved if float(b.get("conf") or 0) >= STRONG_CONF]
    strong_hit = sum(1 for s, _t, x in pairs if x >= STRONG_IOU and float(s.get("conf") or 0) >= STRONG_CONF)
    good = [(s, t) for s, t, x in pairs if x >= STRONG_IOU]
    cx = lambda b: (float(b["x1"]) + float(b["x2"])) / 2
    cy = lambda b: (float(b["y1"]) + float(b["y2"])) / 2
    ious = [x for _s, _t, x in pairs]
    return {
        "saved": len(saved), "new": len(new), "matched": len(pairs),
        "missing": len(saved) - len(pairs), "extra": len(new) - len(pairs),
        "median_iou": round(statistics.median(ious), 3) if ious else None,
        "ious": [round(x, 3) for x in ious],
        "strong": len(strong), "strong_recall": round(strong_hit / len(strong), 3) if strong else None,
        "dx": round(statistics.median(cx(t) - cx(s) for s, t in good), 1) if good else None,
        "dy": round(statistics.median(cy(t) - cy(s) for s, t in good), 1) if good else None,
    }


def verdict(m):
    """'same' / 'different' / 'cant_tell' for one photo's comparison, by the fixed rule, with the failed parts."""
    if m["strong"] < MIN_STRONG:
        return "cant_tell", [f"only {m['strong']} saved box(es) with confidence >= {STRONG_CONF}"]
    why = []
    if m["median_iou"] is None or m["median_iou"] < MEDIAN_IOU:
        why.append(f"median IoU {m['median_iou']} < {MEDIAN_IOU}")
    if m["strong_recall"] is None or m["strong_recall"] < STRONG_RECALL:
        why.append(f"strong boxes found again {m['strong_recall']} < {STRONG_RECALL}")
    if m["dx"] is None or abs(m["dx"]) > MAX_SHIFT_PX or abs(m["dy"]) > MAX_SHIFT_PX:
        why.append(f"shift dx {m['dx']} / dy {m['dy']} px (limit {MAX_SHIFT_PX:g})")
    return ("different" if why else "same"), why


def metadata_ok(current, stored_date):
    """The replacement's metadata half of the rule: same capture month and <= MAX_MOVED_M from the old camera."""
    return bool(current and stored_date and current.get("date") == stored_date
                and current.get("moved_m") is not None and current["moved_m"] <= MAX_MOVED_M)


def candidate_views(idx, old_pano):
    """The retired panorama's planned views (the analysis ran the detector on exactly these photos), most saved boxes of
    confidence >= STRONG_CONF first: [(view, saved boxes)] — the spot-check tries the first, then the next."""
    views = {}
    for d in (idx or {}).get("by_pano", {}).get(old_pano, []):
        k = (float(d["heading"]), float(d.get("pitch") or 0), float(d.get("fov") or 90))
        views.setdefault(k, []).append({"cls": d["cls"], "conf": d["conf"], "x1": d["x1"], "y1": d["y1"], "x2": d["x2"], "y2": d["y2"]})
    rows = [({"heading": h, "pitch": p, "fov": f}, bx) for (h, p, f), bx in views.items()]
    strong = lambda bx: sum(1 for b in bx if float(b["conf"]) >= STRONG_CONF)
    return sorted(rows, key=lambda r: (-strong(r[1]), -len(r[1]), r[0]["heading"], r[0]["pitch"]))


GATE_SHARE = 0.90            # go / no-go: share of judged retired panoramas that must pass


def restore_gate(rows):
    """The go / no-go half of the rule, per area: re-issues get their saved boxes back only when >= GATE_SHARE of the
    judged retired panoramas ('same' or 'different') pass. Otherwise none does, even the ones that pass alone."""
    judged = [r for r in rows.values() if r.get("verdict") in ("same", "different")]
    passed = sum(r["verdict"] == "same" for r in judged)
    return {"restore": bool(judged) and passed >= GATE_SHARE * len(judged), "passed": passed, "judged": len(judged),
            "rule": f">= {int(GATE_SHARE * 100)}% of the judged retired panoramas must pass, else none is restored"}


RULE_TEXT = (f"same capture month, <= {MAX_MOVED_M:g} m from the old camera, and the production detector re-run on the "
             f"replacement photo (same heading, pitch and field of view) finds the saved boxes again: median IoU >= "
             f"{MEDIAN_IOU}, >= {int(STRONG_RECALL * 100)}% of the saved boxes with confidence >= {STRONG_CONF} found at IoU >= "
             f"{STRONG_IOU}, no shift over {MAX_SHIFT_PX:g} px; at least {MIN_STRONG} such boxes to judge")
