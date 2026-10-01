"""Real reference layers: automatic street names (Geocoding, N8b) and Google Places cross-check (M2b-v2)."""
import os, re, json, math, time
from collections import Counter, defaultdict
import requests
from .textmatch import same_business

GEO_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby"


def _route_at(lat, lon, key):
    j = requests.get(GEO_URL, params={"latlng": f"{lat},{lon}", "result_type": "route", "key": key}, timeout=20).json()
    if j.get("status") not in ("OK", "ZERO_RESULTS"):
        raise RuntimeError(f"Geocoding {j.get('status')}: {j.get('error_message', '')} (enable Geocoding API)")
    for res in j.get("results", []):
        comps = res.get("address_components", [])
        rt = next((c["long_name"] for c in comps if "route" in c.get("types", [])), None)
        if not rt: continue
        area = next((c["long_name"] for c in comps
                     if set(c.get("types", [])) & {"neighborhood", "sublocality_level_2", "sublocality_level_1"}), "")
        if re.match(r"^\d+(st|nd|rd|th)\s+(street|cross)", rt, re.I) and area and area.lower() not in rt.lower():
            rt = f"{rt}, {area}"
        return rt
    return None


def street_names(plan, cfg):
    """Name every OSM street that has no name, by majority vote of camera positions (fully automatic)."""
    by_st = defaultdict(list)
    for e in plan:
        if str(e["street"]).startswith("(unnamed"): by_st[e["street"]].append((e["camera_lat"], e["camera_lon"]))
    names = {}
    for st, pts in by_st.items():
        pts = sorted(pts); n = min(cfg.geocode_points, len(pts))
        pick = [pts[round(i * (len(pts) - 1) / max(n - 1, 1))] for i in range(n)]
        votes = Counter()
        for la, lo in pick:
            nm = _route_at(la, lo, cfg.maps_key)
            if nm and nm.lower() != "unnamed road": votes[nm] += 1
        mc = votes.most_common(2)
        if not mc: continue
        top, k = mc[0]
        if k / len(pick) >= 0.5: names[st] = top
        elif len(mc) == 2 and (mc[0][1] + mc[1][1]) / len(pick) >= 0.7: names[st] = f"{mc[0][0]} / {mc[1][0]}"
        else: names[st] = f"{top} (approx.)"
    return names


DROP = {"route", "street_address", "premise", "subpremise", "locality", "sublocality", "political", "neighborhood",
        "plus_code", "postal_code", "administrative_area_level_1", "administrative_area_level_2",
        "administrative_area_level_3", "country", "intersection", "bus_stop", "transit_station", "parking", "atm"}
HOME_T = {"apartment_building", "apartment_complex", "housing_complex", "condominium_complex", "residential_building", "lodging"}
HOME_N = re.compile(r"\b(house|home|residency|residence|veedu|nivas|illam|villa|apartments?|flats?|block|enclave|nagar|"
                    r"colony|layout|rent)\b", re.I)
INST = {"hindu_temple", "church", "mosque", "place_of_worship", "school", "primary_school", "secondary_school",
        "university", "preschool", "park", "local_government_office", "police", "post_office", "fire_station",
        "library", "community_center", "hospital", "city_hall", "educational_institution", "association_or_organization"}


def _cat(p):
    t = set(p.get("types", [])) | {p.get("primaryType") or ""}
    if p.get("primaryType") in DROP or (t - {"point_of_interest", "establishment", ""} <= DROP): return None
    if t & HOME_T or HOME_N.search(p.get("displayName", {}).get("text", "")): return "home"
    return "institutional" if t & INST else "commercial"


