"""Drive the street (design pass B §4): the pipeline's real camera stops along one street, in driving order.

Fix for the preview's jumping / backward-flipping drive:
- the street's OSM pieces are merged (as the pipeline's plan does) and every merged piece is its own BRANCH
  (e.g. Sathy Main Road: 803 m main line, 111 m and 37 m side pieces) — stops are never interleaved across branches;
- each camera stop belongs to the nearest branch and is ordered by its distance ALONG that branch (s), deduplicated so
  s is strictly increasing (a scrubber step always moves forward);
- "forward" is the road's tangent at s in the travel direction (s increasing), not the direction to the next stop;
  left / right are forward ∓ 90°.
Findings are placed by the same along-road distance: dark stretches (s0–s1), lamps and poles, buildings and businesses
(with their side of the road). Reads plan.json next to export.json (the pipeline's camera plan); no imagery.
"""
import json
import math
import os
import threading

from shapely.geometry import LineString, MultiLineString, Point, shape
from shapely.ops import linemerge, transform

from geo_cascadia.geo import Frame

STOP_SNAP_M = 20          # a camera stop farther than this from every branch is not on the street
MIN_STEP_M = 4            # stops closer than this along the road are the same place (keep the one nearest the line)
TANGENT_M = 8             # half-window for the road tangent
ASSET_M, BUILDING_M, UNMAPPED_M, GAP_END_M = 25, 60, 45, 25


class Plans:
    """plan.json per area, cached by mtime (DB mode keeps the run files next to export.json too)."""

    def __init__(self, areas_dir):
        self.dir = areas_dir
        self._cache, self._lock = {}, threading.Lock()

    def get(self, slug):
        path = os.path.join(self.dir, slug, "plan.json")
        if not os.path.isfile(path):
            return None
        stamp = os.path.getmtime(path)
        with self._lock:
            hit = self._cache.get(slug)
            if hit and hit[0] == stamp:
                return hit[1]
        with open(path, encoding="utf-8") as f:
            plan = json.load(f)
        with self._lock:
            self._cache[slug] = (stamp, plan)
        return plan


def _bearing(a, b):
    return math.degrees(math.atan2(b.x - a.x, b.y - a.y)) % 360


def tangent(line, s):
    """Road bearing at s in the direction of increasing s (window ±8 m, clamped at the ends)."""
    a = line.interpolate(max(0.0, s - TANGENT_M))
    b = line.interpolate(min(line.length, s + TANGENT_M))
    if a.distance(b) < 0.5:
        a, b = line.interpolate(max(0.0, s - 2 * TANGENT_M)), line.interpolate(min(line.length, s + 2 * TANGENT_M))
    return round(_bearing(a, b), 1)


def side(line, s, p):
    a, b = line.interpolate(max(0.0, s - 3)), line.interpolate(min(line.length, s + 3))
    cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    return "left" if cross > 0 else "right"


