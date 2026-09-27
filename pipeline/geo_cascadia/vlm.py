"""Tier 3: Amazon Nova Lite on Bedrock — sign names (cell 60, gated), building use/roofline (cell 66 v1),
floors (2-image few-shot, variant A), and the stage-5 freeze (N15)."""
import os, io, re, json, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from PIL import ImageDraw
from .textmatch import support

NAME_PROMPT = (
    "You are reading a cropped photo from an Indian street in Coimbatore, Tamil Nadu. "
    "Signs are often in Tamil script, English, or both.\n\nReply with ONE JSON object and nothing else. "
    "No markdown, no explanation.\n\nFields:\n"
    "  is_sign        true if this is a sign board of any kind, false if it is a wall, gate, shutter, meter box, "
    "vehicle, person, tree or blank surface\n"
    "  sign_type      exactly one of these five words: business, notice, street_name, advertisement, none\n"
    "  business_name  the shop or establishment name in LATIN SCRIPT ONLY. If the sign is in Tamil, transliterate it "
    "into Latin letters. Empty string if sign_type is not business, or if the text is unreadable\n"
    "  script         exactly one of: tamil, english, both, none\n"
    "  confidence     a number between 0.0 and 1.0\n\nRules:\n"
    "- Never output Tamil characters. Latin script only, in every field.\n"
    "- business_name is the establishment name only. Leave out phone numbers, addresses, GST numbers, taglines "
    "and product lists.\n- NO PARKING, TO LET, STOP and similar are sign_type notice, not business.\n"
    "- If you can see text but cannot read it, leave business_name empty and set confidence below 0.3.\n\n"
    'Example of the format only: {"is_sign": true, "sign_type": "notice", "business_name": "", '
    '"script": "english", "confidence": 0.8}')

BUILDING_PROMPT = (
    "This is a street-level photo from Coimbatore, Tamil Nadu, India. A RED RECTANGLE marks ONE building. "
    "Answer about THAT building only. Ignore everything outside the red rectangle.\n\n"
    "Reply with ONE JSON object and nothing else. No markdown.\n\nFields:\n"
    "  wrong_target      true if the red rectangle contains no building (a wall, road, tree, vehicle or empty "
    "ground). Then set every other field to 0 or empty\n"
    "  roofline_visible  true only if the TOP of the marked building is inside the photo\n"
    "  floors_visible    integer, storeys you can see in the red rectangle. Ground floor counts as 1. A mezzanine "
    "or loft counts. Parapet walls, water tanks and roof sheds do NOT count\n"
    "  floors_confident  true only if nothing hides part of the building\n"
    "  building_use      one of: residential, commercial, mixed, institutional, industrial, under_construction, unclear\n"
    "  shop_units        integer, separate ground-floor shopfronts in the red rectangle\n"
    "  facade_condition  one of: good, fair, poor, unclear\n"
    "  primary_name      the most prominent business name in LATIN SCRIPT, or empty. Never a phone number\n"
    "  notes             at most 12 words\n\nNever output Tamil characters, transliterate instead.\n\n"
    'Example: {"wrong_target": false, "roofline_visible": true, "floors_visible": 2, "floors_confident": true, '
    '"building_use": "mixed", "shop_units": 3, "facade_condition": "fair", "primary_name": "Rich Biryani Centre", '
    '"notes": "shops below, dwelling above"}')

FLOOR_RULE = ("A storey above the ground floor counts ONLY if it spans most of the building's width and has its own "
              "windows or doors facing the street. Parapet walls, staircase rooms, water tanks and sheds on the "
              "terrace are NOT storeys.")


PID_RE = [re.compile(r"\b(?:D\.?\s?No|Door\s?No|Plot\s?No|No)\s*[.:#-]?\s*(\d{1,4}[A-Za-z]?(?:\s*/\s*\d{1,4}[A-Za-z]?)*)", re.I),
          re.compile(r"(?<![\d/])(\d{1,4}[A-Za-z]?\s*/\s*\d{1,4}[A-Za-z]?(?:\s*/\s*\d{1,4})?)(?![\d/])")]


def property_numbers(text):
    out = []
    for rx in PID_RE:
        for m in rx.finditer(text or ""):
            n = re.sub(r"\s+", "", m.group(1)).upper()
            if n and n not in out: out.append(n)
    return out


