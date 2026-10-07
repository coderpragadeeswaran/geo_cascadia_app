"""D61 step 1a (one-off study): are re-issued Street View panoramas the same image?

    backend\\.venv\\Scripts\\python tools\\verify_same_image.py --python <detector venv python> --weights <best.pt>
        [--n 40] [--control 10] [--out <file.json>]

Draws a stratified sample of retired photo references (Ward 29 + Trichy; spread over streets and object kinds) and a
control sample of still-served references, fetches each replacement / served photo with the STORED heading, pitch and
field of view, runs the production detector on it (tools/detect_photos.py, in its own venv, photos kept in memory only)
and compares its boxes with the saved ones (app/sameimage.py, rule fixed in advance). Prints the numbers; writes the
per-photo rows to --out (default data/exports/same_image_verify.json, git-ignored).
"""
import argparse
import collections
import json
import os
import random
import statistics
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from app import evidence, photos, sameimage  # noqa: E402
from app.settings import Settings  # noqa: E402
from app.store import JsonStore  # noqa: E402

AREAS = ("ward29", "trichy_bharathidasan_salai")


def kind_of(kind, v):
    return {"attr": "building front", "sign": "building sign", "best": "building best photo", "v0": "building nearest"}.get(
        v.get("key"), kind) if kind == "building" else ("pole / light" if kind == "asset" else "business sign")


def saved_boxes(v):
    # the analysis' boxes on that photo; a "saved box shown because no detection matched" (record_box) is left out
    return [b for b in v.get("boxes") or [] if not (v.get("target") == "record_box" and b.get("target"))]


def refs(meta, D, store):
    out = []
    for slug in AREAS:
        b = store.bundle(slug)
        cams = D.cameras(slug)
        for kind, oid, v in photos.photo_refs(D, b):
            s = photos.status(meta, v.get("pano_id"), cams.get(v.get("pano_id")), lookup=False)
            street = next((r.get("street") for r in (b["buildings"] if kind == "building" else b["assets"] if kind == "asset"
                                                     else b.get("unmapped_businesses") or []) if r["id"] == oid), None)
            out.append({"slug": slug, "kind": kind, "k": kind_of(kind, v), "id": oid, "street": street, "view": v,
                        "served": s["served"], "current": s["current"], "stored_date": (cams.get(v["pano_id"]) or {}).get("date")})
    return out


