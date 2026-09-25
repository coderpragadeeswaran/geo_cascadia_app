"""Tier 2: PaddleOCR English + Tamil with tiering (cell 34).
full mode = the validated pipeline (two full engines).  fast mode = detect once with mobile models,
recognise with both languages, and OCR at most N best crops per building (for CPU workers)."""
import os, re, json, time
from collections import defaultdict
import numpy as np
from PIL import Image

os.environ.setdefault("FLAGS_use_mkldnn", "0")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
TAMIL = lambda s: sum(1 for c in s if "\u0B80" <= c <= "\u0BFF")
CJK = lambda s: sum(1 for c in s if "\u4E00" <= c <= "\u9FFF")
ALPHA = lambda s: sum(1 for c in s if c.isalpha() or "\u0B80" <= c <= "\u0BFF")


def rank(lines):
    """Pick the business name: biggest text wins; urls, phones, repeated glyphs, mIxEd misreads demoted."""
    if not lines: return [], {"text": "", "conf": 0.0, "h": 0.0, "eng": "-"}
    maxh = max((l.get("h", 0) for l in lines), default=0) or 1.0
    def score(l):
        t = l["text"].strip(); a = ALPHA(t)
        if a < 3: return -1
        if len(set(t.replace(" ", "").lower())) <= 2: return -1
        if a < 4 and not t.isupper(): return -1
        dig = sum(c.isdigit() for c in t)
        s = l["conf"] * 60 + 120 * (l.get("h", 0) / maxh)
        if "@" in t or re.search(r"\b\w+\.(com|in|org|net|co)\b", t.lower()): s -= 150
        if re.search(r"\d{7,}", re.sub(r"\D", "", t)): s -= 120
        if dig > a: s -= 80
        if a >= 4 and any(c.islower() for c in t) and sum(c.isupper() for c in t[1:]) > a * 0.4: s -= 40
        s -= 20 * sum(1 for c in t if not (c.isalnum() or c.isspace() or "\u0B80" <= c <= "\u0BFF"))
        return s
    kept = [l for l in sorted(lines, key=lambda l: -score(l)) if score(l) > 0]
    return (kept, kept[0]) if kept else ([], {"text": "", "conf": 0.0, "h": 0.0, "eng": "-"})


