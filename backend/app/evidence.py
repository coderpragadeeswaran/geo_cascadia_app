"""Detection boxes behind an evidence photo (design pass B §2).

Reads the pipeline's own run files next to export.json (data/areas/<slug>/detections.json, ocr.json): every YOLO box
(building, pole, lamp_head, signboard) of every planned 640×640 view, with its confidence. Never images: the browser
fetches the Street View photo itself (§9.6).

- Building and unmapped-business evidence views ARE planned views, so their boxes are the view's own detections; the
  object's box is the one that overlaps the stored box (or, for a sign view, the signboard whose OCR crop matches).
- Asset evidence views are re-aimed at the asset (fov 60, not a planned view). Boxes from the same panorama's planned
  views are projected into the aimed view (same camera centre, pinhole model: exact up to lens distortion) and the
  pole / lamp box nearest the aimed direction is the asset's. With no box in that direction the photo keeps a
  crosshair, labelled as such.
"""
import json
import math
import os
import re
import threading

W = H = 640
CLASSES = ("building", "pole", "lamp_head", "signboard")
IOU_TARGET = 0.5            # stored box ↔ detection box
DEDUP_IOU = 0.45            # the same object seen in two planned views, after projection
AIM_TOL_DEG = {"pole": 6.0, "lamp_head": 12.0}   # asset bearing vs box centre (lamp heads sit on an arm)


def view_key(pano, heading, pitch, fov):
    return f"{pano}|{round(float(heading), 1)}|{round(float(pitch or 0), 1)}|{int(round(float(fov or 90)))}"


def _iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


# ------------------------------------------------------------------ pinhole projection between views of one panorama
def _basis(heading, pitch):
    h, p = math.radians(heading), math.radians(pitch or 0)
    f = (math.sin(h) * math.cos(p), math.cos(h) * math.cos(p), math.sin(p))       # east, north, up
    r = (math.cos(h), -math.sin(h), 0.0)
    u = (-math.sin(h) * math.sin(p), -math.cos(h) * math.sin(p), math.cos(p))
    return f, r, u


def _focal(fov):
    return (W / 2) / math.tan(math.radians(float(fov or 90)) / 2)


def pixel_to_dir(x, y, heading, pitch, fov):
    f, r, u = _basis(heading, pitch)
    F = _focal(fov)
    dx, dy = (x - W / 2) / F, (H / 2 - y) / F
    return tuple(f[i] + dx * r[i] + dy * u[i] for i in range(3))


def dir_to_pixel(d, heading, pitch, fov):
    f, r, u = _basis(heading, pitch)
    fz = sum(d[i] * f[i] for i in range(3))
    if fz <= 1e-6:
        return None                                           # behind the camera
    F = _focal(fov)
    return (W / 2 + F * sum(d[i] * r[i] for i in range(3)) / fz, H / 2 - F * sum(d[i] * u[i] for i in range(3)) / fz)


def project_box(det, dst):
    """A detection box from its planned view into another view of the same panorama (bbox of the projected outline)."""
    xs = (det["x1"], (det["x1"] + det["x2"]) / 2, det["x2"])
    ys = (det["y1"], (det["y1"] + det["y2"]) / 2, det["y2"])
    pts = []
    for x in xs:
        for y in ys:
            p = dir_to_pixel(pixel_to_dir(x, y, det["heading"], det["pitch"], det["fov"]), dst["heading"], dst.get("pitch") or 0, dst.get("fov") or 90)
            if p is None:
                return None
            pts.append(p)
    x1, y1 = min(p[0] for p in pts), min(p[1] for p in pts)
    x2, y2 = max(p[0] for p in pts), max(p[1] for p in pts)
    cx1, cy1, cx2, cy2 = max(0.0, x1), max(0.0, y1), min(float(W), x2), min(float(H), y2)
    if cx2 <= cx1 or cy2 <= cy1:
        return None
    if (cx2 - cx1) * (cy2 - cy1) < 0.3 * (x2 - x1) * (y2 - y1):
        return None                                           # mostly outside this view
    # the box's centre column stays the bearing the pipeline used (u); keep it for aim matching
    c = dir_to_pixel(pixel_to_dir(det.get("u", (det["x1"] + det["x2"]) / 2), (det["y1"] + det["y2"]) / 2, det["heading"], det["pitch"], det["fov"]),
                     dst["heading"], dst.get("pitch") or 0, dst.get("fov") or 90)
    return (round(cx1, 1), round(cy1, 1), round(cx2, 1), round(cy2, 1)), (c[0] if c else (cx1 + cx2) / 2)