class VLM:
    def __init__(self, cfg):
        import boto3
        self.cfg = cfg
        self.br = boto3.client("bedrock-runtime", region_name=cfg.aws_region)
        self.calls = 0; self.tok_in = 0; self.tok_out = 0

    def converse(self, content, max_tokens=400):
        for attempt in range(5):
            try:
                t0 = time.time()
                r = self.br.converse(modelId=self.cfg.vlm_model, messages=[{"role": "user", "content": content}],
                                     inferenceConfig={"maxTokens": max_tokens, "temperature": 0.0})
                u = r.get("usage", {})
                self.calls += 1; self.tok_in += u.get("inputTokens", 0); self.tok_out += u.get("outputTokens", 0)
                txt = r["output"]["message"]["content"][0]["text"].replace("```json", "").replace("```", "").strip()
                return txt, {"in": u.get("inputTokens", 0), "out": u.get("outputTokens", 0), "lat_s": time.time() - t0}
            except Exception as ex:
                if "Throttl" in repr(ex) or "TooManyRequests" in repr(ex): time.sleep(2 ** attempt); continue
                if "ExpiredToken" in repr(ex): raise RuntimeError("AWS token expired — refresh credentials") from ex
                if attempt == 4: raise
                time.sleep(1 + attempt)

    @staticmethod
    def img(path_or_bytes):
        b = open(path_or_bytes, "rb").read() if isinstance(path_or_bytes, str) else path_or_bytes
        return {"image": {"format": "jpeg", "source": {"bytes": b}}}

    def cost(self):
        return self.tok_in / 1e6 * self.cfg.vlm_in_per_m + self.tok_out / 1e6 * self.cfg.vlm_out_per_m


def _json_or(txt, keys):
    try: return json.loads(txt)
    except Exception:
        out = {}
        for k in keys:
            m = re.search(rf'"{k}"\s*:\s*("([^"]*)"|true|false|[\d.]+)', txt)
            if m:
                v = m.group(2) if m.group(2) is not None else m.group(1)
                out[k] = True if v == "true" else False if v == "false" else (float(v) if re.fullmatch(r"[\d.]+", v) else v)
        return out


def _pmap(fn, items, workers, progress, stage):
    out = []
    with ThreadPoolExecutor(workers) as ex:
        for n, r in enumerate(ex.map(fn, items), 1):
            out.append(r)
            if n % 10 == 0 or n == len(items): progress(stage, n, len(items))
    return out


def run_names(ocr_res, vlm, cfg, out_dir, progress=lambda *a, **k: None):
    """One best text-bearing crop per building -> Nova name (cells 59d/60)."""
    path = f"{out_dir}/vlm_names.json"
    done = {r["fp"]: r for r in json.load(open(path))} if os.path.exists(path) else {}
    best = {}
    for r in ocr_res:
        if r["tier"] in (2, 3) and r.get("fp"):
            k = (r.get("h", 0) * r.get("det_conf", 0))
            if r["fp"] not in best or k > best[r["fp"]][0]: best[r["fp"]] = (k, r)
    todo = [r for fp, (_, r) in best.items() if fp not in done]
    def one(r):
        txt, u = vlm.converse([vlm.img(r["file"]), {"text": NAME_PROMPT}], 400)
        return {"fp": r["fp"], "file": r["file"], "vlm": _json_or(txt, ["is_sign", "sign_type", "business_name", "confidence"]), **u}
    for r in _pmap(one, todo, cfg.vlm_workers, progress, "vlm_names"): done[r["fp"]] = r
    json.dump(list(done.values()), open(path, "w"))
    return list(done.values())