def drive(bundle, plan, street):
    """{street, length_m, branches: [...]} or None when the street is unknown. Branches without camera stops are left
    out (nothing to drive); the main (longest) branch first."""
    s = next((x for x in bundle["streets"] if x["name"] == street), None)
    if s is None or not s.get("geometry"):
        return None
    g = shape(s["geometry"])
    c = g.centroid
    F = Frame(c.y, c.x)
    xy = lambda lat, lon: Point(F.xy(lat, lon))
    ll = lambda p: [round(v, 7) for v in F.ll(p[0], p[1])]
    parts = list(g.geoms) if hasattr(g, "geoms") else [g]
    merged = linemerge(MultiLineString([transform(lambda lon, lat, z=None: F.xy(lat, lon), p) for p in parts]))
    branches = sorted(list(merged.geoms) if hasattr(merged, "geoms") else [merged], key=lambda l: -l.length)

    # camera stops of this street (plan.json uses the raw OSM label), each on its nearest branch
    raw = {s.get("osm_name"), s["name"]}
    stops = [[] for _ in branches]
    for cam in plan or []:
        if cam.get("street") not in raw:
            continue
        p = xy(cam["camera_lat"], cam["camera_lon"])
        d = [b.distance(p) for b in branches]
        i = min(range(len(branches)), key=lambda k: d[k])
        if d[i] <= STOP_SNAP_M:
            stops[i].append((branches[i].project(p), d[i], cam))

    gaps = [g2 for g2 in bundle["streetlight_gaps"] if g2.get("street") == street]
    disp = bundle.get("gap_display") or {}
    out = []
    for i, line in enumerate(branches):
        if not stops[i]:
            continue
        kept = []
        for sv, dist, cam in sorted(stops[i], key=lambda t: t[0]):
            if kept and sv - kept[-1][0] < MIN_STEP_M:
                if dist < kept[-1][1]:
                    kept[-1] = (sv, dist, cam)                    # same place: keep the stop nearest the line
                continue
            kept.append((sv, dist, cam))
        near = lambda lat, lon, m: line.distance(xy(lat, lon)) <= m
        at = lambda lat, lon: round(line.project(xy(lat, lon)), 1)
        br = {
            "id": i, "length_m": round(line.length), "line": [ll(p) for p in line.coords],
            "stops": [{"pano_id": cam["pano_id"], "lat": cam["camera_lat"], "lon": cam["camera_lon"], "s": round(sv, 1),
                       "heading": tangent(line, sv), "source": cam.get("source")} for sv, _, cam in kept],
            "gaps": [], "lamps": [], "poles": [], "buildings": [], "unmapped": [],
        }
        for g2 in gaps:
            d = disp.get(g2["id"]) or {}
            path = d.get("path") if d.get("mode") == "along_road" else None
            ends = [(path[0][1], path[0][0]), (path[-1][1], path[-1][0])] if path else [tuple(g2["start"]), tuple(g2["end"])]
            if all(near(la, lo, GAP_END_M) for la, lo in ends):
                s0, s1 = sorted(at(la, lo) for la, lo in ends)
                br["gaps"].append({"id": g2["id"], "s0": s0, "s1": s1, "length_m": g2["length_m"], "gap_type": g2.get("gap_type"),
                                   "mode": d.get("mode", "straight"), "along_road_m": d.get("along_road_m"), "poles_inside": g2.get("poles_inside")})
        for a in bundle["assets"]:
            if near(a["lat"], a["lon"], ASSET_M):
                sv = at(a["lat"], a["lon"])
                br["lamps" if a["type"] == "streetlight" else "poles"].append({
                    "id": a["id"], "lat": a["lat"], "lon": a["lon"], "s": sv, "side": side(line, sv, xy(a["lat"], a["lon"])),
                    "approximate": a.get("method") != "triangulated", "register": (a.get("register") or {}).get("status")})
        for b in bundle["buildings"]:
            if b.get("street") == street and near(b["lat"], b["lon"], BUILDING_M):
                at_ = b.get("attributes") or {}
                nm = at_.get("name") or {}
                sv = at(b["lat"], b["lon"])
                br["buildings"].append({"id": b["id"], "lat": b["lat"], "lon": b["lon"], "s": sv, "side": side(line, sv, xy(b["lat"], b["lon"])),
                                        "status": b.get("match_status"), "use": (at_.get("use") or {}).get("value"),
                                        "floors": (at_.get("floors") or {}).get("value"),
                                        "name": nm.get("value") if nm.get("quality") == "good" else None,
                                        "discrepancies": b.get("discrepancies") or []})
        for u in bundle["unmapped_businesses"]:
            if near(u["lat"], u["lon"], UNMAPPED_M):
                sv = at(u["lat"], u["lon"])
                br["unmapped"].append({"id": u["id"], "name": u.get("name"), "lat": u["lat"], "lon": u["lon"], "s": sv,
                                       "side": side(line, sv, xy(u["lat"], u["lon"]))})
        for k in ("gaps", "lamps", "poles", "buildings", "unmapped"):
            br[k].sort(key=lambda x: x.get("s", x.get("s0", 0)))
        out.append(br)
    skipped = [round(b.length) for i, b in enumerate(branches) if not stops[i]]
    return {"street": street, "osm_name": s.get("osm_name"), "length_m": round(sum(b.length for b in branches)), "branches": out,
            "pieces_without_stops_m": skipped}
