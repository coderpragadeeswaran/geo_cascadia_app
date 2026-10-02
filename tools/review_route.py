"""P8: the review items still waiting in an area, as one ordered walking route (CSV + GeoJSON) for a field check.

    backend\\.venv\\Scripts\\python tools\\review_route.py ward29            # -> data/exports/review_route_ward29.{csv,geojson}
    backend\\.venv\\Scripts\\python tools\\review_route.py ward29 --all      # every review item, decided ones too

Order: start at the item nearest the area's south-west corner, then always walk to the nearest unvisited item, then
2-opt until no swap shortens the route. Distances are straight lines between the items (no road network), so the real
walk is longer. Review state comes from the database when it is reachable (else the saved files: all waiting).
"""
import argparse
import csv
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from app.settings import Settings  # noqa: E402
from app.store import Data  # noqa: E402


def metres(a, b):
    k = 111320 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[1] - b[1]) * k, (a[0] - b[0]) * 110540)


def order(pts):
    if len(pts) < 3:
        return list(range(len(pts)))
    start = min(range(len(pts)), key=lambda i: pts[i][0] + pts[i][1])
    route, left = [start], set(range(len(pts))) - {start}
    while left:
        nxt = min(left, key=lambda j: metres(pts[route[-1]], pts[j]))
        route.append(nxt)
        left.remove(nxt)
    better = True
    while better:                                                   # 2-opt on an open path
        better = False
        for i in range(1, len(route) - 1):
            for j in range(i + 1, len(route)):
                a, b = pts[route[i - 1]], pts[route[i]]
                c = pts[route[j]]
                d = pts[route[j + 1]] if j + 1 < len(route) else None
                old = metres(a, b) + (metres(c, d) if d else 0)
                new = metres(a, c) + (metres(b, d) if d else 0)
                if new < old - 1e-6:
                    route[i:j + 1] = reversed(route[i:j + 1])
                    better = True
    return route


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("area")
    ap.add_argument("--all", action="store_true", help="include decided items")
    a = ap.parse_args()
    D = Data(Settings())
    b, offline = D.read(lambda s: s.bundle(a.area))
    items = [q for q in b["review_queue"] if a.all or (q.get("status") or "pending") == "pending"]
    items = [q for q in items if q.get("lat") is not None and q.get("lon") is not None]
    pts = [(q["lat"], q["lon"]) for q in items]
    route = order(pts)
    out_dir = os.path.join(ROOT, "data", "exports")
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.join(out_dir, f"review_route_{a.area}")
    rows, cum, prev = [], 0.0, None
    for k, i in enumerate(route, 1):
        q = items[i]
        leg = metres(prev, pts[i]) if prev else 0.0
        cum += leg
        prev = pts[i]
        rows.append({"stop": k, "item_type": q["item_type"], "ref": q.get("ref_id") or q.get("building_id") or q.get("asset_cls"),
                     "street": q.get("street"), "lat": round(q["lat"], 7), "lon": round(q["lon"], 7), "priority": q.get("priority"),
                     "status": q.get("status") or "pending", "reasons": "; ".join(q.get("reasons") or []),
                     "leg_m": round(leg), "cumulative_m": round(cum),
                     "maps_link": f"https://www.google.com/maps/search/?api=1&query={q['lat']:.6f},{q['lon']:.6f}"})
    with open(base + ".csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ["stop"])
        w.writeheader()
        w.writerows(rows)
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
              "properties": {k: v for k, v in r.items() if k not in ("lat", "lon")}} for r in rows]
    if len(rows) > 1:
        feats.insert(0, {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[r["lon"], r["lat"]] for r in rows]},
                         "properties": {"what": "walking order (straight lines between items, not along roads)",
                                        "stops": len(rows), "length_m": round(cum)}})
    with open(base + ".geojson", "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f)
    print(f"{len(rows)} review items ({'all' if a.all else 'waiting'}) in {a.area}{' (offline copy)' if offline else ''}: "
          f"{round(cum):,} m in straight lines -> {base}.csv / .geojson")


if __name__ == "__main__":
    main()
