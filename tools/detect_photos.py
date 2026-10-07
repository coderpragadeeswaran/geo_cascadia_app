"""D61: run the production detector on Street View photos, in memory (no photo is written to disk).

Runs in a SEPARATE venv with torch + ultralytics (the API's venv stays light; CLAUDE.md: no YOLO in the API):

    <detector venv>\\Scripts\\python tools\\detect_photos.py <views.json> <out.json> --weights <best.pt>

views.json = [{"id": ..., "pano_id": ..., "heading": ..., "pitch": ..., "fov": ...}, ...]. Each photo is fetched from
the Street View Static API (640x640, exactly as the pipeline's streetview.image) with GOOGLE_PLACES_SERVER_KEY from
backend/.env (or the environment), and the detector is called exactly as the pipeline's detect.run_detection does
(Config defaults: conf 0.20, imgsz 640, iou 0.45, agnostic NMS, then the per-class thresholds). out.json =
{"photos_fetched": n, "results": {id: {"status": "ok" | "http <code>" | "error", "boxes": [...]}}}.
Used by tools/check_photos.py (spot-check of re-issued panoramas) and by the one-off verification.
"""
import argparse
import io
import json
import os
import socket
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))


def _key():
    k = os.environ.get("GOOGLE_PLACES_SERVER_KEY")
    if k:
        return k
    try:
        with open(os.path.join(ROOT, "backend", ".env"), encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("GOOGLE_PLACES_SERVER_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("views")
    ap.add_argument("out")
    ap.add_argument("--weights", required=True)
    a = ap.parse_args()

    import requests
    import urllib3.util.connection as uc
    from PIL import Image
    from ultralytics import YOLO
    from geo_cascadia.config import Config

    uc.allowed_gai_family = lambda: socket.AF_INET          # IPv6 routes to Google time out on the laptop (D60)
    key = _key()
    if not key:
        sys.exit("GOOGLE_PLACES_SERVER_KEY is not set (backend/.env)")
    cfg = Config()
    model = YOLO(a.weights)
    with open(a.views, encoding="utf-8") as f:
        views = json.load(f)
    out, fetched = {}, 0
    for i, v in enumerate(views, 1):
        params = {"size": "640x640", "pano": v["pano_id"], "heading": float(v["heading"]) % 360, "pitch": v.get("pitch") or 0,
                  "fov": v.get("fov") or 90, "return_error_code": "true", "key": key}
        try:
            r = requests.get("https://maps.googleapis.com/maps/api/streetview", params=params, timeout=30)
        except requests.RequestException:
            out[v["id"]] = {"status": "error", "boxes": []}
            continue
        fetched += 1
        if r.status_code != 200:
            out[v["id"]] = {"status": f"http {r.status_code}", "boxes": []}
            continue
        img = Image.open(io.BytesIO(r.content)).convert("RGB")      # in memory only
        res = model.predict(img, conf=cfg.base_conf, imgsz=640, iou=cfg.nms_iou, agnostic_nms=True, device="cpu",
                            verbose=False)[0]
        boxes = []
        for b in res.boxes:
            cls = cfg.classes[int(b.cls)]
            conf = float(b.conf)
            if conf < cfg.conf_th[cls]:
                continue
            x1, y1, x2, y2 = [float(t) for t in b.xyxy[0]]
            boxes.append({"cls": cls, "conf": round(conf, 3), "x1": round(x1, 1), "y1": round(y1, 1),
                          "x2": round(x2, 1), "y2": round(y2, 1)})
        out[v["id"]] = {"status": "ok", "boxes": boxes}
        del img, r
        print(f"  {i}/{len(views)} {v['id']}: {len(boxes)} boxes", flush=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"photos_fetched": fetched, "results": out}, f, indent=1)
    print(f"photos fetched (Street View Static, billed): {fetched}")


if __name__ == "__main__":
    main()