def run_building_attrs(views, sv, vlm, cfg, out_dir, progress=lambda *a, **k: None, router=None):
    """Use / roofline / condition (cell 66 prompt) + floors (variant A few-shot) for buildings with a usable box."""
    crop_dir = f"{out_dir}/crops_building"; os.makedirs(crop_dir, exist_ok=True)
    path = f"{out_dir}/vlm_buildings.json"
    done = {r["fp"]: r for r in json.load(open(path))} if os.path.exists(path) else {}
    shots = [f"{cfg.data_dir}/{s}" for s in cfg.floors_shots]
    shots_ok = all(os.path.exists(s) for s in shots)
    todo = [q for q in views if q["reliable"] and q["fp"] not in done]

    def crop(q):
        path = f"{crop_dir}/{q['fp']}.jpg"
        if os.path.exists(path): return path
        img = sv.image(q["pano_id"], heading=q["heading"], pitch=q["pitch"], fov=q["fov"])
        if img is None: return None
        W, H = img.size; bw, bh = q["x2"] - q["x1"], q["y2"] - q["y1"]; c = cfg.building_ctx
        box = (max(0, int(q["x1"] - bw * c)), max(0, int(q["y1"] - bh * c)), min(W, int(q["x2"] + bw * c)), min(H, int(q["y2"] + bh * c)))
        cr = img.crop(box).copy()
        ImageDraw.Draw(cr).rectangle([q["x1"] - box[0], q["y1"] - box[1], q["x2"] - box[0], q["y2"] - box[1]],
                                     outline=(255, 0, 0), width=max(3, int(cr.width / 160)))
        cr.save(path, quality=92); return path

    paths = dict(zip([q["fp"] for q in todo], _pmap(crop, todo, 8, progress, "building_crops")))
    local = {}
    if router is not None:                                    # G1: confident local answers skip the VLM use call
        fps = [f for f in paths if paths[f]]
        for f, (c, p) in zip(fps, router.predict([paths[f] for f in fps])):
            if p >= router.t: local[f] = (c, p)

    def one(q):
        p = paths.get(q["fp"])
        if p is None: return {"fp": q["fp"], "error": "no image"}
        if q["fp"] in local:
            v = {"building_use": local[q["fp"]][0], "use_prob": round(local[q["fp"]][1], 3), "use_route": "tier1_local_clip"}; u1 = {}
        else:
            txt, u1 = vlm.converse([vlm.img(p), {"text": BUILDING_PROMPT}], 1000)
            v = _json_or(txt, ["wrong_target", "roofline_visible", "floors_visible", "floors_confident", "building_use",
                               "shop_units", "facade_condition", "primary_name"])
            v["use_route"] = "tier3_vlm"
        floors_a = None
        if shots_ok and not v.get("wrong_target"):
            c = [{"text": "Photos from Coimbatore, India. In each, a RED RECTANGLE marks one building. " + FLOOR_RULE +
                  "\nFirst two solved examples, then the question."},
                 {"text": "Example 1. Answer: 1 (ground floor only)."}, vlm.img(shots[0]),
                 {"text": "Example 2. Answer: 2."}, vlm.img(shots[1]),
                 {"text": "Question: how many storeys does the building in the red rectangle of the NEXT photo have, "
                          "counting the ground floor as 1? Reply with only the integer."}, vlm.img(p)]
            t2, u2 = vlm.converse(c, 20)
            m = re.search(r"\d+", t2); floors_a = int(m.group()) if m else None
            # P6: the floors call's own tokens are recorded, so its cost is known (was "cost not recorded")
            return {"fp": q["fp"], "crop": p, "vlm": v, "floors_a": floors_a, **u1,
                    "floors_in": u2.get("in", 0), "floors_out": u2.get("out", 0)}
        return {"fp": q["fp"], "crop": p, "vlm": v, "floors_a": floors_a, **u1}

    for r in _pmap(one, todo, cfg.vlm_workers, progress, "vlm_buildings"): done[r["fp"]] = r
    json.dump(list(done.values()), open(path, "w"))
    return list(done.values()), shots_ok


def finalize_buildings(buildings, ocr_res, ocr_names, vlm_names, vlm_bld, cfg):
    """Stage-5 freeze (N15): one attribute record per building."""
    ocr_by_file = {r["file"]: r for r in ocr_res}
    vname = {}
    for w in vlm_names:
        v = w.get("vlm") or {}; nm = (v.get("business_name") or "").strip()
        if not (v.get("is_sign") and v.get("sign_type") == "business" and nm): continue
        s = support(nm, ocr_by_file.get(w["file"], {}))
        if w["fp"] not in vname or s > vname[w["fp"]][1]: vname[w["fp"]] = (nm, round(s, 2))
    vb = {r["fp"]: r for r in vlm_bld if "vlm" in r}
    pids = defaultdict(list)                                 # G2: door / plot numbers printed on signage
    for r in ocr_res:
        if r.get("fp") and r.get("tier", 0) >= 1:
            for n in property_numbers(r.get("text", "")):
                if n not in pids[r["fp"]]: pids[r["fp"]].append(n)
    out = []
    for b in buildings:
        f = b["building_id"]; r = vb.get(f); v = (r or {}).get("vlm", {})
        rec = {"building_id": f, "use_route": None, "property_ids": pids.get(f, []),
               "floors": None, "floors_status": "not_measured", "use": None, "condition": None,
               "shop_units": None, "name": None, "name_src": None, "name_review": False, "review_reasons": [],
               "attribute_view": None}
        if r and not v.get("wrong_target"):
            rec.update(use=v.get("building_use"), use_route=v.get("use_route", "tier3_vlm"),
                       condition=v.get("facade_condition"), shop_units=v.get("shop_units"),
                       attribute_view=r.get("crop"))
            if r.get("floors_a") is not None:
                rec["floors"] = r["floors_a"]
                rec["floors_status"] = ("low_confidence" if v.get("roofline_visible") is False or v.get("floors_confident") is False
                                        else "measured")
        if f in vname and vname[f][1] >= cfg.name_gate:
            rec.update(name=vname[f][0], name_src="vlm_verified_by_ocr")
        elif f in ocr_names:
            rec.update(name=ocr_names[f][0], name_src="ocr")
        elif f in vname:
            rec.update(name=vname[f][0], name_src="vlm_unverified", name_review=True)
        out.append(rec)
    return out
