"""D65: measure "the cloud model on everything" vs the routed path on a sample of an area's buildings, and the time per
item of every route, ON THE SERVER (GPU, the worker's models and keys). Run as the worker user with the worker venv:

    sudo -u gcworker env $(cat /etc/geo-cascadia/worker-env.list) /opt/geo-cascadia/venv-worker/bin/python \\
        tools/measure_routes.py SAMPLE.json OUT.json          (tools/deploy/measure_routes.ps1 does all of this)

For each sampled building, its analysis photo (the run's own view and box, building_views.json) is fetched once
(Street View) and then:
  - all-cloud path: geo_cascadia.vlm.run_building_attrs with router=None — the pipeline's own code for "every building's
    use and floors to Nova Lite" (the same crop with the red box, the same prompts, the same few-shot floors call); every
    Nova call's seconds and tokens are recorded;
  - local router: UseRouter.predict on those crops (CLIP + logistic regression), seconds per crop on the GPU;
  - detector: YOLOv8s on the same full photos (the pipeline's predict settings), seconds per photo on the GPU;
  - OCR: PaddleOCR (full mode, GPU, its own venv) on the sign boxes the detector finds in those photos, seconds per crop.
The routed path's own answers, tokens and cost are the run's (vlm_buildings.json); accuracy is scored on the laptop
against the labels in SAMPLE.json (tools/routing_measured.py). Photos and crops live in a temporary folder that is deleted
at the end (Google terms); nothing is written to the area.
"""
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.environ.get("GC_ASSETS_DIR", "/opt/geo-cascadia/assets")
OCR_PY = os.environ.get("GC_OCR_PYTHON", "/opt/geo-cascadia/venv-ocr/bin/python")
sys.path.insert(0, os.path.join(ROOT, "pipeline"))


def keys():
    sys.path.insert(0, os.path.join(ROOT, "worker"))
    from server_worker import AWS_FILE, AWS_NAMES, ENV_FILE, read_env
    env, aws = read_env(ENV_FILE), read_env(AWS_FILE)
    for k in AWS_NAMES:
        if aws.get(k):
            os.environ[k] = aws[k]
    return env.get("GOOGLE_MAPS_KEY") or env.get("GOOGLE_PLACES_SERVER_KEY") or ""


def stats(xs):
    xs = [x for x in xs if x is not None]
    return {"n": len(xs), "median_s": round(statistics.median(xs), 4) if xs else None,
            "mean_s": round(sum(xs) / len(xs), 4) if xs else None, "max_s": round(max(xs), 4) if xs else None}


def ocr_child(crop_dir, out):
    """runs in the OCR venv: PaddleOCR full mode on the GPU, seconds per crop (after one warm-up read)"""
    from geo_cascadia.config import Config
    from geo_cascadia.ocr import OCR
    cfg = Config(data_dir=ASSETS, device="gpu", ocr_mode="full")
    files = sorted(os.path.join(crop_dir, f) for f in os.listdir(crop_dir) if f.endswith(".jpg"))
    t0 = time.time()
    ocr = OCR(cfg)
    load_s = time.time() - t0
    det = lambda: {"pano_id": "x", "heading": 0, "pitch": 0, "conf": 1.0, "y1": 0, "y2": 100, "H": 640}
    if files:
        ocr.read(files[0], det())                                     # warm-up (CUDA kernels)
    ts = []
    for f in files:
        t = time.time()
        ocr.read(f, det())
        ts.append(time.time() - t)
    json.dump({"load_s": round(load_s, 2), **stats(ts)}, open(out, "w"))


