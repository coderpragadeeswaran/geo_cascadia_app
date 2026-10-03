"""Lighting priority for possible dark stretches (D54): which stretch an official should look at first.

A fixed points rule, no model and no tuning. Every stretch gets three scores of 0-3 points, added up (0-9):
- Length: the recorded length the app shows (D13): under 120 m = 1, 120-239 m = 2, 240 m or more = 3
  (one missing 60 m interval, two or more, four or more).
- Road type: the OpenStreetMap class of the road under the stretch, from the app's local copy of OpenStreetMap (D53):
  main road (trunk, primary, secondary and their links) = 3; connecting road (tertiary, its link, unclassified) = 2;
  residential street, living street, service lane or any other class = 1; no road found = 0 ("road type not known").
  The class is the one with the most road length within 15 m of the stretch.
- Activity: places of activity within 30 m of the stretch: analysed buildings whose use is commercial or mixed
  (shop + home) OR that have a shop name read clearly from a sign linked to them (name quality "good"; D56: use is not
  known for many buildings, 139 of 381 in Ward 29, so counting by use alone undercounted), plus OpenStreetMap shop /
  amenity / office points that are not inside one of those buildings, plus
  businesses read from signs with no analysed building that are not inside one of those buildings and not within 10 m
  of a counted OpenStreetMap point (taken as the same place). 0 places = 0, 1-4 = 1, 5-9 = 2, 10 or more = 3.
High = 7-9 points, Medium = 5-6, Low = 0-4. Ties: more points, then longer, then id.

Distances are on the ground (PostGIS ST_DWithin on geography) to the stretch as the map draws it (the along-road path,
else the recorded straight segment, D13), the same line as the D53 "within N m" question.

The weights were written down before the first result was computed and are not tuned to give a nicer order (owner
rule). The rule ranks POSSIBLE dark stretches: the lamp detector finds 43% of lamp heads (model card), so a stretch can
have lamps the detector missed.

Needs the database (the OpenStreetMap copy lives there). Offline data mode (D4): not available, said plainly.
"""
import json

LENGTH_BANDS = ((240, 3), (120, 2), (0, 1))                 # recorded metres >= bound -> points
MAIN = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"}
CONNECTING = {"tertiary", "tertiary_link", "unclassified"}
ACTIVITY_BANDS = ((10, 3), (5, 2), (1, 1), (0, 0))           # places >= bound -> points
HIGH_MIN, MEDIUM_MIN = 7, 5
ROAD_M = 15                                                  # road length within this distance decides the road type
ACTIVITY_M = 30                                              # places of activity within this distance count
SAME_PLACE_M = 10                                            # a sign-read business this close to a counted OSM point = same place
SHOP_USES = ("commercial", "mixed")
SIGN_QUALITY = "good"                                        # D56: a shop name read clearly from the building's own sign
RULE = {
    "length": "recorded length: under 120 m = 1 point, 120-239 m = 2, 240 m or more = 3",
    "road": "OpenStreetMap road class under the stretch: main road (trunk / primary / secondary) = 3, connecting road "
            "(tertiary / unclassified) = 2, residential street / service lane / other = 1, not known = 0",
    "activity": f"shops and businesses within {ACTIVITY_M} m: none = 0, 1-4 = 1, 5-9 = 2, 10 or more = 3 "
                "(buildings that are commercial or mixed use or carry a shop name read clearly from their sign, "
                "OpenStreetMap shop / amenity / office points, businesses read from signs with no analysed building)",
    "levels": f"High = {HIGH_MIN}-9 points, Medium = {MEDIUM_MIN}-{HIGH_MIN - 1}, Low = 0-{MEDIUM_MIN - 1}",
    "why": "A fixed rule written down before any result was seen (D54); it ranks possible dark stretches, it does not "
           "confirm them.",
}
OFFLINE_NOTE = "Priority needs the app's database (the OpenStreetMap copy); it is not available in offline data mode."


def length_points(m):
    return next(p for bound, p in LENGTH_BANDS if m >= bound)


def road_kind(highway):
    if highway is None:
        return "unknown"
    return "main" if highway in MAIN else "connecting" if highway in CONNECTING else "residential"


ROAD_POINTS = {"main": 3, "connecting": 2, "residential": 1, "unknown": 0}
ROAD_WORDS = {"main": "a main road", "connecting": "a connecting road", "residential": "a residential street",
              "unknown": "a road of unknown type"}


def activity_points(n):
    return next(p for bound, p in ACTIVITY_BANDS if n >= bound)


def level(score):
    return "high" if score >= HIGH_MIN else "medium" if score >= MEDIUM_MIN else "low"


def reason(length_m, kind, places):
    shops = ("no shops or businesses along it" if places == 0 else
             f"1 shop or business along it" if places == 1 else f"{places} shops and businesses along it")
    return f"{round(length_m)} m on {ROAD_WORDS[kind]}, {shops}"


def score_row(sid, length_m, highway, n_buildings, n_osm, n_signs, road_m=None):
    kind = road_kind(highway)
    places = n_buildings + n_osm + n_signs
    pts = {"length": length_points(length_m), "road": ROAD_POINTS[kind], "activity": activity_points(places)}
    s = sum(pts.values())
    return {"id": sid, "level": level(s), "score": s, "points": pts, "reason": reason(length_m, kind, places),
            "length_m": length_m, "road_class": highway, "road_kind": kind, "road_m": road_m,
            "activity": {"total": places, "buildings": n_buildings, "osm_points": n_osm, "sign_businesses": n_signs}}


def order(rows):
    """priority order: points, then longer, then id"""
    return sorted(rows, key=lambda r: (-r["score"], -r["length_m"], r["id"]))