def stratified(rows, n, seed):
    rnd = random.Random(seed)
    groups = collections.defaultdict(list)
    for r in rows:
        groups[(r["street"], r["k"])].append(r)
    for g in groups.values():
        rnd.shuffle(g)
    keys = sorted(groups)
    rnd.shuffle(keys)
    picked = []
    while len(picked) < n and any(groups.values()):
        for k in keys:                         # round robin over (street, kind)
            if groups[k] and len(picked) < n:
                picked.append(groups[k].pop())
    return picked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--python", required=True)
    ap.add_argument("--weights", required=True)
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--control", type=int, default=10)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "exports", "same_image_verify.json"))
    a = ap.parse_args()

    st = Settings()
    meta = photos.PhotoMeta(os.path.join(st.data_dir, "cache", "streetview_meta.json"))
    store, D = JsonStore(st.areas_dir), evidence.Detections(st.areas_dir)
    rows = refs(meta, D, store)
    gone = [r for r in rows if r["served"] is False and r["current"]]
    trichy = [r for r in gone if r["slug"] != "ward29"]
    sample = trichy + stratified([r for r in gone if r["slug"] == "ward29"], a.n - len(trichy), a.seed)
    control = stratified([r for r in rows if r["served"] is True], a.control, a.seed + 1)
    print(f"retired references {len(gone)}; sample {len(sample)} over {len({r['street'] for r in sample})} streets; "
          f"control {len(control)}")

    views = []
    for i, r in enumerate(sample + control):
        r["rid"] = f"r{i:03d}"
        pano = r["current"]["pano_id"] if r["served"] is False else r["view"]["pano_id"]
        views.append({"id": r["rid"], "pano_id": pano, "heading": r["view"]["heading"], "pitch": r["view"].get("pitch") or 0,
                      "fov": r["view"].get("fov") or 90})
    with tempfile.TemporaryDirectory() as tmp:
        vin, vout = os.path.join(tmp, "views.json"), os.path.join(tmp, "out.json")
        with open(vin, "w", encoding="utf-8") as f:
            json.dump(views, f)
        subprocess.run([a.python, os.path.join(ROOT, "tools", "detect_photos.py"), vin, vout, "--weights", a.weights], check=True)
        with open(vout, encoding="utf-8") as f:
            det = json.load(f)

    out = []
    for r in sample + control:
        res = det["results"].get(r["rid"]) or {"status": "missing", "boxes": []}
        S = saved_boxes(r["view"])
        m = sameimage.compare(S, res["boxes"]) if res["status"] == "ok" else None
        v, why = sameimage.verdict(m) if m else ("no_photo", [res["status"]])
        tgt = next((b for b in S if b.get("target")), None)
        t_iou = max((sameimage.iou(sameimage._xy(tgt), sameimage._xy(n)) for n in res["boxes"] if n["cls"] == tgt["cls"]),
                    default=0.0) if tgt and m else None
        out.append({"group": "retired" if r["served"] is False else "control", "slug": r["slug"], "kind": r["k"], "id": r["id"],
                    "street": r["street"], "old_pano": r["view"]["pano_id"], "new_pano": (r["current"] or {}).get("pano_id"),
                    "moved_m": (r["current"] or {}).get("moved_m"), "heading": r["view"]["heading"],
                    "pitch": r["view"].get("pitch"), "fov": r["view"].get("fov"),
                    "metadata_ok": sameimage.metadata_ok(r["current"], r["stored_date"]) if r["current"] else None,
                    "metrics": m, "verdict": v, "why": why, "target_iou": round(t_iou, 3) if t_iou is not None else None})
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"rule": sameimage.RULE_TEXT, "photos_fetched": det["photos_fetched"], "rows": out}, f, indent=1)

    def summary(label, rs):
        ms = [r["metrics"] for r in rs if r["metrics"]]
        all_iou = [x for m in ms for x in m["ious"]]
        judge = [r for r in rs if r["verdict"] in ("same", "different")]
        c = collections.Counter(r["verdict"] for r in rs)
        tg = [r["target_iou"] for r in rs if r["target_iou"] is not None]
        print(f"\n{label}: photos {len(rs)} · verdicts {dict(c)} · pass rate {c['same']}/{len(judge)}"
              f" = {100 * c['same'] / len(judge):.1f}%" if judge else f"\n{label}: nothing judgeable")
        if all_iou:
            q = statistics.quantiles(all_iou, n=10)
            print(f"  box IoU (matched pairs, n={len(all_iou)}): median {statistics.median(all_iou):.3f}, p10 {q[0]:.3f}; "
                  f"saved {sum(m['saved'] for m in ms)}, matched {sum(m['matched'] for m in ms)}, missing "
                  f"{sum(m['missing'] for m in ms)}, extra {sum(m['extra'] for m in ms)}")
            dx = [m["dx"] for m in ms if m["dx"] is not None]
            dy = [m["dy"] for m in ms if m["dy"] is not None]
            print(f"  per-photo median shift: dx median {statistics.median(dx):+.1f} px (range {min(dx):+.1f}..{max(dx):+.1f}), "
                  f"dy median {statistics.median(dy):+.1f} px (range {min(dy):+.1f}..{max(dy):+.1f})")
            sr = [m["strong_recall"] for m in ms if m["strong_recall"] is not None]
            print(f"  strong boxes found again: median {statistics.median(sr):.2f}, min {min(sr):.2f}")
        if tg:
            print(f"  the object's own box: n={len(tg)}, median IoU {statistics.median(tg):.3f}, min {min(tg):.3f}, "
                  f">= 0.5: {sum(x >= 0.5 for x in tg)}")
        by = collections.defaultdict(list)
        for r in rs:
            by[r["kind"]].append(r)
        for k, g in sorted(by.items()):
            gi = [x for r in g if r["metrics"] for x in r["metrics"]["ious"]]
            print(f"    {k:<20} {len(g):>3} photos · same {sum(r['verdict'] == 'same' for r in g)} · different "
                  f"{sum(r['verdict'] == 'different' for r in g)} · can't tell {sum(r['verdict'] == 'cant_tell' for r in g)}"
                  f" · median IoU {statistics.median(gi):.3f}" if gi else f"    {k:<20} {len(g)} photos")
        return all_iou, c, judge

    ri, rc, rj = summary("RETIRED (replacement photo, stored view)", [r for r in out if r["group"] == "retired"])
    ci, cc, cj = summary("CONTROL (still served, stored view)", [r for r in out if r["group"] == "control"])
    rate = rc["same"] / len(rj) if rj else 0
    gap = (statistics.median(ci) - statistics.median(ri)) if ri and ci else None
    go = rate >= 0.90 and gap is not None and gap <= 0.05
    print(f"\nGo / no-go (fixed rule): pass rate {100 * rate:.1f}% (>= 90%), median IoU gap to control "
          f"{gap if gap is None else round(gap, 3)} (<= 0.05) -> {'GO: restore' if go else 'NO-GO: restore nothing'}")
    for r in out:
        if r["verdict"] != "same":
            print(f"  {r['group']:<8} {r['verdict']:<10} {r['kind']:<20} {r['id']:<14} {r['street']} · {'; '.join(r['why'])}")
    print(f"photos fetched (Street View Static): {det['photos_fetched']}; written {a.out}")


if __name__ == "__main__":
    main()
