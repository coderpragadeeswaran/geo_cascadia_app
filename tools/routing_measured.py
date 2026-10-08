r"""D65: "cloud model on everything" vs routed, MEASURED on a labelled sample, for Under the Hood › Routing and cost.

    backend\.venv\Scripts\python tools\routing_measured.py data\measure\ward29_routing_sample.json SERVER_OUT.json

Inputs: the sample with its labels (data/measure/<area>_routing_sample.json: building ids, use and floors labelled by
viewing each building's analysis photo — an AI check by Claude Code, not a human one), the server measurement
(tools/measure_routes.py: the all-cloud path's answers, tokens and seconds per call; seconds per item for the detector,
OCR and the local router on the server GPU) and the area's own run files (the routed path's answers and tokens:
vlm_buildings.json). Writes data/areas/<area>/routing_measured.json. No photo, no model call.

Scored per building, on the same raw answers for both paths (the model's answer before any rule fills an unknown use from
a sign): use at the commercial / residential / other level (no answer = wrong), floors exact and within one floor.
Cost = tokens x the pipeline's Nova Lite prices. Time per building = the steps that building goes through, one after the
other: routed = the local router (+ the cloud use call when the router is unsure) + the floors call; all-cloud = the use
call + the floors call. The floors call is the same in both paths; its time is the one measured on the server.
"""
import json
import os
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.localuse import USE3  # noqa: E402

CFG = Config()
LOCAL = "tier1_local_clip"


def usd(i, o):
    return (i or 0) / 1e6 * CFG.vlm_in_per_m + (o or 0) / 1e6 * CFG.vlm_out_per_m


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 3) if xs else None


def pct(k, n):
    return round(k / n, 3) if n else None


