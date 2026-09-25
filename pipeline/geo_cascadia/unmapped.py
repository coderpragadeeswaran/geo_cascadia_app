"""Businesses on frontages with no building outline: signs become approximate map points.
Kept only if the VLM says the sign is a BUSINESS and OCR supports the name (same gate as building names)."""
import os, json, math
from concurrent.futures import ThreadPoolExecutor
from .geo import pixel_to_bearing
import difflib
from .textmatch import loose, support, name_quality
from .vlm import NAME_PROMPT, _json_or


PLACE = {loose(w) for w in ("coimbatore tiruppur tirupur tiruchirappalli trichy madurai salem erode chennai "
                             "select welcome open closed sale offer new").split()}


def unmapped_businesses(dets, ocr_res, frame, vlm, cfg, out_dir, assumed_dist_m=12.0, merge_m=15.0):
    det_by_crop = {d["crop"]: d for d in dets if d.get("crop")}
    pts = []
    for r in ocr_res:
        d = det_by_crop.get(r["file"])
        if not d or d.get("footprint_faced") is not None or r["tier"] not in (2, 3): continue
        b = pixel_to_bearing(d["heading"], d["u"], d["W"], d["fov"])
        cx, cy = frame.xy(d["camera_lat"], d["camera_lon"])
        pts.append({"r": r, "d": d, "x": cx + assumed_dist_m * math.sin(math.radians(b)),
                    "y": cy + assumed_dist_m * math.cos(math.radians(b)), "key": loose(r.get("best", ""))})
    groups = []                                                     # one VLM call per physical sign
    for p in sorted(pts, key=lambda p: -(p["r"].get("h", 0) * p["r"].get("det_conf", 0))):
        for g in groups:
            near = math.dist((g["x"], g["y"]), (p["x"], p["y"]))
            if (p["key"] and p["key"] == g["key"] and near <= merge_m) or near <= 4:
                g["n"] += 1; break
        else:
            groups.append({**p, "n": 1})
    path = f"{out_dir}/vlm_unmapped.json"
    cache = json.load(open(path)) if os.path.exists(path) else {}
    todo = [g for g in groups if g["r"]["file"] not in cache]
    def one(g):
        txt, u = vlm.converse([vlm.img(g["r"]["file"]), {"text": NAME_PROMPT}], 400)
        return g["r"]["file"], _json_or(txt, ["is_sign", "sign_type", "business_name", "confidence"])
    with ThreadPoolExecutor(cfg.vlm_workers) as ex:
        for f, v in ex.map(one, todo): cache[f] = v
    json.dump(cache, open(path, "w"))
    out, dropped = [], {"not_business": 0, "unsupported_name": 0}
    for g in groups:
        v = cache.get(g["r"]["file"], {}); nm = (v.get("business_name") or "").strip()
        if not (v.get("is_sign") and v.get("sign_type") == "business" and nm):
            dropped["not_business"] += 1; continue
        if support(nm, g["r"]) < cfg.name_gate:
            dropped["unsupported_name"] += 1; continue
        k = loose(nm)
        if len(k) < 4 or k in PLACE or name_quality(nm, "vlm", False) != "good":
            dropped["weak_name"] = dropped.get("weak_name", 0) + 1; continue
        dup = next((o for o in out if math.dist((o["_x"], o["_y"]), (g["x"], g["y"])) <= 40 and
                    (loose(o["name"]) == k or difflib.SequenceMatcher(None, loose(o["name"]), k).ratio() >= 0.8)), None)
        if dup: dup["sightings"] += g["n"]; dropped["merged_duplicate"] = dropped.get("merged_duplicate", 0) + 1; continue
        la, lo = frame.ll(g["x"], g["y"]); d = g["d"]
        out.append({"_x": g["x"], "_y": g["y"], "id": f"ub-{len(out):04d}", "type": "unmapped_business", "name": nm, "ocr_text": g["r"].get("best"),
                    "lat": round(la, 7), "lon": round(lo, 7), "street": d["street"], "sightings": g["n"],
                    "position": f"approximate (~{assumed_dist_m:.0f} m along the camera ray; no building outline here)",
                    "evidence": {k: d[k] for k in ("pano_id", "heading", "pitch", "fov", "x1", "y1", "x2", "y2")}})
    weak = [o for o in out if len(o["name"].split()) == 1 and o["sightings"] < 2]   # one word, seen once = too weak
    dropped["single_word_single_sighting"] = len(weak)
    out = [o for o in out if o not in weak]
    for i, o in enumerate(out): o.pop("_x"); o.pop("_y"); o["id"] = f"ub-{i:04d}"
    return out, {"candidates": len(groups), **dropped, "kept": len(out)}
