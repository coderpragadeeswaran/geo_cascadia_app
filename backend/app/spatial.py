"""Spatial question rule (D53): "… within N m of a possible dark stretch" (e.g. "Show not-in-register buildings within
50 m of a possible dark stretch").

The phrase is taken out of the question before the pipeline's QueryEngine reads the rest (use, register, floors,
street… unchanged); the engine's building rows are then kept only when the building lies within N metres of a possible
dark stretch. Distance: the building's outline (its point when it has none) to the stretch as the map draws it (the
along-road path, else the recorded straight segment, D13), in metres on the ground.
- Online: one PostGIS query, ST_DWithin on geography.
- Offline data mode (D4): the same rule with shapely in a local metre frame, so the answer is the same.
Only the pipeline's stored 60 m stretches exist in the database; this rule uses them.
"""
import re

from shapely.geometry import LineString, Point, Polygon

DEFAULT_M = 50
MAX_M = 500
_DARK = r"(?:possible\s+)?(?:dark\s+stretch(?:es)?|dark\s+streets?|streetlight\s+gaps?|gaps?\s+in\s+(?:the\s+)?streetlights?)"
_ART = r"(?:an?\s+|the\s+|any\s+)?"
NEAR_N = re.compile(rf"\b(?:with)?in\s+(\d{{1,4}})\s*(?:m|mtrs?|metres?|meters?)\s+(?:of|from)\s+{_ART}{_DARK}\b", re.I)
NEAR = re.compile(rf"\b(?:near|close\s+to|next\s+to|beside|along)\s+{_ART}{_DARK}\b", re.I)


def extract(text):
    """(text without the phrase, metres or None, the phrase as typed)"""
    m = NEAR_N.search(text)
    metres = None
    if m:
        metres = int(m.group(1))
    else:
        m = NEAR.search(text)
        if m:
            metres = DEFAULT_M
    if not m:
        return text, None, None
    rest = re.sub(r"\s{2,}", " ", (text[:m.start()] + " " + text[m.end():])).strip()
    return rest, max(1, min(MAX_M, metres)), m.group(0)


SQL = """
select b.id from buildings b join areas a on a.id = b.area_id
where a.slug = %s and exists (
  select 1 from streetlight_gaps g
  where g.area_id = b.area_id
    and ST_DWithin(coalesce(b.footprint, b.geom)::geography,
                   (case when g.display->>'mode' = 'along_road' and jsonb_array_length(g.display->'path') >= 2
                         then ST_SetSRID(ST_GeomFromGeoJSON(json_build_object('type', 'LineString',
                                                                              'coordinates', g.display->'path')::text), 4326)
                         else g.geom end)::geography,
                   %s))
"""


def near_dark(store, bundle, metres):
    """{"ids": set of building ids within `metres` of a possible dark stretch, "method": how it was computed}"""
    pool = getattr(store, "pool", None)
    if pool is not None:                                         # DbStore (JsonStore has no pool)
        with pool.connection() as c:
            ids = {r[0] for r in c.execute(SQL, (bundle["slug"], metres))}
        return {"ids": ids, "method": "PostGIS ST_DWithin (metres on the ground)"}
    return {"ids": near_dark_py(bundle, metres), "method": "computed in the app (offline data mode), same rule"}


def near_dark_py(bundle, metres):
    from geo_cascadia.geo import Frame
    gaps = bundle.get("streetlight_gaps") or []
    if not gaps:
        return set()
    disp = bundle.get("gap_display") or {}
    lat0 = sum(g["start"][0] for g in gaps) / len(gaps)
    lon0 = sum(g["start"][1] for g in gaps) / len(gaps)
    F = Frame(lat0, lon0)
    lines = []
    for g in gaps:
        d = disp.get(g["id"]) or {}
        path = d.get("path") if d.get("mode") == "along_road" else None
        pts = [F.xy(la, lo) for lo, la in path] if path and len(path) >= 2 else [F.xy(*g["start"]), F.xy(*g["end"])]
        lines.append(LineString(pts))
    out = set()
    for b in bundle.get("buildings") or []:
        ring = ((b.get("footprint") or {}).get("polygon_latlon")) or []
        shape_ = Polygon([F.xy(la, lo) for la, lo in ring]) if len(ring) >= 3 else Point(F.xy(b["lat"], b["lon"]))
        if any(shape_.distance(ln) <= metres for ln in lines):
            out.add(b["id"])
    return out