def main(sample_path, server_path):
    S = json.load(open(sample_path, encoding="utf-8"))
    M = json.load(open(server_path, encoding="utf-8"))
    slug = M.get("area", "ward29")
    folder = os.path.join(ROOT, "data", "areas", slug)
    run = {r["fp"]: r for r in json.load(open(os.path.join(folder, "vlm_buildings.json"), encoding="utf-8")) if "vlm" in r}
    cloud = {b["fp"]: b for b in M["all_cloud"]["buildings"]}
    router_s = M["router"]["per_building_in_a_run_s"]
    rows = []
    for bid in S["ids"]:
        lab, r, c = S["labels"][bid], run[bid], cloud.get(bid, {})
        rv = r.get("vlm") or {}
        routed_local = rv.get("use_route") == LOCAL
        rows.append({
            "id": bid, "label_use": lab["use"], "label_floors": lab["floors"],
            "routed": {"route": "local" if routed_local else "cloud", "use": None if rv.get("wrong_target") else rv.get("building_use"),
                       "floors": r.get("floors_a"),
                       "usd": usd(0 if routed_local else r.get("in"), 0 if routed_local else r.get("out")) + usd(r.get("floors_in"), r.get("floors_out")),
                       "calls": (0 if routed_local else 1) + (1 if r.get("floors_a") is not None else 0),
                       "use_s": None if routed_local else r.get("lat_s")},
            "all_cloud": {"use": None if c.get("wrong_target") else c.get("use"), "floors": c.get("floors"),
                          "usd": usd(c.get("in"), c.get("out")) + usd(c.get("floors_in"), c.get("floors_out")),
                          "calls": (1 if c.get("in") else 0) + (1 if c.get("floors") is not None else 0),
                          "use_s": c.get("use_lat_s")}})
    fl = [x["lat_s"] for x in M["all_cloud"]["calls"] if x["kind"] == "floors"]
    floors_med = med(fl)
    use_med = med(x["lat_s"] for x in M["all_cloud"]["calls"] if x["kind"] == "use")

    def path(key):
        P = [x[key] for x in rows]
        n = len(rows)
        use_ok = sum(USE3(p["use"] or "") == x["label_use"] and p["use"] is not None for p, x in zip(P, rows))
        fpairs = [(p["floors"], x["label_floors"]) for p, x in zip(P, rows) if p["floors"] is not None]
        secs = []
        for p in P:
            s = (router_s if key == "routed" else 0.0) + ((p["use_s"] or use_med) if (key == "all_cloud" or p.get("route") == "cloud") else 0.0)
            secs.append(s + (floors_med or 0.0))
        return {"n": n, "use_correct": use_ok, "use_accuracy": pct(use_ok, n), "use_no_answer": sum(p["use"] is None for p in P),
                "floors_n": len(fpairs), "floors_exact": pct(sum(a == b for a, b in fpairs), len(fpairs)),
                "floors_within_1": pct(sum(abs(a - b) <= 1 for a, b in fpairs), len(fpairs)),
                "floors_no_answer": n - len(fpairs),
                "usd_per_building": round(sum(p["usd"] for p in P) / n, 7), "usd_sample": round(sum(p["usd"] for p in P), 6),
                "cloud_calls": sum(p["calls"] for p in P),
                "s_per_building": round(statistics.median(secs), 2), "s_per_building_mean": round(sum(secs) / n, 2)}
    routed, allc = path("routed"), path("all_cloud")
    out = {
        "area": slug, "measured": M["measured"], "machine": M["machine"], "device": M["device"], "n": len(rows),
        "sample": {"rule": S["rule"], "seed": S["seed"], "labeller": S["labeller"], "labelled": S["labelled"]},
        "paths": {"routed": {"label": "As run (routed): local router first, the cloud model when it is unsure; floors by the cloud model",
                             "source": "this run's own answers and tokens (vlm_buildings.json)", **routed},
                  "all_cloud": {"label": "Cloud model on everything: every building's use and floors by Nova Lite",
                                "source": f"measured {M['measured'][:10]}: the pipeline's own use and floors calls with the router off",
                                **allc}},
        "routed_decided_locally": sum(x["routed"]["route"] == "local" for x in rows),
        "latency": [
            {"step": "Find objects in a photo", "model": "YOLOv8s", "route": "local", "unit": "photo",
             "s": M["detector"]["per_photo"]["median_s"], "n": M["detector"]["per_photo"]["n"], "where": M["machine"] + ", GPU"},
            {"step": "Read a sign crop", "model": "PaddleOCR (full, English + Tamil)", "route": "local", "unit": "sign crop",
             "s": (M.get("ocr") or {}).get("median_s"), "n": (M.get("ocr") or {}).get("n"), "where": M["machine"] + ", GPU"},
            {"step": "Building use, local", "model": "CLIP + logistic regression", "route": "local", "unit": "building",
             "s": M["router"]["per_crop_s"], "n": M["router"]["n"], "where": M["machine"] + ", GPU",
             "note": f"+ {M['router']['call_1_crop_s']} s to load the model once per run"},
            {"step": "Building use, cloud", "model": "Amazon Nova Lite", "route": "cloud", "unit": "building", "s": use_med,
             "n": sum(1 for x in M["all_cloud"]["calls"] if x["kind"] == "use"), "where": "AWS Bedrock (ap-south-1), called from the server"},
            {"step": "Floors, cloud (3 images per call)", "model": "Amazon Nova Lite", "route": "cloud", "unit": "building", "s": floors_med,
             "n": len(fl), "where": "AWS Bedrock (ap-south-1), called from the server"}],
        "spend": {"street_view_photos": M["street_view"]["photos"], "street_view_usd": round(M["street_view"]["photos"] * CFG.sv_price, 2),
                  "nova_usd": round(sum(usd(x["in"], x["out"]) for x in M["all_cloud"]["calls"]), 5),
                  "nova_calls": len(M["all_cloud"]["calls"])},
        "rows": rows}
    p = os.path.join(folder, "routing_measured.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(json.dumps({k: out[k] for k in ("n", "paths", "latency", "spend", "routed_decided_locally")}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
