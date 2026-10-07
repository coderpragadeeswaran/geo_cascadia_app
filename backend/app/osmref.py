"""OpenStreetMap as a real reference next to the synthetic register (extras 3 + 4), and floor-count confidence.

OpenStreetMap is crowd-sourced: volunteers add what they know, so a missing shop or a missing building:levels tag says
nothing about the real street. It is shown as a cross-check, never as the truth, and it never changes our results.

- Shops (extras 3): the businesses our camera found — analysed buildings with a shop name read clearly from their sign
  or a commercial / shop + home use, plus businesses read from signs with no analysed building — against the
  OpenStreetMap shop / office / business-amenity points within SCOPE_M of an analysed street (the same "along it" distance
  as the lighting priority, D54). The points are the app's local copy (D53); their names and tags come from one
  Overpass look-up by id per area (the copy keeps geometry only), saved in data/areas/<slug>/osm_tags.json.
  Paired ("near each other, location only"; the API key stays `matched`) = within MATCH_M (to the building's outline, 0 inside; to a sign business's point), one-to-one, a name that
  `textmatch.same_business` accepts first, then the nearest.
- Levels (extras 4): OpenStreetMap's building:levels for the analysed buildings (the same osm_tags.json look-up, by the
  buildings' own OSM ids). Shown next to our count as a cross-check; our count is never changed.
- Floor confidence (extras 4): a fixed rule in plain words (FLOOR_RULE), with the model card's hand check.
"""
import datetime as _dt
import json
import math
import os
import re
import time

from shapely.geometry import Point, Polygon

SCOPE_M = 30                 # OSM points this close to an analysed street line are in scope ("along it", as D54)
MATCH_M = 25                 # a camera business and an OSM point this close (outline or point) can be the same place
TAGS_FILE = "osm_tags.json"
# amenity values that are businesses with a sign (the rest — worship, schools, toilets, bus stops, parking, ATMs … — are
# public or street furniture and are left out of the comparison, counted as "other OpenStreetMap points")
BUSINESS_AMENITY = {"restaurant", "cafe", "fast_food", "food_court", "ice_cream", "bar", "pub", "biergarten", "bank",
                    "bureau_de_change", "money_transfer", "pharmacy", "clinic", "doctors", "dentist", "hospital",
                    "veterinary", "fuel", "car_wash", "car_rental", "marketplace", "cinema", "nightclub", "internet_cafe",
                    "driving_school", "training", "language_school", "music_school", "dancing_school", "studio",
                    "coworking_space", "events_venue", "photo_booth", "vehicle_inspection", "courier"}


def _frame(lat, lon):
    k = 111320 * math.cos(math.radians(lat))
    return lambda la, lo: ((lo - lon) * k, (la - lat) * 110540)


# --------------------------------------------------------------------------------------------- fetching the tags
def _overpass_ids(osm_ids):
    """one Overpass query by id: node(id:…); way(id:…); relation(id:…); out tags;"""
    parts = []
    for kind in ("node", "way", "relation"):
        ids = sorted({i for k, i in osm_ids if k == kind})
        if ids:
            parts.append(f"{kind}(id:{','.join(map(str, ids))});")
    return "[out:json][timeout:90];(" + "".join(parts) + ");out tags;" if parts else None


def _osm_key(bid):
    """an export building id → (kind, osm id): w123 → way 123, r123_4 → relation 123; Microsoft (ms_…) → None"""
    m = re.match(r"^([wr])(\d+)", bid or "")
    return ("way" if m.group(1) == "w" else "relation", int(m.group(2))) if m else None


def scope_pois(pool, bundle):
    """the local copy's shop / amenity / office points within SCOPE_M of the area's analysed street lines"""
    lines = [s["geometry"] for s in bundle["streets"] if s.get("geometry")]
    if pool is None or not lines:
        return None
    gc = json.dumps({"type": "GeometryCollection", "geometries": lines})
    with pool.connection() as c:
        rows = c.execute(f"""select p.osm_type, p.osm_id, ST_Y(p.geom), ST_X(p.geom) from osm_pois p
                             where p.geom && ST_Expand(ST_GeomFromGeoJSON(%s), 0.001)
                               and ST_DWithin(p.geom::geography, ST_GeomFromGeoJSON(%s)::geography, {SCOPE_M})
                             order by 1, 2""", (gc, gc)).fetchall()
        snap = c.execute("select max(osm_snapshot) from map_cities").fetchone()[0]
    return [{"osm_type": t, "osm_id": i, "lat": la, "lon": lo} for t, i, la, lo in rows], snap


