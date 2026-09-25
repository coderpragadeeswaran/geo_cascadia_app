"""P0 setup: build run_report.json for every area folder, then print the area inventory and data-consistency list.

Usage:  python tools/p0_setup.py            (from the repo root; laptop-safe: no API calls, no models)
        python tools/p0_setup.py --no-build (inventory only)
"""
import os, sys, json, subprocess, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
from app.derived import computed_counts, consistency  # noqa: E402

AREAS = os.path.join(ROOT, "data", "areas")


def load(p):
    with open(p, encoding="utf-8") as f: return json.load(f)


def main():
    sys.stdout.reconfigure(encoding="utf-8")  # Windows console default is cp1252
    ap =argparse.ArgumentParser(); ap.add_argument("--no-build", action="store_true"); a = ap.parse_args()
    slugs = sorted(d for d in os.listdir(AREAS) if os.path.isfile(os.path.join(AREAS, d, "export.json")))
    if not a.no_build:
        for s in slugs:
            r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_run_report.py"), os.path.join(AREAS, s)],
                               capture_output=True, text=True, encoding="utf-8", env={**os.environ, "PYTHONUTF8": "1"})
            if r.returncode: sys.exit(f"build_run_report failed for {s}:\n{r.stderr}")
            print(f"run_report.json built: {s}")
    mc = load(os.path.join(ROOT, "data", "model_card.json"))
    keys = ["buildings", "assets", "missing_asset_records", "streetlight_gaps_60m", "review_items", "unmapped_businesses"]
    print(f"\n{'area':30} " + " ".join(f"{k[:14]:>14}" for k in keys) + "  counts==records")
    issues = {}
    for s in slugs:
        exp = load(os.path.join(AREAS, s, "export.json"))
        rr_p = os.path.join(AREAS, s, "run_report.json")
        rr = load(rr_p) if os.path.exists(rr_p) else None
        C, mc_counts = computed_counts(exp), exp["meta"]["counts"]
        ok = all(mc_counts.get(k, C[k]) == C[k] for k in keys)
        print(f"{s:30} " + " ".join(f"{C[k]:>14}" for k in keys) + f"  {'yes' if ok else 'NO'}")
        issues[s] = (exp["meta"]["area"], C, consistency(exp, rr, mc))
    for s, (name, C, iss) in issues.items():
        print(f"\n== {s} — {name}")
        print(f"   streets {C['streets']} | match {C['match_status']} | use_route {C['use_route']} | "
              f"assets triangulated {C['assets_triangulated']} (2+ cameras {C['assets_seen_by_2plus_cameras']})")
        for i in iss or [{"field": "(no mismatches)", "stored": "", "computed": "", "note": ""}]:
            print(f"   ! {i['field']}: stored {i['stored']} vs computed {i['computed']}" + (f"  [{i['note']}]" if i['note'] else ""))


if __name__ == "__main__":
    main()