def main(sample_path, out_path):
    from geo_cascadia.config import Config
    from geo_cascadia.streetview import StreetView
    from geo_cascadia.vlm import VLM, run_building_attrs
    from geo_cascadia.localuse import UseRouter
    sample = json.load(open(sample_path, encoding="utf-8"))
    slug = sample.get("area", "ward29")
    area = os.path.join(ROOT, "data", "areas", slug)
    bv = {q["fp"]: q for q in json.load(open(os.path.join(area, "building_views.json"), encoding="utf-8"))}
    views = [bv[i] for i in sample["ids"]]
    cfg = Config(data_dir=ASSETS, device="gpu", ocr_mode="full")
    cfg.use_router_path = os.path.join(ASSETS, "models", "use_router.joblib")
    cfg.maps_key = keys()
    cfg = cfg.resolve()
    tmp = tempfile.mkdtemp(prefix="gc-measure-")
    out = {"area": slug, "device": cfg.device, "machine": "AWS g4dn.xlarge (NVIDIA T4)", "n": len(views),
           "measured": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    try:
        # one Street View fetch per photo; run_building_attrs and the detector reuse it
        sv = StreetView(cfg.maps_key)
        cache, fetch_s = {}, []
        real = sv.image

        def image(pano, heading=0, pitch=0, fov=90, size="640x640"):
            k = (pano, heading, pitch, fov)
            if k not in cache:
                t = time.time()
                cache[k] = real(pano, heading=heading, pitch=pitch, fov=fov, size=size)
                fetch_s.append(time.time() - t)
            return cache[k]
        sv.image = image
        for q in views:
            image(q["pano_id"], q["heading"], q["pitch"], q["fov"])
        out["street_view"] = {"photos": sv.n_images, **stats(fetch_s)}

        # all-cloud path: the pipeline's own use + floors calls for every building (router off), each call timed
        vlm = VLM(cfg)
        calls = []
        conv = vlm.converse

        def converse(content, max_tokens=400):
            txt, u = conv(content, max_tokens)
            calls.append({"kind": "floors" if max_tokens <= 20 else "use", "lat_s": u.get("lat_s"), "in": u.get("in", 0),
                          "out": u.get("out", 0), "images": sum(1 for c in content if isinstance(c, dict) and "image" in c)})
            return txt, u
        vlm.converse = converse
        t = time.time()
        recs, shots_ok = run_building_attrs(views, sv, vlm, cfg, tmp, router=None)
        out["all_cloud"] = {"wall_s": round(time.time() - t, 2), "workers": cfg.vlm_workers, "floors_examples": shots_ok,
                            "calls": calls, "use": stats(c["lat_s"] for c in calls if c["kind"] == "use"),
                            "floors": stats(c["lat_s"] for c in calls if c["kind"] == "floors"),
                            "buildings": [{"fp": r["fp"], "use": (r.get("vlm") or {}).get("building_use"),
                                           "wrong_target": (r.get("vlm") or {}).get("wrong_target"),
                                           "roofline_visible": (r.get("vlm") or {}).get("roofline_visible"),
                                           "floors_confident": (r.get("vlm") or {}).get("floors_confident"),
                                           "floors": r.get("floors_a"), "in": r.get("in", 0), "out": r.get("out", 0),
                                           "use_lat_s": r.get("lat_s"), "floors_in": r.get("floors_in", 0),
                                           "floors_out": r.get("floors_out", 0)} for r in recs]}

        # local router on the same crops (GPU): load once, warm up, then time the batch and one crop at a time
        crops = [os.path.join(tmp, "crops_building", f"{q['fp']}.jpg") for q in views]
        crops = [c for c in crops if os.path.isfile(c)]
        # UseRouter.predict loads CLIP on every call; the pipeline calls it once per run for all crops. So: one call
        # with 1 crop (≈ the load) and one with all crops; per-crop compute = the difference / (n - 1)
        router = UseRouter(cfg.use_router_path, cfg.device)
        router.predict(crops[:1])                                     # first ever load (model download / CUDA init)
        t = time.time(); router.predict(crops[:1]); t1 = time.time() - t
        t = time.time(); pr = router.predict(crops); tn = time.time() - t
        out["router"] = {"call_1_crop_s": round(t1, 3), "call_all_crops_s": round(tn, 3), "n": len(crops),
                         "per_crop_s": round((tn - t1) / max(len(crops) - 1, 1), 4),
                         "per_building_in_a_run_s": round(tn / max(len(crops), 1), 4), "threshold": router.t,
                         "decided_locally": sum(p >= router.t for _, p in pr)}

        # detector on the same full photos (GPU), the pipeline's predict settings; sign boxes cut for OCR
        from ultralytics import YOLO
        t = time.time()
        model = YOLO(cfg.yolo_weights)
        yload = time.time() - t
        imgs = [cache[(q["pano_id"], q["heading"], q["pitch"], q["fov"])] for q in views]
        imgs = [i for i in imgs if i is not None]
        kw = dict(conf=cfg.base_conf, imgsz=640, iou=cfg.nms_iou, agnostic_nms=True, device=0, verbose=False)
        model.predict(imgs[0], **kw)
        ts, sign_dir, n_sign = [], os.path.join(tmp, "signs"), 0
        os.makedirs(sign_dir)
        for k, img in enumerate(imgs):
            t = time.time(); res = model.predict(img, **kw)[0]; ts.append(time.time() - t)
            for b in res.boxes:
                cls = cfg.classes[int(b.cls)]
                if cls == "signboard" and float(b.conf) >= cfg.conf_th[cls]:
                    x1, y1, x2, y2 = [float(v) for v in b.xyxy[0]]
                    W, H = img.size
                    img.crop((max(0, int(x1) - 4), max(0, int(y1) - 4), min(W, int(x2) + 4), min(H, int(y2) + 4))
                             ).save(os.path.join(sign_dir, f"{k:02d}_{n_sign}.jpg"), quality=92)
                    n_sign += 1
        out["detector"] = {"load_s": round(yload, 2), "per_photo": stats(ts), "photos": len(imgs)}

        # OCR in its own venv (as the worker runs it)
        res_path = os.path.join(tmp, "ocr.json")
        env = {**os.environ, "PYTHONPATH": os.path.join(ROOT, "pipeline")}
        p = subprocess.run([OCR_PY, os.path.abspath(__file__), "--ocr", sign_dir, res_path], env=env,
                           capture_output=True, text=True, timeout=1800)
        out["ocr"] = ({**json.load(open(res_path)), "crops": n_sign} if p.returncode == 0 and os.path.isfile(res_path)
                      else {"error": (p.stderr or "").strip().splitlines()[-1:] or ["?"], "crops": n_sign})
    finally:
        n_img = sum(1 for r, _, fs in os.walk(tmp) for f in fs if f.endswith(".jpg"))
        shutil.rmtree(tmp, ignore_errors=True)
        out["deleted_images"] = n_img
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k not in ("all_cloud",)}, indent=1))


if __name__ == "__main__":
    if sys.argv[1] == "--ocr":
        ocr_child(sys.argv[2], sys.argv[3])
    else:
        main(sys.argv[1], sys.argv[2])