def places_crosscheck(area, plan, buildings, final, cfg, out_dir, progress=lambda *a, **k: None):
    """Nearby Search along the plan; place_id + name kept only for this analysis (store place_id in production)."""
    cache_p = f"{out_dir}/places_cache.json"
    cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
    centres = []
    for e in plan:
        p = area.L(e["camera_lat"], e["camera_lon"])
        if all(math.dist(p, q) >= cfg.places_step_m for q in centres): centres.append(p)
    calls = 0
    def search(x, y, r):
        nonlocal calls
        k = f"{x:.1f},{y:.1f},{r:.0f}"
        if k in cache: return cache[k]
        if calls >= cfg.places_max_calls: return None
        la, lo = area.frame.ll(x, y)
        body = {"locationRestriction": {"circle": {"center": {"latitude": la, "longitude": lo}, "radius": r}},
                "maxResultCount": 20, "rankPreference": "DISTANCE"}
        rs = requests.post(PLACES_URL, json=body, timeout=30, headers={
            "X-Goog-Api-Key": cfg.maps_key, "Content-Type": "application/json",
            "X-Goog-FieldMask": "places.id,places.displayName,places.primaryType,places.types,places.location"})
        calls += 1
        if rs.status_code != 200:
            raise RuntimeError(f"Places HTTP {rs.status_code}: {rs.text[:200]} (enable Places API (New))")
        cache[k] = rs.json().get("places", []); time.sleep(0.05)
        return cache[k]
    places = {}
    for n, (x, y) in enumerate(centres, 1):
        todo = [(x, y, cfg.places_radius_m)]
        while todo:
            cx, cy, r = todo.pop(); got = search(cx, cy, r)
            if got is None: continue
            for p in got: places[p["id"]] = p
            if len(got) >= 20 and r > 12:
                h = r / 2; todo += [(cx + dx * h, cy + dy * h, h) for dx, dy in ((1, 1), (1, -1), (-1, 1), (-1, -1))]
        if n % 10 == 0: json.dump(cache, open(cache_p, "w")); progress("places", n, len(centres))
    json.dump(cache, open(cache_p, "w"))
    return crosscheck_with_places(area, buildings, final, places, cfg), {"places_calls": calls, "places_found": len(places),
                                                                        "kept": len(_kept(area, places))}


def places_from_cache(cache):
    """every place a run's Nearby searches returned ({id: place}), from its places_cache.json (no call)"""
    return {p["id"]: p for got in cache.values() for p in (got or [])}


def _kept(area, places):
    P = []
    for p in places.values():
        c = _cat(p)
        if c is None: continue
        x, y = area.L(p["location"]["latitude"], p["location"]["longitude"])
        P.append({"id": p["id"], "name": p.get("displayName", {}).get("text", ""), "type": p.get("primaryType"), "cat": c, "x": x, "y": y})
    return P


def crosscheck_with_places(area, buildings, final, places, cfg):
    """The comparison half of places_crosscheck (split out in P7a so it can be re-applied from a run's cached places):
    sign names vs Google businesses within places_radius_m, per building. Unchanged logic."""
    P = _kept(area, places)
    B = {b["building_id"]: b for b in buildings}
    by_b = defaultdict(list)
    blds = [(b["building_id"], *area.L(b["lat"], b["lon"]), b["area_m2"]) for b in buildings]
    for p in P:
        b = min(blds, key=lambda b: math.dist((p["x"], p["y"]), (b[1], b[2])))
        if math.dist((p["x"], p["y"]), (b[1], b[2])) <= max(15.0, math.sqrt(b[3]) / 2 + 10): by_b[b[0]].append(p)
    biz = [p for p in P if p["cat"] != "home"]
    out = {}
    for f in final:
        b = B[f["building_id"]]; bx, by = area.L(b["lat"], b["lon"])
        ref = [p for p in by_b.get(f["building_id"], []) if p["cat"] == "commercial"]
        near = [p for p in biz if math.dist((bx, by), (p["x"], p["y"])) <= cfg.places_radius_m]
        hit = next((p for p in near if f.get("name") and same_business(f["name"], p["name"])), None)
        flags = []
        if f.get("name") and not hit: flags.append("sign_not_in_google_within_40m")
        if f.get("use") and ref and f["use"] not in ("commercial", "mixed"): flags.append("google_business_but_observed_residential")
        out[f["building_id"]] = {"name_verified": bool(hit) if f.get("name") else None,
                                 "google_name": hit["name"] if hit else None, "google_place_id": hit["id"] if hit else None,
                                 "google_commercial": bool(ref), "google_businesses": [{"place_id": p["id"], "name": p["name"],
                                 "type": p["type"]} for p in ref], "ref_flags": flags}
    return out
