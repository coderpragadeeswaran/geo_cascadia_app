"""Gate 1 evaluation of predicted building positions (D26): before (box-centre rays, P4.5 part 1) vs after (wall-corner
rays), against two references. No hand labels.

Usage:  python tools/eval_gate1.py [slug ...]          (default: every area folder with run files)

References
  a) "vs OSM facade": distance from the predicted point to the ROAD-FACING edge of the building's OSM footprint (the
     edge whose midpoint is nearest the building's street line, streets.json). Scored for triangulated points only;
     single_ray points are listed separately as "uses footprint" (they are placed on the footprint, so the check is
     circular). The footprint centroid is scored too, as a do-nothing baseline.
  b) "vs Google pin": for buildings with sign text (attributes.name.value, else the sign view's OCR text), the place is
     looked up with Places API (New) Text Search biased to a 50 m circle around the building; the first result within
     50 m whose name is the same business (textmatch.same_business) is the match. Needs a SERVER-side Places key in
     backend/.env as GOOGLE_PLACES_SERVER_KEY (the Maps browser key is referrer-restricted and is never used here).
     Only place_id + distances are stored (data/areas/<slug>/gate1_places.json, gate1_eval.json); fetched coordinates
     stay in memory (Google ToS). Without the key this reference is reported as not run.

Output: data/areas/<slug>/gate1_eval.json per area; data/model_card.json "gate1_position" (last key, replaced on re-run).
The key is never printed; API errors print only the HTTP status.
"""
import datetime
import json
import math
import os
import statistics
import sys

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from dotenv import load_dotenv  # noqa: E402
from shapely.geometry import LineString, MultiLineString, Point, Polygon  # noqa: E402

from geo_cascadia.buildloc import building_rays, locate_buildings, road_facing_edge  # noqa: E402
from geo_cascadia.config import Config  # noqa: E402
from geo_cascadia.geo import haversine  # noqa: E402
from geo_cascadia.textmatch import loose, same_business  # noqa: E402
from building_positions import area_model, area_slugs, load, street_lines  # noqa: E402

GATE_M = 3.5
PIN_RADIUS_M = 50.0
REF_FACADE, REF_PIN = "vs OSM facade", "vs Google pin"
REF_FACADE_OFFICIAL = "vs OSM wall"
REF_FRONT = "vs OSM front-wall centre"      # D33: organiser guidance, the reference point is the middle of the front wall
GUIDANCE = ("Organiser guidance: OpenStreetMap footprints are accepted as the reference; the position is the centre of the "
            "building's front.")
# official methods, how they are shown, and whether the point is derived from the map footprint itself
OFFICIAL = (("triangulated", "triangulated (cameras only)", False),
            ("wall_hit", "wall_hit (camera ray on the map wall; uses the map)", True),
            ("wall_centre", "wall_centre (front-wall centre from the map; uses the map)", True),
            ("footprint_centre", "footprint_centre (centroid; uses the map)", True))
SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
DETAILS_URL = "https://places.googleapis.com/v1/places/{}"


def stats(rows, key):
    xs = [(r[key], r["id"]) for r in rows if r.get(key) is not None]
    if not xs:
        return {"n": 0, "median_m": None, "p90_m": None, "within_3_5_m_pct": None, "worst_5": []}
    v = sorted(x for x, _ in xs)
    p90 = v[min(len(v) - 1, math.ceil(0.9 * len(v)) - 1)]
    return {"n": len(v), "median_m": round(statistics.median(v), 2), "p90_m": round(p90, 2),
            "within_3_5_m_pct": round(100 * sum(x <= GATE_M for x in v) / len(v), 1),
            "worst_5": [{"building_id": i, "m": round(x, 1)} for x, i in sorted(xs, reverse=True)[:5]]}


# ------------------------------------------------------------------ a) road-facing OSM wall: buildloc.road_facing_edge
def street_geometry(slug, F):
    out = street_lines(slug, F)
    allg = MultiLineString([g for m in out.values() for g in m.geoms]) if out else None
    return out, allg