# ------------------------------------------------------------------ per-area index of the run files
class Detections:
    def __init__(self, areas_dir):
        self.dir = areas_dir
        self._cache, self._lock = {}, threading.Lock()

    def _read(self, slug, name):
        path = os.path.join(self.dir, slug, name)
        if not os.path.isfile(path):
            return None, None
        return path, os.path.getmtime(path)

    def index(self, slug):
        """{"views": key -> [det], "by_pano": pano -> [det], "ocr": lazily loaded} or None when the run file is missing."""
        path, stamp = self._read(slug, "detections.json")
        if not path:
            return None
        with self._lock:
            hit = self._cache.get(slug)
            if hit and hit["stamp"] == stamp:
                return hit
        with open(path, encoding="utf-8") as f:
            dets = json.load(f)
        views, by_pano = {}, {}
        for d in dets:
            if d.get("cls") not in CLASSES:
                continue
            d = {k: d.get(k) for k in ("pano_id", "heading", "pitch", "fov", "cls", "conf", "x1", "y1", "x2", "y2", "u",
                                       "geom_ok", "footprint_faced", "crop", "source")}
            views.setdefault(view_key(d["pano_id"], d["heading"], d["pitch"], d["fov"]), []).append(d)
            by_pano.setdefault(d["pano_id"], []).append(d)
        idx = {"stamp": stamp, "views": views, "by_pano": by_pano, "ocr": None, "slug": slug}
        with self._lock:
            self._cache[slug] = idx
        return idx

    def bviews(self, slug):
        """building_views.json: the pipeline's own best box per footprint (the box whose sight line hits it), or {}"""
        path, stamp = self._read(slug, "building_views.json")
        if not path:
            return {}
        key = f"bv:{slug}"
        with self._lock:
            hit = self._cache.get(key)
            if hit and hit["stamp"] == stamp:
                return hit["rows"]
        with open(path, encoding="utf-8") as f:
            rows = {q["fp"]: q for q in json.load(f)}
        with self._lock:
            self._cache[key] = {"stamp": stamp, "rows": rows}
        return rows

    def ocr_best(self, idx):
        """crop file name → OCR text (for picking the signboard a building's sign view refers to)"""
        if idx["ocr"] is None:
            path, _ = self._read(idx["slug"], "ocr.json")
            m = {}
            if path:
                with open(path, encoding="utf-8") as f:
                    for o in json.load(f):
                        name = os.path.basename(o.get("file") or "")
                        m[name] = [t for t in (o.get("best"), o.get("clean"), o.get("text")) if t]
            idx["ocr"] = m
        return idx["ocr"]


def _gate_why(q):
    """why a building_views box failed the quality gate (same rule as tools/build_run_report.py), None when usable"""
    if q.get("reliable"):
        return None
    for k, label in (("full_frame", "the box fills the whole photo"), ("top_cut", "the roof is cut off"),
                     ("bottom_cut", "the base is cut off"), ("sliver", "a thin sliver at the photo edge")):
        if q.get(k):
            return label
    return "an implausibly tall box"


def _box(d, target=False, from_heading=None, xy=None):
    x1, y1, x2, y2 = xy or (d["x1"], d["y1"], d["x2"], d["y2"])
    out = {"cls": d["cls"], "conf": round(float(d["conf"]), 3), "x1": round(float(x1), 1), "y1": round(float(y1), 1),
           "x2": round(float(x2), 1), "y2": round(float(y2), 1), "geom_ok": bool(d.get("geom_ok")), "target": target}
    if from_heading is not None:
        out["from_heading"] = round(float(from_heading), 1)
    return out