class OCR:
    def __init__(self, cfg):
        self.cfg = cfg
        self.dev = "gpu" if cfg.device == "gpu" else "cpu"
        self.mode = cfg.ocr_mode
        if self.mode == "fast":
            try:
                self._init_fast()
            except Exception as ex:
                print(f"[ocr] fast mode unavailable ({repr(ex)[:120]}) -> full mode"); self.mode = "full"
        if self.mode == "full":
            from paddleocr import PaddleOCR
            kw = dict(use_doc_orientation_classify=False, use_doc_unwarping=False,
                      use_textline_orientation=False, device=self.dev)
            if self.dev == "cpu": kw["enable_mkldnn"] = False
            self.eng = {l: PaddleOCR(lang=l, **kw) for l in ("en", "ta")}

    # ---------------- fast mode ----------------
    def _init_fast(self):
        from paddleocr import TextDetection, TextRecognition
        def first(cls, names):
            last = None
            for n in names:
                try: return cls(model_name=n, device=self.dev)
                except Exception as ex: last = ex
            raise last
        self.det = first(TextDetection, ["PP-OCRv5_mobile_det", "PP-OCRv4_mobile_det"])
        self.rec = {"en": first(TextRecognition, ["en_PP-OCRv5_mobile_rec", "PP-OCRv5_mobile_rec"]),
                    "ta": first(TextRecognition, ["ta_PP-OCRv5_mobile_rec"])}

    @staticmethod
    def _get(r, k):
        try: return r[k]
        except Exception:
            try: return r.json["res"][k]
            except Exception: return None

    def _lines_fast(self, arr):
        dres = list(self.det.predict(arr))
        polys = self._get(dres[0], "dt_polys") if dres else None
        crops = []
        for p in (polys if polys is not None else []):
            p = np.array(p); x0, y0 = np.maximum(p.min(0).astype(int) - 2, 0); x1, y1 = p.max(0).astype(int) + 2
            if x1 - x0 >= 4 and y1 - y0 >= 4: crops.append((arr[y0:y1, x0:x1], float(y1 - y0)))
        if not crops: crops = [(arr, float(arr.shape[0]))]              # a sign crop is often one line
        lines = []
        for lang, rec in self.rec.items():
            for (c, h), r in zip(crops, rec.predict([c for c, _ in crops])):
                t = str(self._get(r, "rec_text") or "").strip(); s = float(self._get(r, "rec_score") or 0)
                if t and not CJK(t): lines.append({"text": t, "conf": round(s, 3), "h": h, "eng": lang})
        return lines

    # ---------------- full mode (validated) ----------------
    def _run_engine(self, eng, arr):
        try: out = eng.predict(arr)
        except Exception: return []
        lines = []
        for page in (out or []):
            txts, scores = page.get("rec_texts") or [], page.get("rec_scores") or []
            polys, boxes = page.get("rec_polys") or page.get("dt_polys") or [], page.get("rec_boxes")
            for i, (t, s) in enumerate(zip(txts, scores)):
                t = str(t).strip()
                if not t or CJK(t): continue
                h = 0.0
                try:
                    if i < len(polys): ys = [float(p[1]) for p in polys[i]]; h = max(ys) - min(ys)
                    elif boxes is not None and i < len(boxes): h = float(boxes[i][3]) - float(boxes[i][1])
                except Exception: pass
                lines.append({"text": t, "conf": round(float(s), 3), "h": h})
        return lines

    def _lines_full(self, work):
        pooled = []
        for lg, eng in self.eng.items():
            ls = self._run_engine(eng, np.array(work))
            if not ls or max(l["conf"] for l in ls) < self.cfg.ocr_min_conf:
                big = work.resize((work.width * 2, work.height * 2), Image.LANCZOS)
                ls2 = self._run_engine(eng, np.array(big))
                if max((l["conf"] for l in ls2), default=0) > max((l["conf"] for l in ls), default=0): ls = ls2
            pooled += [{**l, "eng": lg} for l in ls]
        return pooled

    # ---------------- one crop ----------------
    def read(self, path, det):
        base = {"file": path, "fp": det.get("footprint_faced"), "pano_id": det["pano_id"],
                "heading": det["heading"], "pitch": det["pitch"], "det_conf": det["conf"]}
        if det["y2"] >= det["H"] - 26 and det["y2"] - det["y1"] <= 34:
            return {**base, "tier": 0, "reason": "google_watermark", "best": "", "best_conf": 0.0, "text": ""}
        im = Image.open(path).convert("RGB"); w, h = im.size
        sc = max(1.0, self.cfg.ocr_target_h / h)
        work = im.resize((max(8, int(w * sc)), max(8, int(h * sc))), Image.LANCZOS)
        pooled = self._lines_fast(np.array(work)) if self.mode == "fast" else self._lines_full(work)
        joined = " ".join(l["text"] for l in pooled)
        lines, best = rank(pooled)
        bclean = re.sub(r"[^A-Za-z0-9\u0B80-\u0BFF ]", "", best["text"]).strip()
        clean = re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9\u0B80-\u0BFF ]", " ", joined)).strip()
        rec = {**base, "w": w, "h": h, "text": joined, "clean": clean, "engine": best.get("eng", "-"),
               "tamil": TAMIL(joined), "n_regions": len(lines)}
        if "google" in bclean.lower().replace(" ", ""):
            return {**rec, "tier": 0, "reason": "google_watermark", "best": "", "best_conf": 0.0}
        if ALPHA(bclean) < self.cfg.ocr_min_chars:
            return {**rec, "tier": 1, "reason": "no_text_at_all" if not pooled else "no_name_text",
                    "best": "", "best_conf": round(best["conf"], 3)}
        tier = 2 if best["conf"] >= self.cfg.ocr_min_conf else 3
        return {**rec, "tier": tier, "reason": "ok" if tier == 2 else "low_conf_but_text_present",
                "best": bclean, "best_conf": round(best["conf"], 3), "best_h": round(best.get("h", 0), 1)}


def run_ocr(dets, cfg, out_dir, progress=lambda *a, **k: None):
    path = f"{out_dir}/ocr.json"
    res = json.load(open(path)) if os.path.exists(path) else []
    done = {r["file"] for r in res}
    signs = [d for d in dets if d["cls"] == "signboard" and d.get("crop") and os.path.exists(d["crop"])]
    skipped = []
    if cfg.ocr_mode == "fast" and cfg.fast_max_crops_per_building:
        by_fp = defaultdict(list)
        for d in signs: by_fp[d.get("footprint_faced")].append(d)
        keep = []
        for fp, ds in by_fp.items():
            ds.sort(key=lambda d: -(d["y2"] - d["y1"]) * d["conf"])
            keep += ds[:cfg.fast_max_crops_per_building]; skipped += ds[cfg.fast_max_crops_per_building:]
        signs = keep
    todo = [d for d in signs if d["crop"] not in done]
    ocr = OCR(cfg); t0 = time.time()
    for n, d in enumerate(todo, 1):
        res.append(ocr.read(d["crop"], d))
        if n % 25 == 0 or n == len(todo):
            json.dump(res, open(path, "w")); progress("ocr", n, len(todo))
    for d in skipped:
        if d["crop"] not in done:
            res.append({"file": d["crop"], "fp": d.get("footprint_faced"), "pano_id": d["pano_id"],
                        "heading": d["heading"], "pitch": d["pitch"], "det_conf": d["conf"], "tier": -1,
                        "reason": "skipped_fast_mode_cap", "best": "", "best_conf": 0.0, "text": ""})
    json.dump(res, open(path, "w"))
    names = {}
    for r in res:
        if r["tier"] == 2 and r.get("fp") and r["best"]:
            if r["fp"] not in names or r["best_conf"] > names[r["fp"]][1]:
                names[r["fp"]] = (r["best"], r["best_conf"])
    stats = {"crops": len(res), "mode": ocr.mode, "sec_per_crop": round((time.time() - t0) / max(len(todo), 1), 2),
             "tiers": {t: sum(r["tier"] == t for r in res) for t in (-1, 0, 1, 2, 3)}}
    return res, names, stats
