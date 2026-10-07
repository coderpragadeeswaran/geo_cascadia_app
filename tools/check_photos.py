"""D60 / D61: which stored Street View photos Google still serves, per area, and which retired ones are the same photo
under a new id.

    backend\\.venv\\Scripts\\python tools\\check_photos.py [slug ...] [--detector-python <python>] [--weights <best.pt>]

1. For every evidence photo the app shows (the evidence API's own views: buildings, poles / lights, businesses) it asks
   the free metadata endpoint for the stored panorama id; for a gone one, it looks for Google's current panorama within
   25 m of the original camera. Answers go to the app's 30-day cache (data/cache/streetview_meta.json).
2. D61: a gone panorama whose replacement has the same capture month and is <= 5 m away gets a detector spot-check: the
   production detector (tools/detect_photos.py, in its own venv) is re-run on the replacement photo of one of the old
   panorama's planned views (same heading / pitch / fov; the view with the most confident saved boxes, then the next, at
   most 3) and its boxes are compared with the saved ones (backend/app/sameimage.py, rule fixed in advance). Pass =
   "same image". Gate (same rule as the D61 study): an area's re-issues get their saved boxes back only when >= 90% of
   its judged retired panoramas pass; otherwise none does (a few near-identical neighbouring frames can pass one by one,
   7 Oct 2026: 3 of 68). A verdict is kept while the replacement id
   stays the same; only new re-issues cost photos (1 Street View photo per panorama, sometimes up to 3).
   Without a detector (no --detector-python / --weights, nor DETECTOR_PYTHON / DETECTOR_WEIGHTS in backend/.env) new
   re-issues stay "not checked" and keep the no-box behaviour.
3. The per-area summary + verdicts + the gone references go to data/areas/<slug>/photo_check.json (committed).
Needs GOOGLE_PLACES_SERVER_KEY in backend/.env (the key must allow the Street View Static API).
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from app import evidence, photos, sameimage  # noqa: E402
from app.settings import Settings  # noqa: E402
from app.store import JsonStore  # noqa: E402


def _read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _dump(res):
    """indent=1 JSON with one gone reference per line (a few hundred lines instead of thousands)"""
    refs = res.get("references") or []
    text = json.dumps({**res, "references": "@@REFS@@"}, indent=1)
    lines = ",\n".join("  " + json.dumps(r, separators=(", ", ": ")) for r in refs)
    return text.replace('"@@REFS@@"', "[\n" + lines + "\n ]" if refs else "[]") + "\n"


def detect(py, weights, views):
    """the production detector on these views (photos in memory only): ({id: result}, photos fetched)"""
    with tempfile.TemporaryDirectory() as tmp:
        vin, vout = os.path.join(tmp, "views.json"), os.path.join(tmp, "out.json")
        with open(vin, "w", encoding="utf-8") as f:
            json.dump(views, f)
        subprocess.run([py, os.path.join(ROOT, "tools", "detect_photos.py"), vin, vout, "--weights", weights], check=True,
                       stdout=subprocess.DEVNULL)
        got = _read(vout)
    return got.get("results") or {}, got.get("photos_fetched") or 0


def spot_check(gone, idx, old_rows, py, weights):
    """D61 verdict per retired panorama: kept from the last run while the replacement id is unchanged; else checked now
    (when a detector is available). Returns ({old pano: row}, photos fetched)."""
    rows, todo = {}, {}
    for old, g in gone.items():
        cur = g["current"]
        if not cur:
            rows[old] = {"pano_id": None, "verdict": "no_replacement"}
            continue
        base = {"pano_id": cur["pano_id"], "date": cur.get("date"), "stored_date": g["stored_date"], "moved_m": cur["moved_m"]}
        if not sameimage.metadata_ok(cur, g["stored_date"]):
            rows[old] = {**base, "verdict": "different", "why": ["not the same capture month or more than "
                                                                f"{sameimage.MAX_MOVED_M:g} m away"]}
            continue
        prev = old_rows.get(old) or {}
        if prev.get("pano_id") == cur["pano_id"] and prev.get("verdict") in ("same", "different", "cant_tell"):
            rows[old] = prev                                    # already checked against this replacement
            continue
        cands = sameimage.candidate_views(idx, old)[:sameimage.MAX_VIEWS]
        if not cands:
            rows[old] = {**base, "verdict": "cant_tell", "why": ["no saved boxes for this panorama"]}
            continue
        rows[old] = {**base, "verdict": "not_checked", "why": ["no detector configured"]}
        todo[old] = cands
    fetched = 0
    if todo and py and weights:
        tries = {old: 0 for old in todo}
        while tries:
            views = [{"id": old, "pano_id": rows[old]["pano_id"], **todo[old][n][0]} for old, n in tries.items()]
            res, f = detect(py, weights, views)
            fetched += f
            nxt = {}
            for old, n in tries.items():
                view, saved = todo[old][n]
                r = res.get(old) or {"status": "missing", "boxes": []}
                if r["status"] != "ok":
                    rows[old] = {**rows[old], "verdict": "not_checked", "why": [f"replacement photo: {r['status']}"]}
                    continue
                m = sameimage.compare(saved, r["boxes"])
                v, why = sameimage.verdict(m)
                rows[old] = {**rows[old], "verdict": v, "why": why, "view": view,
                             "metrics": {k: m[k] for k in ("saved", "new", "matched", "missing", "extra", "median_iou",
                                                            "strong", "strong_recall", "dx", "dy")},
                             "checked": dt.date.today().isoformat(), "rule": "D61"}
                if v == "cant_tell" and n + 1 < len(todo[old]):
                    nxt[old] = n + 1
            tries = nxt
    return rows, fetched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--detector-python", default=os.environ.get("DETECTOR_PYTHON", "").strip())
    ap.add_argument("--weights", default=os.environ.get("DETECTOR_WEIGHTS", "").strip())
    a = ap.parse_args()
    st = Settings()
    if not st.google_server_key:
        sys.exit("GOOGLE_PLACES_SERVER_KEY is not set in backend/.env")
    det_ok = bool(a.detector_python and a.weights and os.path.isfile(a.weights))
    if not det_ok:
        print("no detector configured (--detector-python / --weights or DETECTOR_PYTHON / DETECTOR_WEIGHTS): new re-issued "
              "panoramas stay 'not checked' and show no boxes")
    meta = photos.PhotoMeta(os.path.join(st.data_dir, "cache", "streetview_meta.json"), st.google_server_key)
    store, D = JsonStore(st.areas_dir), evidence.Detections(st.areas_dir)
    slugs = a.slugs or store.slugs()
    fetched = 0
    # 1 + 2: metadata, then the spot-check verdicts (written first, so step 3 reads every area's verdicts)
    for slug in slugs:
        b = store.bundle(slug)
        path = os.path.join(st.areas_dir, slug, "photo_check.json")
        old = _read(path)
        gone = photos.gone_panoramas(meta, D, b)
        rows, f = spot_check(gone, D.index(slug), old.get("same_image") or {}, a.detector_python if det_ok else None,
                             a.weights if det_ok else None)
        fetched += f
        old["same_image"] = rows
        old["same_image_restore"] = sameimage.restore_gate(rows)
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(old, fh, indent=1)
            fh.write("\n")
    # 3: the summary with the verdicts applied
    same = photos.same_images(st.areas_dir)
    for slug in slugs:
        b = store.bundle(slug)
        path = os.path.join(st.areas_dir, slug, "photo_check.json")
        got = _read(path)
        rows = got.get("same_image") or {}
        res = photos.check_area(meta, D, b, same=same)
        refs = res.pop("references")
        res["same_image_rule"] = sameimage.RULE_TEXT
        res["same_image_restore"] = got.get("same_image_restore")
        res["same_image"] = rows
        res["references"] = refs
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(_dump(res))
        verdicts = {}
        for r in rows.values():
            verdicts[r["verdict"]] = verdicts.get(r["verdict"], 0) + 1
        print(f"{slug:<48} refs {res['photo_refs']:>4}  served {res['served']:>4}  gone {res['gone']:>4}  "
              f"gone+current {res['gone_current_available']:>4} (same month {res['gone_current_same_month']}, same image "
              f"{res['gone_same_image']})  unknown {res['unknown']:>3}  |  panoramas {res['panoramas']:>4}, gone "
              f"{res['panoramas_gone']:>4}, same image {res['panoramas_gone_same_image']:>3}  {verdicts or ''}"
              f"{'' if not rows else '  restore: ' + ('yes' if (res['same_image_restore'] or {}).get('restore') else 'no')}", flush=True)
    print(f"metadata calls made: {meta.calls} (the rest came from the 30-day cache); Street View photos fetched for the "
          f"spot-check: {fetched}")


if __name__ == "__main__":
    main()
