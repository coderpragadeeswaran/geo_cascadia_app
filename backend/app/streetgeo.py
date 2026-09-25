"""Street display names and streetlight-gap display geometry (docs/DECISIONS.md D13). Pure functions, shared by the
loader (DB mode) and the JSON store (offline mode), so both return identical values.

Street names: streets.json keeps the raw OSM label ("(unnamed residential #907980850)"), while every building, asset and
gap record carries the display name the pipeline assigned via street_names.json ("Korathottam Road",
run_area.py `nm()`). We apply the same mapping to the street lines so they join the records.

Gap display: the export stores a gap as its first/last unlit camera positions only, and the pipeline measures its length
along one straight line fitted to all camera stops of the street piece (match.py). For the map we
  - merge the street's OSM pieces (as the pipeline's plan does) and draw the gap along the road when both ends lie within
    25 m of the merged line and no *lit* camera stop lies on the road between them        → mode "along_road"
  - keep the recorded straight segment and flag it when lit camera stops lie on the road between its ends (bent street:
    the straight-line ordering mixed both sides)                                             → mode "check"
  - keep the recorded straight segment when no street line is near both ends                 → mode "straight"
The recorded length_m is never replaced; the along-road length is reported beside it.
"""
import math

from shapely.geometry import LineString, MultiLineString, Point
from shapely.ops import linemerge

SNAP_M = 25.0          # both gap ends must lie this close to the street line to follow it
CAMERA_ON_LINE_M = 15.0  # a camera belongs to a street piece within this distance (plan.py uses 15 m)
PAD_M = 12.0           # the pipeline adds 12 m to every gap length (match.py); applied to the along-road length too
DIFF_NOTE = 0.10       # report "≈ X m along the road" when it differs from the recorded length by more than 10 %


def display_names(street_names):
    return street_names if isinstance(street_names, dict) else {}


def named_streets(raw_streets, street_names):
    """streets.json rows with `name` = display name (joins the records) and `osm_name` = the raw OSM label."""
    N = display_names(street_names)
    out = []
    for s in raw_streets:
        out.append({**s, "osm_name": s["name"], "name": N.get(s["name"], s["name"])})
    return out


class _Frame:
    """Local metres around a reference point (equirectangular; fine over a few km)."""

    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx, self.ky = 111320 * math.cos(math.radians(lat0)), 110540

    def xy(self, lat, lon):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    def lonlat(self, x, y):
        return [round(self.lon0 + x / self.kx, 7), round(self.lat0 + y / self.ky, 7)]


def _pieces(streets, F):
    """display name -> merged LineStrings (local metres)."""
    out = {}
    for s in streets:
        lines = [LineString([F.xy(p[0], p[1]) for p in ln]) for ln in s.get("lines_latlon") or [] if len(ln) >= 2]
        if not lines:
            continue
        m = linemerge(MultiLineString(lines))
        out.setdefault(s["name"], []).extend(list(m.geoms) if hasattr(m, "geoms") else [m])
    return out


def _slice(line, a, b):
    """Coordinates of `line` between distances a < b along it."""
    pts = [line.interpolate(a)]
    d = 0.0
    coords = list(line.coords)
    for (x0, y0), (x1, y1) in zip(coords, coords[1:]):
        d += math.hypot(x1 - x0, y1 - y0)
        if a < d < b:
            pts.append(Point(x1, y1))
    pts.append(line.interpolate(b))
    return pts


