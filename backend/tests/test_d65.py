"""D65 (pre-review fixes): camera-only buildings counted inside the area only; the server worker's start line says an
interrupted street continues; a measured routed-vs-all-cloud comparison replaces the estimates in Routing and cost."""
import json
import os

from app import camonly, routing
from app.settings import ROOT, Settings

S = Settings()
AREAS = os.path.join(ROOT, "data", "areas")


def test_camera_only_inside_the_area_only():
    counts = {s: camonly.count(s, AREAS) for s in ("ward29", "tiruppur_uthukuli_road", "trichy_bharathidasan_salai")}
    assert counts == {"ward29": 9, "tiruppur_uthukuli_road": 11, "trichy_bharathidasan_salai": 79}
    for slug in counts:
        with open(os.path.join(AREAS, slug, "building_positions.json"), encoding="utf-8") as f:
            n = sum(1 for q in json.load(f)["no_footprint"] if q.get("lat") is not None)
        assert camonly.count(slug, AREAS) <= n                                   # never more than the run found


def test_server_worker_says_an_interrupted_street_continues():
    src = open(os.path.join(ROOT, "worker", "colab_worker.py"), encoding="utf-8").read()
    srv = open(os.path.join(ROOT, "worker", "server_worker.py"), encoding="utf-8").read()
    assert "KEEPS_JOB_FILES = False" in src and "an interrupted street continues from its saved stages" in src
    assert "KEEPS_JOB_FILES=True" in srv                                         # the server keeps the job's files


def _fake_measurement():
    path = lambda **k: {"label": "x", "source": "y", "n": 30, "use_correct": 27, "use_accuracy": 0.9, "use_no_answer": 0,
                        "floors_n": 30, "floors_exact": 0.6, "floors_within_1": 0.95, "floors_no_answer": 0,
                        "usd_per_building": 0.0003, "usd_sample": 0.009, "cloud_calls": 45, "s_per_building": 2.1,
                        "s_per_building_mean": 2.2, **k}
    lat = [{"step": "Find objects in a photo", "model": "YOLOv8s", "route": "local", "unit": "photo", "s": 0.021, "n": 30, "where": "T4"},
           {"step": "Read a sign crop", "model": "PaddleOCR", "route": "local", "unit": "sign crop", "s": 0.3, "n": 40, "where": "T4"},
           {"step": "Building use, local", "model": "CLIP", "route": "local", "unit": "building", "s": 0.01, "n": 30, "where": "T4", "note": "+ 3 s"},
           {"step": "Building use, cloud", "model": "Nova", "route": "cloud", "unit": "building", "s": 1.1, "n": 30, "where": "AWS"},
           {"step": "Floors, cloud (3 images per call)", "model": "Nova", "route": "cloud", "unit": "building", "s": 1.4, "n": 30, "where": "AWS"}]
    return {"measured": "2026-10-09T10:00:00Z", "machine": "AWS g4dn.xlarge (NVIDIA T4)", "n": 30, "routed_decided_locally": 18,
            "sample": {"rule": "r", "seed": 1, "labeller": "AI", "labelled": "2026-10-09"},
            "paths": {"routed": path(), "all_cloud": path(cloud_calls=60)}, "latency": lat,
            "spend": {"street_view_photos": 30, "street_view_usd": 0.21, "nova_usd": 0.012, "nova_calls": 60}}


def test_measured_comparison_replaces_the_estimates():
    from app.store import JsonStore
    from app.hood import RunFiles
    b = JsonStore(AREAS).bundle("ward29")
    F = dict(RunFiles(AREAS).get("ward29"))
    n = {"views_fetched": 1132, "views": 1132, "boxes": 100, "sign_crops": 10, "signs_ocr": 5, "signs_vlm": 2, "signs_no_text": 3,
         "signs_skipped": 0, "photos_fetched": 1300}
    F.pop("routing_measured", None)
    est = routing.routing(b, F, n, {})
    assert est["measured"] is None and est["all_cloud"] is not None and est["every_view"] is not None
    F["routing_measured"] = _fake_measurement()
    r = routing.routing(b, F, n, {})
    assert r["all_cloud"] is None and r["every_view"] is None and r["measured"]["n"] == 30
    lat = {(t["key"], x["route"]): x["lat_s"] for t in r["tasks"] for x in t["routes"]}
    assert lat[("detect", "local")] == 0.021 and lat[("signs", "local")] == 0.3 and lat[("use", "local")] == 0.01
    assert lat[("floors", "cloud")] == 1.4
