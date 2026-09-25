"""Tier 1: YOLOv8s over every planned view (cell 22). Images stay in memory; sign crops go to disk."""
import os, json
from concurrent.futures import ThreadPoolExecutor
from collections import Counter


def run_detection(plan, sv, cfg, out_dir, progress=lambda *a, **k: None):
    from ultralytics import YOLO
    model = YOLO(cfg.yolo_weights)
    dev = 0 if cfg.device == "gpu" else "cpu"
    crop_dir = f"{out_dir}/crops_signboard"; os.makedirs(crop_dir, exist_ok=True)
    det_path = f"{out_dir}/detections.json"
    dets = json.load(open(det_path)) if os.path.exists(det_path) else []
    done = {f"{d['pano_id']}|{d['heading']}|{d['pitch']}" for d in dets}
    done |= set(json.load(open(f"{out_dir}/_views_done.json"))) if os.path.exists(f"{out_dir}/_views_done.json") else set()
    jobs = [(e, v) for e in plan for v in e["views"] if f"{e['pano_id']}|{v['heading']}|{v['pitch']}" not in done]
    fetch = lambda ev: sv.image(ev[0]["pano_id"], heading=ev[1]["heading"], pitch=ev[1]["pitch"], fov=ev[1]["fov"])
    n_fail = 0
    with ThreadPoolExecutor(8) as ex:                       # fetch ahead while the model runs
        for n, ((e, v), img) in enumerate(zip(jobs, ex.map(fetch, jobs)), 1):
            key = f"{e['pano_id']}|{v['heading']}|{v['pitch']}"
            done.add(key)
            if img is None:
                n_fail += 1; continue
            W, H = img.size
            res = model.predict(img, conf=cfg.base_conf, imgsz=640, iou=cfg.nms_iou, agnostic_nms=True,
                                device=dev, verbose=False)[0]
            for b in res.boxes:
                cls = cfg.classes[int(b.cls)]; conf = float(b.conf)
                if conf < cfg.conf_th[cls]: continue
                x1, y1, x2, y2 = [float(t) for t in b.xyxy[0]]
                d = {"pano_id": e["pano_id"], "camera_lat": e["camera_lat"], "camera_lon": e["camera_lon"],
                     "source": e.get("source", "google"), "heading": v["heading"], "pitch": v["pitch"],
                     "fov": v["fov"], "W": W, "H": H, "street": e["street"], "side": v["side"],
                     "footprint_faced": v["footprint"], "cls": cls, "conf": round(conf, 3),
                     "x1": round(x1, 1), "y1": round(y1, 1), "x2": round(x2, 1), "y2": round(y2, 1),
                     "u": round((x1 + x2) / 2, 1), "v_base": round(y2, 1),
                     # geometry only from level views of Google car imagery (user photospheres: unknown height)
                     "geom_ok": v["pitch"] == 0 and e.get("source", "google") == "google"}
                dets.append(d)
                if cls == "signboard":
                    f = f"{crop_dir}/{key.replace('|', '_')}_{len(dets)}.jpg"
                    img.crop((max(0, int(x1) - 4), max(0, int(y1) - 4), min(W, int(x2) + 4), min(H, int(y2) + 4))
                             ).save(f, quality=92)
                    d["crop"] = f
            if n % 25 == 0 or n == len(jobs):
                json.dump(dets, open(det_path, "w")); json.dump(sorted(done), open(f"{out_dir}/_views_done.json", "w"))
                progress("detect", n, len(jobs))
    json.dump(dets, open(det_path, "w")); json.dump(sorted(done), open(f"{out_dir}/_views_done.json", "w"))
    return dets, {"views": len(jobs), "failed": n_fail, "by_class": dict(Counter(d["cls"] for d in dets))}