_norm = lambda s: re.sub(r"[^0-9A-Z஀-௿]+", "", str(s or "").upper())


def _exact_view(D, idx, v, label, stored_box=None, target_cls=None, footprint=None, ocr_text=None):
    """A planned view: its own detections; the object's box by overlap with the stored box, OCR text, or footprint."""
    dets = idx["views"].get(view_key(v["pano_id"], v["heading"], v.get("pitch"), v.get("fov"))) if idx else None
    base = {"label": label, "pano_id": v["pano_id"], "heading": v["heading"], "pitch": v.get("pitch") or 0, "fov": v.get("fov") or 90}
    if not dets:
        box = [_box({"cls": target_cls or "building", "conf": 1.0, **stored_box}, target=True)] if stored_box else []
        return {**base, "source": "none", "boxes": box, "target": "record_box" if stored_box else "none",
                "note": "No detections are stored for this view; the box is the one saved with the finding." if stored_box else None}
    t = None
    if stored_box:
        sb = (stored_box["x1"], stored_box["y1"], stored_box["x2"], stored_box["y2"])
        best = max(dets, key=lambda d: _iou(sb, (d["x1"], d["y1"], d["x2"], d["y2"])) if d["cls"] == (target_cls or d["cls"]) else -1)
        if _iou(sb, (best["x1"], best["y1"], best["x2"], best["y2"])) >= IOU_TARGET:
            t = best
    if t is None and ocr_text and target_cls == "signboard":
        ocr = D.ocr_best(idx)
        want = _norm(ocr_text)
        for d in dets:
            if d["cls"] == "signboard" and d.get("crop") and want and any(_norm(x) == want for x in ocr.get(os.path.basename(d["crop"]), [])):
                t = d
                break
    if t is None and footprint and target_cls:
        cand = [d for d in dets if d["cls"] == target_cls and d.get("footprint_faced") == footprint]
        t = max(cand, key=lambda d: d["conf"]) if cand else None
    boxes = [_box(d, target=d is t) for d in sorted(dets, key=lambda d: -d["conf"])]
    if t is None and stored_box:
        boxes.append(_box({"cls": target_cls or "building", "conf": 1.0, **stored_box}, target=True))
    return {**base, "source": "exact", "boxes": boxes, "target": "box" if t is not None else ("record_box" if stored_box else "none"),
            "note": None if t is not None or not stored_box else "The saved box did not match a stored detection exactly; showing the saved box."}


def _aimed_view(idx, v, label, asset_type):
    """An asset's re-aimed view: project the panorama's planned-view boxes into it and pick the asset's box."""
    base = {"label": label, "pano_id": v["pano_id"], "heading": v["heading"], "pitch": v.get("pitch") or 0, "fov": v.get("fov") or 60}
    src = (idx or {}).get("by_pano", {}).get(v["pano_id"], [])
    cand = []
    for d in sorted(src, key=lambda d: -d["conf"]):
        pr = project_box(d, base)
        if pr is None:
            continue
        xy, cx = pr
        if any(c[0]["cls"] == d["cls"] and _iou(c[1], xy) > DEDUP_IOU for c in cand):
            continue                                            # the same object from another planned view
        cand.append((d, xy, cx))
    F = _focal(base["fov"])
    want = ("lamp_head", "pole") if asset_type == "streetlight" else ("pole",)
    target, best = None, None
    for cls in want:                                            # class priority, then the box nearest the aimed direction
        for d, xy, cx in cand:
            if d["cls"] != cls:
                continue
            off = abs(math.degrees(math.atan((cx - W / 2) / F)))
            if off <= AIM_TOL_DEG[cls] and (best is None or off < best):
                target, best = d, off
        if target is not None:
            break
    boxes = [_box(d, target=d is target, from_heading=d["heading"], xy=xy) for d, xy, _ in cand]
    froms = sorted({round(float(d["heading"]), 1) for d, _, _ in cand})
    if target is not None:
        note = (f"This view is aimed at the {'streetlight' if asset_type == 'streetlight' else 'pole'}; the boxes come from the "
                f"pipeline's views of the same panorama (heading {', '.join(f'{h:g}°' for h in froms)}), projected into it.")
        return {**base, "source": "projected", "projected_from": froms, "boxes": boxes, "target": "box", "note": note,
                "aim_offset_deg": round(best, 1)}
    return {**base, "source": "projected" if cand else "none", "projected_from": froms, "boxes": boxes, "target": "crosshair",
            "note": "No detection box lies in the aimed direction in this panorama's views; the crosshair marks where the camera was aimed."}