def fetch(bundle, areas_dir, cache_dir, pool, overpass=None, deadline_s=120):
    """build data/areas/<slug>/osm_tags.json: the in-scope OSM points (local copy) with their tags, and the
    building:levels (and other building tags) of the area's OSM buildings, from one Overpass id look-up. Returns it."""
    from . import streetpick
    overpass = overpass or streetpick.overpass
    got = scope_pois(pool, bundle)
    if got is None:
        raise RuntimeError("the local OpenStreetMap copy is not available (database offline or no analysed streets)")
    pois, snap = got
    keys = [("node" if p["osm_type"] == "n" else "way" if p["osm_type"] == "w" else "relation", p["osm_id"]) for p in pois]
    bkeys = {b["id"]: _osm_key(b["id"]) for b in bundle["buildings"]}
    q = _overpass_ids(keys + [k for k in bkeys.values() if k])
    els = []
    if q:
        els, _ = overpass(q, cache_dir, time.monotonic() + deadline_s)
    tags = {(e["type"], e["id"]): e.get("tags") or {} for e in els}
    out = {
        "fetched": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "OpenStreetMap: point positions from the app's copy (snapshot "
                  + (snap.date().isoformat() if snap else "unknown") + "); names and tags from the Overpass API on the fetch date",
        "osm_snapshot": snap.date().isoformat() if snap else None,
        "scope_m": SCOPE_M,
        "pois": [{**p, "tags": tags.get((k[0], k[1]), {}), "found": (k[0], k[1]) in tags} for p, k in zip(pois, keys)],
        "buildings": {bid: {"levels": (tags.get(k) or {}).get("building:levels"),
                            "building": (tags.get(k) or {}).get("building"), "found": k in tags}
                      for bid, k in bkeys.items() if k},
    }
    with open(os.path.join(areas_dir, bundle["slug"], TAGS_FILE), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    return out


def load(slug, areas_dir):
    try:
        with open(os.path.join(areas_dir, slug, TAGS_FILE), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# --------------------------------------------------------------------------------------------- shops (extras 3)
def poi_kind(tags):
    """'shop' / 'office' / 'amenity' business kind in plain words, or None when not a business"""
    if tags.get("shop") and tags["shop"] not in ("vacant", "no"):
        return "shop: " + tags["shop"].replace("_", " ")
    if tags.get("office") and tags["office"] not in ("vacant", "no"):
        return "office: " + tags["office"].replace("_", " ")
    if tags.get("amenity") in BUSINESS_AMENITY:
        return tags["amenity"].replace("_", " ")
    return None


def camera_businesses(bundle, street=None):
    """what our camera counts as a business: buildings with a shop name read clearly or a commercial / shop + home use,
    and businesses read from signs with no analysed building"""
    out = []
    for b in bundle["buildings"]:
        if street and b.get("street") != street:
            continue
        at = b.get("attributes") or {}
        nm, use = at.get("name") or {}, (at.get("use") or {}).get("value")
        good = nm.get("quality") == "good" and nm.get("value")
        if not (good or use in ("commercial", "mixed")):
            continue
        sv = (b.get("evidence") or {}).get("sign_view") or {}
        out.append({"kind": "building", "id": b["id"], "street": b.get("street"), "lat": b["lat"], "lon": b["lon"],
                    "name": nm.get("value") if good else None, "sign_text": nm.get("value") or sv.get("ocr_text"),
                    "why": "shop name read clearly" if good else ("commercial use" if use == "commercial" else "shop + home use"),
                    "ring": (b.get("footprint") or {}).get("polygon_latlon")})
    for u in bundle["unmapped_businesses"]:
        if street and u.get("street") != street:
            continue
        out.append({"kind": "sign", "id": u["id"], "street": u.get("street"), "lat": u["lat"], "lon": u["lon"],
                    "name": u.get("name"), "sign_text": u.get("ocr_text") or u.get("name"),
                    "why": "business read from a sign (no analysed building)", "ring": None})
    return out


def _same_name(a, b):
    if not a or not b:
        return False
    try:
        from geo_cascadia.textmatch import same_business
        return bool(same_business(a, b))
    except Exception:                                          # noqa: BLE001 - name only breaks ties
        return False


def shops(bundle, tags, street=None):
    """matched / seen by the camera but not in OSM / in OSM but not seen by the camera (see module doc)"""
    if not tags:
        return {"available": False, "note": "OpenStreetMap shop names are not loaded for this area yet "
                                            "(tools/fetch_osm_tags.py)."}
    cams = camera_businesses(bundle, street)
    near_street = None
    if street:
        lines = [s for s in bundle["streets"] if s["name"] == street and s.get("geometry")]
        near_street = lines
    pois, other = [], 0
    for p in tags["pois"]:
        kind = poi_kind(p.get("tags") or {})
        if kind is None:
            other += 1
            continue
        pois.append({**p, "kind": kind, "name": (p.get("tags") or {}).get("name") or (p.get("tags") or {}).get("name:en")})
    if near_street is not None:
        pois = [p for p in pois if _within(p, near_street, SCOPE_M)]
    lat0 = bundle["bbox"][1] if bundle.get("bbox") else (cams[0]["lat"] if cams else 0)
    lon0 = bundle["bbox"][0] if bundle.get("bbox") else (cams[0]["lon"] if cams else 0)
    xy = _frame(lat0, lon0)
    geo = []
    for c in cams:
        ring = c.get("ring") or []
        g = Polygon([xy(la, lo) for la, lo in ring]).buffer(0) if len(ring) >= 3 else Point(xy(c["lat"], c["lon"]))
        geo.append(g)
    pairs = []
    for i, c in enumerate(cams):
        for j, p in enumerate(pois):
            d = geo[i].distance(Point(xy(p["lat"], p["lon"])))
            if d <= MATCH_M:
                same = _same_name(c.get("name") or c.get("sign_text"), p.get("name"))
                pairs.append((not same, d, i, j, same))
    pairs.sort()
    used_c, used_p, matched = set(), set(), []
    for _, d, i, j, same in pairs:
        if i in used_c or j in used_p:
            continue
        used_c.add(i)
        used_p.add(j)
        matched.append({"camera": _cam_out(cams[i]), "osm": _poi_out(pois[j]), "distance_m": round(d, 1), "same_name": same})
    cam_only = [_cam_out(c) for i, c in enumerate(cams) if i not in used_c]
    osm_only = [_poi_out(p) for j, p in enumerate(pois) if j not in used_p]
    return {
        "available": True, "scope_m": SCOPE_M, "match_m": MATCH_M, "fetched": tags.get("fetched"),
        "osm_snapshot": tags.get("osm_snapshot"),
        "counts": {"camera": len(cams), "osm": len(pois), "matched": len(matched), "matched_same_name": sum(m["same_name"] for m in matched),
                   "camera_only": len(cam_only), "osm_only": len(osm_only), "osm_other_points": other},
        "matched": matched, "camera_only": cam_only, "osm_only": osm_only,
        "note": ("OpenStreetMap is crowd-sourced (volunteers), not an official register: a shop missing from it says nothing "
                 "about the street, only about the map. Shown next to the synthetic register as a real, outside reference."),
        "rule": (f"Our businesses: buildings with a shop name read clearly or a commercial / shop + home use, plus businesses "
                 f"read from signs with no analysed building. OpenStreetMap: shop, office and business amenity points within "
                 f"{SCOPE_M} m of an analysed street (schools, places of worship, toilets, bus stops, parking and ATMs left out). "
                 f"Near each other = within {MATCH_M} m (to the building outline), one to one; a matching name decides between "
                 f"candidates, then the nearest. This pairs by location only: it does not mean the same business."),
    }


def _within(p, streets, m):
    from shapely.geometry import shape
    xy = _frame(p["lat"], p["lon"])
    for s in streets:
        g = shape(s["geometry"])
        lines = list(g.geoms) if hasattr(g, "geoms") else [g]
        for ln in lines:
            from shapely.geometry import LineString
            if LineString([xy(la, lo) for lo, la in ln.coords]).distance(Point(0, 0)) <= m:
                return True
    return False


def _cam_out(c):
    return {k: c.get(k) for k in ("kind", "id", "street", "lat", "lon", "name", "sign_text", "why")}


def _poi_out(p):
    return {"osm_id": f"{p['osm_type']}{p['osm_id']}", "lat": p["lat"], "lon": p["lon"], "name": p.get("name"),
            "kind": p.get("kind"), "url": f"https://www.openstreetmap.org/{ {'n': 'node', 'w': 'way', 'r': 'relation'}[p['osm_type']] }/{p['osm_id']}"}


def shop_status_by_id(sh):
    """{building id or business id: 'in OpenStreetMap' / 'not in OpenStreetMap'} for the report and Excel column"""
    if not sh or not sh.get("available"):
        return {}
    out = {m["camera"]["id"]: (f"near an OpenStreetMap point ({m['osm']['name'] or m['osm']['kind']}, {m['distance_m']:g} m; location only, "
                               + ("same name)" if m["same_name"] else "names don't match)")) for m in sh["matched"]}
    out.update({c["id"]: "not in OpenStreetMap" for c in sh["camera_only"]})
    return out


# --------------------------------------------------------------------------------------------- levels (extras 4)
def parse_levels(v):
    """building:levels as a number when it is one ('3', '2.5'); None for missing / ranges / text"""
    try:
        f = float(str(v).strip())
    except (TypeError, ValueError):
        return None
    return f if f >= 0 else None


def levels(bundle, tags):
    """how many analysed buildings carry building:levels on OSM, and how often our count agrees (exact / within 1)"""
    if not tags:
        return {"available": False, "note": "OpenStreetMap building tags are not loaded for this area yet."}
    rows, tagged = [], 0
    for b in bundle["buildings"]:
        t = (tags.get("buildings") or {}).get(b["id"]) or {}
        raw = t.get("levels")
        if raw is None:
            continue
        tagged += 1
        fl = (b.get("attributes") or {}).get("floors") or {}
        osm, ours = parse_levels(raw), fl.get("value")
        rows.append({"id": b["id"], "street": b.get("street"), "osm_levels": raw, "ours": ours, "status": fl.get("status"),
                     "diff": None if osm is None or ours is None else ours - osm})
    comp = [r for r in rows if r["diff"] is not None]
    meas = [r for r in comp if r["status"] == "measured"]
    pct = lambda a, n: round(100 * a / n) if n else None
    return {
        "available": True, "fetched": tags.get("fetched"), "buildings": len(bundle["buildings"]),
        "osm_found": sum(1 for b in bundle["buildings"] if ((tags.get("buildings") or {}).get(b["id"]) or {}).get("found")),
        "tagged": tagged, "compared": len(comp),
        "exact": sum(1 for r in comp if r["diff"] == 0), "within_1": sum(1 for r in comp if abs(r["diff"]) <= 1),
        "exact_pct": pct(sum(1 for r in comp if r["diff"] == 0), len(comp)),
        "within_1_pct": pct(sum(1 for r in comp if abs(r["diff"]) <= 1), len(comp)),
        "measured_only": {"n": len(meas), "exact": sum(1 for r in meas if r["diff"] == 0),
                          "within_1": sum(1 for r in meas if abs(r["diff"]) <= 1)},
        "ours_higher": sum(1 for r in comp if r["diff"] > 0), "ours_lower": sum(1 for r in comp if r["diff"] < 0),
        "rows": rows,
        "note": ("OpenStreetMap's building:levels is added by volunteers for some buildings only and is not checked; it is a "
                 "cross-check next to our count, never used to change it."),
    }


def building_levels(tags, bid):
    t = ((tags or {}).get("buildings") or {}).get(bid) or {}
    return {"loaded": bool(tags), "osm_levels": t.get("levels"), "found": t.get("found", False)}


# --------------------------------------------------------------------------------------------- floor confidence
FLOOR_RULE = ("A fixed rule from what the analysis recorded, not tuned on any result: High = floors counted from the photo, "
              "1–2 floors; Medium = counted, 3 or more floors (the model card notes a mild under-count on 3+ storeys); "
              "Low = an estimate, the roof was not visible; none = not counted (no usable photo of the building).")


def floor_confidence(fl, model_card=None):
    """{level: 'high'|'medium'|'low'|None, word, reason, check} for a building's floors attribute (plain words)"""
    fl = fl or {}
    mc = (model_card or {}).get("floors") or {}
    w = mc.get("ward29") or {}
    check = (f"checked by hand on {w['n']} Ward 29 buildings: {round(w['exact'] * 100)}% exactly right, "
             f"{round(w['within_1'] * 100)}% within one floor") if w.get("n") else None
    v, st = fl.get("value"), fl.get("status")
    if v is None or st == "not_measured":
        return {"level": None, "word": "Not counted", "reason": "no usable photo of the building to count floors", "check": check}
    if st == "low_confidence":
        return {"level": "low", "word": "Low", "reason": "an estimate: the roof was not visible in the photo", "check": check}
    if v >= 3:
        return {"level": "medium", "word": "Medium",
                "reason": "counted from the photo; taller buildings tend to be under-counted a little", "check": check}
    return {"level": "high", "word": "High", "reason": "counted from the photo, roof line visible", "check": check}


# --------------------------------------------------------------------------------------------- the question (extras 3)
OSM_WORD = re.compile(r"\b(open\s*street\s*map|osm)\b", re.I)
OSM_MODES = {"camera_only": "seen by our camera, not in OpenStreetMap",
             "osm_only": "in OpenStreetMap, not seen by our camera",
             "matched": "near an OpenStreetMap point (location only)"}


def extract_question(text):
    """(mode, phrase) when a question is about our businesses vs OpenStreetMap, else (None, None). Rule-based like the
    rest of the question engine (docs/QUERY.md): "businesses not in OpenStreetMap" -> camera_only; "OpenStreetMap shops
    not seen by the camera" / "... the camera missed" -> osm_only; "businesses in OpenStreetMap" -> matched."""
    t = " ".join((text or "").lower().split())
    m = OSM_WORD.search(t)
    if not m:
        return None, None
    if re.search(r"(open\s*street\s*map|\bosm)\b.*\b(not seen|unseen|missed|not found|but not)\b", t) \
            or re.search(r"\bcamera (did ?n.?t|never|missed)\b", t) or re.search(r"\bonly in (open\s*street\s*map|osm)\b", t):
        return "osm_only", m.group(0)
    if re.search(r"\b(not|missing|absent|without|no)\b|n't\b", t):
        return "camera_only", m.group(0)
    return "matched", m.group(0)


def answer_rows(sh, mode):
    """the question's rows: our businesses (kind building / unmapped) or OpenStreetMap points (kind osm)"""
    if mode == "osm_only":
        return [{"kind": "osm", "id": o["osm_id"], "street": None, "lat": o["lat"], "lon": o["lon"], "name": o.get("name"),
                 "osm_kind": o.get("kind"), "url": o.get("url")} for o in sh["osm_only"]]
    if mode == "matched":
        return [{"kind": "building" if m["camera"]["kind"] == "building" else "unmapped", "id": m["camera"]["id"],
                 "street": m["camera"]["street"], "lat": m["camera"]["lat"], "lon": m["camera"]["lon"],
                 "name": m["camera"].get("name") or m["camera"].get("sign_text"), "why": m["camera"]["why"],
                 "osm_name": m["osm"].get("name"), "osm_kind": m["osm"].get("kind"), "distance_m": m["distance_m"],
                 "same_name": m["same_name"]} for m in sh["matched"]]
    return [{"kind": "building" if c["kind"] == "building" else "unmapped", "id": c["id"], "street": c["street"],
             "lat": c["lat"], "lon": c["lon"], "name": c.get("name") or c.get("sign_text"), "why": c["why"]}
            for c in sh["camera_only"]]