def gap_display(exp, named, plan, street_names):
    """{gap_id: {mode, path[[lon,lat]...], along_road_m, lit_cameras_inside, cameras_inside, longest_dark_along_road_m,
    length_differs, note}}. `named` = named_streets(...) rows; `plan` = plan.json (may be None)."""
    gaps = exp.get("streetlight_gaps", [])
    if not gaps:
        return {}
    N = display_names(street_names)
    g0 = gaps[0]["start"]
    F = _Frame(g0[0], g0[1])
    pieces = _pieces(named, F)
    all_pieces = [p for ps in pieces.values() for p in ps]
    lights = [F.xy(a["lat"], a["lon"]) for a in exp.get("assets", []) if a.get("type") == "streetlight"]
    cams = {}
    for c in plan or []:
        cams.setdefault(N.get(c.get("street"), c.get("street")), []).append(F.xy(c["camera_lat"], c["camera_lon"]))

    out = {}
    for g in gaps:
        sp, ep = Point(*F.xy(*g["start"])), Point(*F.xy(*g["end"]))
        straight = [F.lonlat(sp.x, sp.y), F.lonlat(ep.x, ep.y)]
        cand = pieces.get(g.get("street")) or all_pieces
        best = min(cand, key=lambda ln: ln.distance(sp) + ln.distance(ep), default=None)
        if best is None or best.distance(sp) > SNAP_M or best.distance(ep) > SNAP_M:
            out[g["id"]] = {"mode": "straight", "path": straight, "along_road_m": None, "lit_cameras_inside": None,
                            "cameras_inside": None, "longest_dark_along_road_m": None, "length_differs": False,
                            "note": "No analysed street line near both ends; drawn as recorded (straight)."}
            continue
        a, b = best.project(sp), best.project(ep)
        lo, hi = min(a, b), max(a, b)
        along = round(hi - lo + PAD_M)
        info = {"along_road_m": along, "lit_cameras_inside": None, "cameras_inside": None, "longest_dark_along_road_m": None}
        street_cams = cams.get(g.get("street"))
        if plan is not None and street_cams is not None:
            half = (g.get("interval_m") or 60) / 2
            on = sorted((best.project(Point(*p)), min((math.dist(p, l) for l in lights), default=1e9) <= half)
                        for p in street_cams if best.distance(Point(*p)) <= CAMERA_ON_LINE_M)
            inside = [(r, lit) for r, lit in on if lo - 0.5 <= r <= hi + 0.5]
            info["cameras_inside"] = len(inside)
            info["lit_cameras_inside"] = sum(lit for _, lit in inside)
            run, start = 0.0, None                       # longest unlit run in road order (same +12 m padding)
            for r, lit in inside:
                if lit:
                    start = None
                    continue
                start = r if start is None else start
                run = max(run, r - start + PAD_M)
            info["longest_dark_along_road_m"] = round(run) if inside else None
        differs = abs(along - g["length_m"]) > DIFF_NOTE * g["length_m"]
        if info["lit_cameras_inside"]:
            n = info["lit_cameras_inside"]
            out[g["id"]] = {"mode": "check", "path": straight, **info, "length_differs": differs,
                            "note": (f"Street bends: {n} lit camera stop{'s' if n > 1 else ''} lie on the road between "
                                     f"these ends, so along the road this is not one dark stretch "
                                     f"(longest unlit stretch ≈ {info['longest_dark_along_road_m']} m). Drawn as recorded; "
                                     f"check on imagery.")}
            continue
        pts = _slice(best, lo, hi)
        path = [F.lonlat(p.x, p.y) for p in pts]
        if a > b:
            path.reverse()
        out[g["id"]] = {"mode": "along_road", "path": path, **info, "length_differs": differs,
                        "note": (f"≈ {along} m along the road (recorded {g['length_m']} m is measured on a straight "
                                 f"line fitted to the street's camera stops).") if differs else None}
    return out


def gap_consistency(gaps, display):
    """Trust-page 'data consistency' rows for gaps whose recorded extent/length disagrees with the road (D2)."""
    rows = []
    for g in gaps:
        d = display.get(g["id"])
        if not d:
            continue
        if d["mode"] == "check":
            rows.append({"field": f"streetlight_gaps.{g['id']} ({g.get('street')})",
                         "stored": f"one {g['length_m']} m gap",
                         "computed": f"{d['lit_cameras_inside']} lit camera stops on the road between its ends; "
                                     f"longest unlit stretch ≈ {d['longest_dark_along_road_m']} m",
                         "source": "export.json + streets.json + plan.json",
                         "note": "pipeline orders cameras along one straight line (match.py); on a bent street that "
                                 "mixes both sides. Pipeline follow-up, not changed in the app."})
        elif d["length_differs"]:
            rows.append({"field": f"streetlight_gaps.{g['id']}.length_m ({g.get('street')})",
                         "stored": g["length_m"], "computed": f"≈ {d['along_road_m']} m along the road",
                         "source": "export.json + streets.json",
                         "note": "pipeline measures gap length on a straight fitted line (match.py), which understates "
                                 "curved streets; same +12 m end padding applied. The recorded value is shown."})
    return rows