def evidence(D, bundle, kind, obj_id):
    """All evidence views of one object, each with every detection box and the object's own box marked."""
    idx = D.index(bundle["slug"])
    if kind == "building":
        b = next((x for x in bundle["buildings"] if x["id"] == obj_id), None)
        if b is None:
            return None
        ev = b.get("evidence") or {}
        out = []
        if ev.get("attribute_view"):
            av = ev["attribute_view"]
            stored = {k: av[k] for k in ("x1", "y1", "x2", "y2")} if all(av.get(k) is not None for k in ("x1", "y1", "x2", "y2")) else None
            out.append({"key": "attr", **_exact_view(D, idx, av, "Front", stored, "building", obj_id)})
        best = None
        if not ev.get("attribute_view"):
            best = D.bviews(bundle["slug"]).get(obj_id)
        if ev.get("sign_view"):
            sv = ev["sign_view"]
            out.append({"key": "sign", **_exact_view(D, idx, sv, "Sign", None, "signboard", obj_id, sv.get("ocr_text"))})
        if not ev.get("attribute_view"):
            # P5 H7: no stored box. Only the pipeline's own box-to-outline match (building_views.json) may be called
            # "this building"; a detection in a photo merely AIMED at the outline is not (its sight line missed it).
            q = best
            if q:
                why = _gate_why(q)
                view = {"pano_id": q["pano_id"], "heading": q["heading"], "pitch": q.get("pitch") or 0, "fov": q.get("fov") or 90}
                box = {k: q[k] for k in ("x1", "y1", "x2", "y2")}
                v = _exact_view(D, idx, view, "Best photo", box, "building", None)
                v["user_note"] = (f"The box the analysis matched to this building failed the photo quality check ({why}), so its use "
                                  "and floors were not read from it." if why else None)
                out.insert(0, {"key": "best", **v})
            elif not out and ev.get("views"):
                v0 = {**ev["views"][0], "fov": ev["views"][0].get("fov") or 90}
                v = _exact_view(D, idx, v0, "Nearest camera", None, "building", None)
                v["target"] = "none"
                v["boxes"] = [{**b, "target": False} for b in v["boxes"]]
                v["user_note"] = ("The detector found no box for this building in any photo. The boxes here are other things it saw "
                                  "from the nearest camera; none of them was matched to this building's outline.")
                out.append({"key": "v0", **v})
        return out
    if kind == "asset":
        a = next((x for x in bundle["assets"] if x["id"] == obj_id), None)
        if a is None:
            return None
        views = (a.get("evidence") or {}).get("views") or []
        return [{"key": f"v{i}", **_aimed_view(idx, v, f"Camera {i + 1}" + (" (user photo)" if v.get("source") == "user" else ""), a["type"])}
                for i, v in enumerate(views)]
    if kind == "unmapped":
        u = next((x for x in bundle["unmapped_businesses"] if x["id"] == obj_id), None)
        if u is None or not u.get("evidence"):
            return [] if u is not None else None
        v = u["evidence"]
        stored = {k: v[k] for k in ("x1", "y1", "x2", "y2")} if all(v.get(k) is not None for k in ("x1", "y1", "x2", "y2")) else None
        return [{"key": "sign", **_exact_view(D, idx, v, "Sign", stored, "signboard", None, u.get("ocr_text"))}]
    return None