# ------------------------------------------------------------------ b) Google pin (Places API New)
class Places:
    def __init__(self, key, cache_path):
        self.key, self.path, self.calls = key, cache_path, {"search": 0, "details": 0}
        self.cache = json.load(open(cache_path, encoding="utf-8")) if os.path.exists(cache_path) else {}

    def _post(self, body):
        self.calls["search"] += 1
        r = httpx.post(SEARCH_URL, json=body, timeout=20, headers={
            "X-Goog-Api-Key": self.key, "X-Goog-FieldMask": "places.id,places.displayName,places.location"})
        if r.status_code != 200:
            raise RuntimeError(f"Places searchText HTTP {r.status_code}")
        return r.json().get("places", [])

    def _location(self, place_id):
        self.calls["details"] += 1
        r = httpx.get(DETAILS_URL.format(place_id), timeout=20,
                      headers={"X-Goog-Api-Key": self.key, "X-Goog-FieldMask": "location"})
        if r.status_code != 200:
            return None
        loc = r.json().get("location") or {}
        return (loc.get("latitude"), loc.get("longitude")) if loc else None

    def pin(self, bid, name, lat, lon):
        """(place_id, (lat, lon)) of the matched place, or (None, None). Coordinates are never written to disk."""
        hit = self.cache.get(bid)
        if hit and hit.get("query") == name:
            if not hit.get("place_id"):
                return None, None                                   # searched before: no match
            loc = self._location(hit["place_id"])
            return (hit["place_id"], loc) if loc else (None, None)
        places = self._post({"textQuery": name, "maxResultCount": 5, "locationBias": {"circle": {
            "center": {"latitude": lat, "longitude": lon}, "radius": PIN_RADIUS_M}}})
        for p in places:
            loc = p.get("location") or {}
            if not loc:
                continue
            d = haversine(lat, lon, loc["latitude"], loc["longitude"])
            if d <= PIN_RADIUS_M and same_business(name, (p.get("displayName") or {}).get("text", "")):
                self.cache[bid] = {"query": name, "place_id": p["id"]}
                return p["id"], (loc["latitude"], loc["longitude"])
        self.cache[bid] = {"query": name, "place_id": None}
        return None, None

    def save(self):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, indent=1)                     # place_id + query only


def sign_text(b):
    n = ((b.get("attributes") or {}).get("name") or {}).get("value")
    t = n or (((b.get("evidence") or {}).get("sign_view") or {}).get("ocr_text"))
    return t if t and len(loose(t)) >= 3 else None


