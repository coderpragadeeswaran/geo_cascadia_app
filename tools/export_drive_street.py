"""Export one street's "drive" data for the design preview (Night Survey, "Drive the street" mock).

Real Ward 29 data only: the pipeline's camera stops on the street (plan.json), the merged OSM street line
(streets.json), streetlights / poles / buildings / unmapped businesses near the line (export.json) and the gap display
ranges (backend/app/streetgeo.py, D13). Everything is placed by distance along the road (metres).

Usage:  backend/.venv/Scripts/python tools/export_drive_street.py
Writes: web/src/design/data/ward29-sathy-drive.json
"""
import json
import math
import os
import sys

from shapely.geometry import LineString, MultiLineString, Point
from shapely.ops import linemerge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
from app.streetgeo import gap_display, named_streets  # noqa: E402

AREA = os.path.join(ROOT, "data", "areas", "ward29")
STREET = "Sathy Main Road"
NEAR_M = 45          # objects within this distance of the line are "passed" on the drive
OUT = os.path.join(ROOT, "web", "src", "design", "data", "ward29-sathy-drive.json")


def read(n):
    with open(os.path.join(AREA, n), encoding="utf-8") as f:
        return json.load(f)


exp, plan, streets, names = read("export.json"), read("plan.json"), read("streets.json"), read("street_names.json")
lat0 = sum(c["camera_lat"] for c in plan) / len(plan)
lon0 = sum(c["camera_lon"] for c in plan) / len(plan)
kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
xy = lambda lat, lon: ((lon - lon0) * kx, (lat - lat0) * ky)
ll = lambda x, y: [round(lat0 + y / ky, 7), round(lon0 + x / kx, 7)]

raw = next(s for s in streets if s["name"] == STREET)
merged = linemerge(MultiLineString([LineString([xy(*p) for p in ln]) for ln in raw["lines_latlon"]]))
pieces = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
cams_all = [c for c in plan if c["street"] == STREET]
line = max(pieces, key=lambda ln: sum(ln.distance(Point(*xy(c["camera_lat"], c["camera_lon"]))) < 15 for c in cams_all))


def bearing_at(s):
    a, b = line.interpolate(max(0, s - 5)), line.interpolate(min(line.length, s + 5))
    return round(math.degrees(math.atan2(b.x - a.x, b.y - a.y)) % 360, 1)


cams = []
for c in cams_all:
    p = Point(*xy(c["camera_lat"], c["camera_lon"]))
    if line.distance(p) <= 15:
        s = line.project(p)
        cams.append({"pano_id": c["pano_id"], "lat": c["camera_lat"], "lon": c["camera_lon"], "s": round(s, 1),
                     "heading": bearing_at(s), "source": c.get("source")})
cams.sort(key=lambda c: c["s"])

near = lambda lat, lon: line.distance(Point(*xy(lat, lon))) <= NEAR_M
at = lambda lat, lon: round(line.project(Point(*xy(lat, lon))), 1)


def side_of(lat, lon):
    s = line.project(Point(*xy(lat, lon)))
    a, b = line.interpolate(max(0, s - 3)), line.interpolate(min(line.length, s + 3))
    px, py = xy(lat, lon)
    cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x)
    return "left" if cross > 0 else "right"


named = named_streets(streets, names)
disp = gap_display(exp, named, plan, names)
gaps = []
for g in exp["streetlight_gaps"]:
    if g["street"] != STREET:
        continue
    d = disp.get(g["id"], {})
    s0, s1 = sorted((at(*g["start"]), at(*g["end"])))
    if line.distance(Point(*xy(*g["start"]))) <= 25 and line.distance(Point(*xy(*g["end"]))) <= 25:
        gaps.append({"id": g["id"], "s0": s0, "s1": s1, "length_m": g["length_m"], "along_road_m": d.get("along_road_m"),
                     "gap_type": g["gap_type"], "mode": d.get("mode")})

assets = [{"id": a["id"], "type": a["type"], "lat": a["lat"], "lon": a["lon"], "s": at(a["lat"], a["lon"]),
           "side": side_of(a["lat"], a["lon"]), "method": a["method"], "register": (a.get("register") or {}).get("status")}
          for a in exp["assets"] if near(a["lat"], a["lon"])]
buildings = []
for b in exp["buildings"]:
    if b["street"] != STREET or not near(b["lat"], b["lon"]):
        continue
    at_ = b["attributes"]
    buildings.append({"id": b["id"], "lat": b["lat"], "lon": b["lon"], "s": at(b["lat"], b["lon"]), "side": side_of(b["lat"], b["lon"]),
                      "status": b["match_status"], "use": at_["use"]["value"], "floors": at_["floors"]["value"],
                      "name": at_["name"]["value"] if at_["name"].get("quality") == "good" else None,
                      "discrepancies": b.get("discrepancies", [])})
unmapped = [{"id": u["id"], "name": u["name"], "lat": u["lat"], "lon": u["lon"], "s": at(u["lat"], u["lon"]), "side": side_of(u["lat"], u["lon"])}
            for u in exp.get("unmapped_businesses", []) if near(u["lat"], u["lon"])]

out = {
    "area": "ward29", "street": STREET, "length_m": round(line.length), "source": "plan.json + streets.json + export.json (real Ward 29 data)",
    "line": [ll(x, y) for x, y in line.coords],
    "cameras": cams, "gaps": gaps,
    "assets": sorted(assets, key=lambda a: a["s"]), "buildings": sorted(buildings, key=lambda b: b["s"]),
    "unmapped": sorted(unmapped, key=lambda u: u["s"]),
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print(f"{STREET}: {out['length_m']} m, {len(cams)} camera stops, {len(gaps)} gaps, "
      f"{sum(a['type'] == 'streetlight' for a in assets)} lamps, {sum(a['type'] == 'pole' for a in assets)} poles, "
      f"{len(buildings)} buildings, {len(unmapped)} unmapped → {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KB)")