SQL = f"""
with s as (
  select x->>'id' id, ST_SetSRID(ST_GeomFromGeoJSON(x->>'geom'), 4326) geom from jsonb_array_elements(%(s)s::jsonb) x
), a as (select id from areas where slug = %(slug)s
), shops as (
  select b.id, coalesce(b.footprint, b.geom) g from buildings b where b.area_id = (select id from a)
    and (b.use = any(%(uses)s) or b.name_quality = %(sign_q)s)
), road as (
  select s.id, r.highway,
         sum(ST_Length(ST_Intersection(r.geom, ST_Buffer(s.geom::geography, {ROAD_M})::geometry)::geography)) m
  from s join osm_roads r on r.geom && ST_Expand(s.geom, 0.0005) and ST_DWithin(r.geom::geography, s.geom::geography, {ROAD_M})
  group by s.id, r.highway
), bld as (
  select s.id, array_agg(sh.id order by sh.id) ids from s join shops sh
    on sh.g && ST_Expand(s.geom, 0.001) and ST_DWithin(sh.g::geography, s.geom::geography, {ACTIVITY_M})
  group by s.id
), poi as (
  select s.id, p.geom from s join osm_pois p
    on p.geom && ST_Expand(s.geom, 0.001) and ST_DWithin(p.geom::geography, s.geom::geography, {ACTIVITY_M})
  where not exists (select 1 from shops sh where ST_Intersects(sh.g, p.geom))
), sign as (
  select s.id, array_agg(u.id order by u.id) ids from s join unmapped_businesses u
    on u.area_id = (select id from a) and ST_DWithin(u.geom::geography, s.geom::geography, {ACTIVITY_M})
  where not exists (select 1 from shops sh where ST_Intersects(sh.g, u.geom))
    and not exists (select 1 from poi where poi.id = s.id and ST_DWithin(poi.geom::geography, u.geom::geography, {SAME_PLACE_M}))
  group by s.id
)
select s.id,
       (select json_agg(json_build_array(highway, round(m::numeric, 1)) order by m desc, highway) from road where road.id = s.id),
       (select ids from bld where bld.id = s.id),
       (select count(*) from poi where poi.id = s.id),
       (select ids from sign where sign.id = s.id)
from s
"""

RANK = {"main": 3, "connecting": 2, "residential": 1}


def _road_choice(roads):
    """the class with the most road length near the stretch; a tie goes to the higher class"""
    if not roads:
        return None, None
    hw, m = max(roads, key=lambda r: (r[1], RANK.get(road_kind(r[0]), 0)))
    return hw, float(m)


def stretches(bundle, rows=None, display=None):
    """[(id, recorded length, GeoJSON line as the map draws it)] for the stored 60 m stretches, or for computed rows"""
    rows = bundle["streetlight_gaps"] if rows is None else rows
    disp = (bundle.get("gap_display") or {}) if display is None else display
    out = []
    for g in rows:
        d = disp.get(g["id"]) or {}
        path = d.get("path") if d.get("mode") == "along_road" and len(d.get("path") or []) >= 2 else None
        line = path or [[g["start"][1], g["start"][0]], [g["end"][1], g["end"][0]]]
        out.append((g["id"], g["length_m"], {"type": "LineString", "coordinates": line}))
    return out


def compute(pool, bundle, rows=None, display=None):
    """{id: priority row} computed in one PostGIS query."""
    S = stretches(bundle, rows, display)
    if not S:
        return {}
    payload = json.dumps([{"id": i, "geom": json.dumps(g)} for i, _, g in S])
    with pool.connection() as c:
        res = c.execute(SQL, {"s": payload, "slug": bundle["slug"], "uses": list(SHOP_USES), "sign_q": SIGN_QUALITY}).fetchall()
    length = {i: m for i, m, _ in S}
    out = {}
    for sid, roads, bids, n_osm, sids in res:
        hw, rm = _road_choice(roads or [])
        r = score_row(sid, length[sid], hw, len(bids or []), int(n_osm or 0), len(sids or []), rm)
        r["activity"]["building_ids"] = list(bids or [])
        r["activity"]["sign_business_ids"] = list(sids or [])
        r["roads_near"] = [{"class": h, "m": float(m)} for h, m in (roads or [])]
        out[sid] = r
    return out


def for_area(store, bundle, rows=None, display=None, key=60):
    """{"available", "rows": {id: row}, "rule", "note"}; cached on the bundle (one query per area version)."""
    pool = getattr(store, "pool", None)
    if pool is None:
        return {"available": False, "rows": {}, "rule": RULE, "note": OFFLINE_NOTE}
    cache = bundle.setdefault("_lighting", {})
    if key not in cache:
        cache[key] = {"available": True, "rows": compute(pool, bundle, rows, display), "rule": RULE, "note": None}
    return cache[key]


def attach(row, pr):
    """the fields a gap row / map feature carries (None when priority is not available)"""
    p = (pr or {}).get(row.get("id")) if pr else None
    return {"priority": p["level"] if p else None, "priority_score": p["score"] if p else None,
            "priority_reason": p["reason"] if p else None, "priority_points": p["points"] if p else None,
            "priority_road": p["road_class"] if p else None}


PRIORITY_RE = r"\b(high|medium|low)(?:est)?[\s-]+priority\b"


def extract(text):
    """(text without "high / medium / low priority", the level or None, the phrase as typed)"""
    import re
    m = re.search(PRIORITY_RE, text, re.I)
    if not m:
        return text, None, None
    rest = re.sub(r"\s{2,}", " ", text[:m.start()] + " " + text[m.end():]).strip()
    return rest, m.group(1).lower(), m.group(0)


LEVEL_WORDS = {"high": "High", "medium": "Medium", "low": "Low"}
