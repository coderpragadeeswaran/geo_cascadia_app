"""Building use from sign text (D32). Rule-based, no model call; runs after finalize_buildings in run_area.

A building's use comes from its building photo (local router or VLM). When no usable building photo exists, the use
stays unknown even if a readable shop sign is linked to the building. This step fills ONLY those unknown uses:

  use = "commercial", use_route = "sign_text"  when the building has
    - a kept sign name (OCR, or VLM confirmed by OCR),
    - a readable OCR read of its own sign (tier 2: confidence >= cfg.ocr_min_conf) that supports that name
      (textmatch.support >= cfg.name_gate) and is not a small plate (cfg.sign_use_min_crop_w / _area),
    - text that looks like a business (textmatch.name_kind: "name" or "business_word"; one word of <= 6 letters is too
      little to tell, as in textmatch.name_quality), and
    - no house-name word (cfg.sign_use_house_words: illam, nilayam, nivas, house, villa, …).

A use decided by the model is never overwritten. Same code for every area and every live street.
"""
import re

from .textmatch import name_kind, support

ROUTE = "sign_text"


def _house(text, words):
    t = (text or "").lower()
    toks = set(re.split(r"[^a-z஀-௿]+", t))
    return any((w in toks) if w.isascii() else (w in t) for w in words)


def sign_use_evidence(rec, ocr_by_fp, cfg):
    """(ok, why) for one finalize_buildings record whose use is unknown."""
    name, src = (rec.get("name") or "").strip(), rec.get("name_src")
    if not name:
        return False, "no sign name"
    if src not in ("ocr", "vlm_verified_by_ocr"):
        return False, "name not supported by OCR"
    kind = name_kind(name)
    if kind not in ("name", "business_word"):
        return False, f"sign text is {kind or 'empty'}"
    words = re.findall(r"[A-Za-z]+", name)
    if kind == "name" and len(words) == 1 and len(words[0]) <= 6:
        return False, "one short word: too little to tell"           # same test as textmatch.name_quality
    if _house(name, cfg.sign_use_house_words):
        return False, "house name plate"
    reads = [r for r in ocr_by_fp.get(rec["building_id"], []) if r.get("tier") == 2 and (r.get("best_conf") or 0) >= cfg.ocr_min_conf]
    reads = [r for r in reads if support(name, r) >= cfg.name_gate]
    if not reads:
        return False, "no readable OCR read of this name"
    if any(_house(" ".join(filter(None, (r.get("text"), r.get("best")))), cfg.sign_use_house_words) for r in reads):
        return False, "house name plate"
    big = [r for r in reads if (r.get("w") or 0) >= cfg.sign_use_min_crop_w and (r.get("w") or 0) * (r.get("h") or 0) >= cfg.sign_use_min_crop_area]
    if not big:
        return False, "sign too small (name plate)"
    return True, "readable business sign"


def fill_use_from_signs(final, ocr_res, cfg):
    """Returns (final, stats). Changes only records with use None; everything else is returned untouched."""
    ocr_by_fp = {}
    for r in ocr_res:
        if r.get("fp"):
            ocr_by_fp.setdefault(r["fp"], []).append(r)
    stats = {"unknown_before": 0, "filled": 0, "skipped": {}}
    out = []
    for rec in final:
        if rec.get("use") is not None:
            out.append(rec)
            continue
        stats["unknown_before"] += 1
        ok, why = sign_use_evidence(rec, ocr_by_fp, cfg)
        if ok:
            rec = {**rec, "use": "commercial", "use_route": ROUTE}
            stats["filled"] += 1
        elif rec.get("name"):
            stats["skipped"][why] = stats["skipped"].get(why, 0) + 1
        out.append(rec)
    return out, stats