# ------------------------------------------------------------------ one area
def evaluate(slug, cfg, places_key):
    area, dets, blds = area_model(slug, cfg)
    F = area.frame
    rays = building_rays(dets, area)
    before = locate_buildings(dets, area, cfg, rays=rays, aim="centre")
    after = locate_buildings(dets, area, cfg, rays=rays, aim="corners")
    streets, all_streets = street_geometry(slug, F)
    exp = {b["id"]: b for b in load(slug, "export.json")["buildings"]}
    bp_path = os.path.join(ROOT, "data", "areas", slug, "building_positions.json")
    bpos = json.load(open(bp_path, encoding="utf-8"))["by_building"] if os.path.exists(bp_path) else {}
    pl = Places(places_key, os.path.join(ROOT, "data", "areas", slug, "gate1_places.json")) if places_key else None
    rows = []
    for b in blds:
        bid = b["building_id"]
        poly = Polygon([F.xy(p[0], p[1]) for p in b["footprint_latlon"]])
        sl = streets.get(b.get("street")) or all_streets
        edge = road_facing_edge(poly, sl) if sl is not None else None
        row = {"id": bid, "street": b.get("street")}
        # the OFFICIAL position (D27), exactly as written to export.json by the pipeline / tools/building_positions.py
        po = (exp.get(bid) or {}).get("predicted_position")
        row["official_method"] = po["method"] if po else "missing"
        row["official_uncertainty_m"] = po["uncertainty_m"] if po else None
        row["official_pairs"] = (bpos.get(bid) or {}).get("pair_estimates")
        mid = edge.interpolate(0.5, normalized=True) if edge is not None else None
        if po and edge is not None:
            row["official_facade_m"] = round(edge.distance(Point(F.xy(po["lat"], po["lon"]))), 2)
            row["official_front_m"] = round(mid.distance(Point(F.xy(po["lat"], po["lon"]))), 2)
        for tag, P in (("before", before), ("after", after)):
            p = P.get(bid)
            row[f"{tag}_method"] = p["method"] if p else "none"
            row[f"{tag}_uncertainty_m"] = p["uncertainty_m"] if p else None
            if p and edge is not None:
                row[f"{tag}_facade_m"] = round(edge.distance(Point(F.xy(p["lat"], p["lon"]))), 2)
            if p and p.get("fallback"):
                row[f"{tag}_fallback"] = p["fallback"]
        row["centroid_facade_m"] = round(edge.distance(poly.centroid), 2) if edge is not None else None
        row["centroid_front_m"] = round(mid.distance(poly.centroid), 2) if mid is not None else None
        name = sign_text(exp.get(bid, {}))
        if pl and name:
            pid, loc = pl.pin(bid, name, b["lat"], b["lon"])
            row["place_id"] = pid
            if loc:
                for tag, P in (("before", before), ("after", after)):
                    p = P.get(bid)
                    if p:
                        row[f"{tag}_pin_m"] = round(haversine(p["lat"], p["lon"], *loc), 2)
                row["centroid_pin_m"] = round(haversine(b["lat"], b["lon"], *loc), 2)
                if po:
                    row["official_pin_m"] = round(haversine(po["lat"], po["lon"], *loc), 2)
                if edge is not None:                             # how far apart the two references are
                    row["pin_to_facade_m"] = round(edge.distance(Point(F.xy(*loc))), 2)
        rows.append(row)
    if pl:
        pl.save()

    def table(ref_key):
        """per method, before and after, for one reference ('facade' or 'pin')."""
        out = {}
        for tag in ("before", "after"):
            for m in ("triangulated", "triangulated_centre", "single_ray"):
                R = [r for r in rows if r[f"{tag}_method"] == m]
                if not R:
                    continue
                name = m + (" (uses footprint)" if m == "single_ray" else "")
                out.setdefault(name, {})[tag] = stats(R, f"{tag}_{ref_key}_m")
        out["footprint centroid (baseline)"] = {"before": stats(rows, f"centroid_{ref_key}_m"),
                                                 "after": stats(rows, f"centroid_{ref_key}_m")}
        return out

    def official(ref_key):
        """per official method (D27, D33) for one reference ('facade', 'front' or 'pin'). Map-derived methods say so."""
        out = {}
        for m, label, _ in OFFICIAL:
            out[label] = stats([r for r in rows if r["official_method"] == m], f"official_{ref_key}_m")
        out["all buildings"] = stats(rows, f"official_{ref_key}_m")
        if ref_key == "front":
            cam = [r for r in rows if r["official_method"] in ("triangulated", "wall_hit")]
            out["camera-derived (triangulated + wall_hit)"] = stats(cam, "official_front_m")
            out["baseline: footprint centroid for every building (uses the map)"] = stats(rows, "centroid_front_m")
        return out

    tri = [r for r in rows if r["official_method"] == "triangulated"]
    est = [r for r in tri if r["official_uncertainty_m"] is not None]
    sc = stats([{"id": r["id"], "u": r["official_uncertainty_m"]} for r in est], "u")
    self_consistency = {"triangulated": len(tri), "estimated": len(est), "not_estimated": len(tri) - len(est),
                        "n": sc["n"], "median_m": sc["median_m"], "p90_m": sc["p90_m"],
                        "pair_estimates": sum(r["official_pairs"] or 0 for r in tri)}
    method_counts = {m: sum(r["official_method"] == m for r in rows) for m, _, _ in OFFICIAL}
    method_counts["triangulation_rejected"] = sum(bool(((exp.get(r["id"]) or {}).get("predicted_position") or {}).get("reason"))
                                                  for r in rows)

    cov = {tag: {m: sum(r[f"{tag}_method"] == m for r in rows) for m in ("triangulated", "triangulated_centre", "single_ray", "none")}
           for tag in ("before", "after")}
    fb = {k: sum(r.get("after_fallback") == k for r in rows) for k in ("corner_clipped_all_views", "corner_not_triangulable")}
    unc_null = sum(r["after_method"] in ("triangulated", "triangulated_centre") and r["after_uncertainty_m"] is None for r in rows)
    signs = sum(bool(sign_text(exp.get(b["building_id"], {}))) for b in blds)
    res = {"slug": slug, "buildings": len(blds), "coverage": cov, "after_fallbacks": fb,
           "after_uncertainty_not_estimated": unc_null,
           "method_counts": method_counts, "self_consistency": self_consistency,
           "official": {REF_FACADE: official("facade"), REF_FRONT: official("front")},
           REF_FACADE: table("facade"),
           REF_PIN: ({"status": "run",
                      "match_rate": {"buildings_with_sign_text": signs,
                                     "place_found_within_50m": sum(bool(r.get("place_id")) for r in rows),
                                     "used": sum(r.get("centroid_pin_m") is not None for r in rows)},
                      "api_calls": pl.calls, **table("pin"),
                      "reference_check_pin_vs_osm_facade": stats(rows, "pin_to_facade_m")}
                     if pl else {"status": "not run: no server-side Places key (GOOGLE_PLACES_SERVER_KEY) in backend/.env"}),
           "rows": rows}
    if pl:
        res["official"][REF_PIN] = {**official("pin"), "match_rate": res[REF_PIN]["match_rate"],
                                    "pin_vs_osm_wall": res[REF_PIN]["reference_check_pin_vs_osm_facade"]}
    with open(os.path.join(ROOT, "data", "areas", slug, "gate1_eval.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    return res


def write_model_card(results):
    """Append / replace "gate1_position" as the LAST key of model_card.json without reformatting the rest. When the
    Google pins were not re-run (--no-places), the stored pin block is kept and labelled with when it was computed."""
    path = os.path.join(ROOT, "data", "model_card.json")
    text = open(path, encoding="utf-8").read().rstrip()
    old_pin = (json.loads(text).get("gate1_position") or {}).get(REF_PIN) or {}
    cut = text.find(',\n "gate1_position":')
    body = text[:cut] if cut >= 0 else text[:text.rstrip().rfind("}")].rstrip()
    entry = {
        "_note": ("Automatic evaluation, NOT hand labels (tools/eval_gate1.py). Target: predicted building position "
                  "within 3.5 m (FarmwiseAI Gate 1). Official rule (D27, D28): triangulated wall-corner midpoint with >= 2 "
                  "cameras, else wall_hit (best ray on the road-facing wall; uses the map footprint), else wall_centre "
                  "(midpoint of the road-facing wall, D33), else footprint_centre (no road-facing wall). Development runs "
                  "(box centre vs wall corners, D26): data/areas/<slug>/gate1_eval.json."),
        "organiser_guidance": GUIDANCE,
        "front_centre_note": ("vs OSM front-wall centre: distance to the midpoint of the road-facing footprint wall. wall_centre "
                              "IS that point (0 m by construction, coordinate rounding only), so it and 'all buildings' "
                              "flatter the result; 'camera-derived' pools the methods whose position along the wall comes "
                              "from a camera (triangulated, wall_hit)."),
        "generated": datetime.date.today().isoformat(), "target_m": GATE_M,
        "status": "not verified",
        "status_note": ("No reference accurate to ~1 m is available, so a 3.5 m result can't be confirmed or ruled out. "
                        "Evaluation tool ready for surveyed points (tools/eval_gate1.py)."),
        "rule": {"triangulated": ">= 2 camera positions, pairs >= 30 deg apart: midpoint of the triangulated wall corners",
                 "wall_hit": "the best camera ray's hit on the road-facing footprint wall (uses the map footprint)",
                 "wall_centre": "the midpoint of the road-facing footprint wall: the centre of the building's front on "
                                "the map (no camera line of sight; uses the map footprint)",
                 "footprint_centre": "the footprint centroid, only when no road-facing wall can be determined",
                 "wall_hit_aim": "the camera ray points at the horizontal centre of the building's box ((x1 + x2) / 2)",
                 "uncertainty_m": "triangulated: median distance of single-pair estimates from the final point; "
                                  "2-camera results and others: null (not estimated)",
                 "plausibility": "a triangulated point more than 10 m from the road-facing wall is rejected; the "
                                 "building falls back to wall_hit, then wall_centre, then footprint_centre, with the "
                                 "reason stored"},
        "method_counts": {r["slug"]: {"buildings": r["buildings"], **r["method_counts"]} for r in results},
        "self_consistency": {r["slug"]: r["self_consistency"] for r in results},
        REF_FRONT: {r["slug"]: r["official"][REF_FRONT] for r in results},
        REF_FACADE_OFFICIAL: {r["slug"]: r["official"][REF_FACADE] for r in results},
        REF_PIN: {r["slug"]: (r["official"].get(REF_PIN)
                              or ({**old_pin[r["slug"]], "status": "computed before D33 (old fallback); not re-run"}
                                  if r["slug"] in old_pin and "status" not in old_pin[r["slug"]] else
                                  old_pin.get(r["slug"]) or {"status": r[REF_PIN]["status"]}))
                  for r in results},
    }
    block = json.dumps(entry, ensure_ascii=False, indent=1).replace("\n", "\n ")
    # D64: keys stored AFTER gate1_position (e.g. sign_links) are kept; before, everything after it was dropped
    whole = json.loads(text)
    keys = list(whole)
    later = keys[keys.index("gate1_position") + 1:] if "gate1_position" in keys else []
    rest = "".join(',\n "' + k + '": ' + json.dumps(whole[k], ensure_ascii=False, indent=1).replace("\n", "\n ") for k in later)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body + ',\n "gate1_position": ' + block + rest + "\n}\n")
    json.load(open(path, encoding="utf-8"))                       # still valid JSON


if __name__ == "__main__":
    load_dotenv(os.path.join(ROOT, "backend", ".env"))
    key = os.environ.get("GOOGLE_PLACES_SERVER_KEY", "").strip() or None
    if "--no-places" in sys.argv:                  # recompute from saved files only; stored pin results are kept
        sys.argv.remove("--no-places")
        key = None
    print("Google pin reference:", "server Places key found" if key else "no server Places key -> not run")
    cfg = Config()
    results = [evaluate(s, cfg, key) for s in (sys.argv[1:] or area_slugs())]
    write_model_card(results)
    for r in results:
        print(json.dumps({k: v for k, v in r.items() if k != "rows"}, indent=1, ensure_ascii=False))
