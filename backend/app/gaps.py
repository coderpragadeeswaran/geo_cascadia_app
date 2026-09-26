"""Streetlight gaps at ANY interval, computed by the app with the pipeline's own method (review fix 2).

The pipeline computes gaps at 40 / 60 / 100 m inside geo_cascadia.match.asset_layer but exported only 60 m. This is a
line-for-line port of that loop (the pipeline is not modified): camera stops grouped by (street, carriageway), ordered
along a straight line fitted through them (SVD), a stop is "lit" if a streetlight lies within interval/2, a run of unlit
stops is a gap when its length (+12 m end padding) is at least the interval; poles within 15 m of the run are counted.
At 60 m it reproduces the exported gaps exactly (tested), so other intervals are the same method, not a guess.
"""
import math
import os
import threading
from collections import defaultdict

import numpy as np

from geo_cascadia.geo import Frame

from .streetgeo import display_names

PAD_M = 12.0
POLE_M = 15


def compute_gaps(bundle, plan, street_names, interval_m):
    """Gaps at `interval_m` in the export's shape ({id, street, carriageway, length_m, start, end, poles_inside,
    gap_type}); street = display name (street_names.json, D13). None when the camera plan is missing."""
    if not plan:
        return None
    c = bundle.get("polygon") or {}
    try:
        from shapely.geometry import shape
        cen = shape(c).centroid
        F = Frame(cen.y, cen.x)
    except Exception:
        F = Frame(plan[0]["camera_lat"], plan[0]["camera_lon"])
    L = lambda lat, lon: F.xy(lat, lon)
    lights = [L(a["lat"], a["lon"]) for a in bundle["assets"] if a["type"] == "streetlight"]
    poles = [L(a["lat"], a["lon"]) for a in bundle["assets"] if a["type"] == "pole"]
    groups = defaultdict(list)
    for e in plan:
        groups[(e["street"], e.get("carriageway", 0))].append(L(e["camera_lat"], e["camera_lon"]))
    iv = float(interval_m)
    res = []
    for (st, cw), pts in groups.items():
        if len(pts) < 3:
            continue
        P = np.array(pts)
        cm = P.mean(0)
        u = np.linalg.svd(P - cm)[2][0]
        t = (P - cm) @ u
        o = np.argsort(t)
        P, t = P[o], t[o]
        lit = np.array([min((math.dist(p, l) for l in lights), default=1e9) <= iv / 2 for p in P])
        i = 0
        while i < len(P):
            if lit[i]:
                i += 1
                continue
            j = i
            while j + 1 < len(P) and not lit[j + 1]:
                j += 1
            length = float(t[j] - t[i]) + PAD_M
            if length >= iv:
                seg = P[i:j + 1]
                npole = sum(1 for p in poles if min(math.dist(p, tuple(q)) for q in seg) <= POLE_M)
                res.append({"street": street_names.get(st, st), "carriageway": cw, "length_m": round(length),
                             "start": list(F.ll(*seg[0])), "end": list(F.ll(*seg[-1])), "poles_inside": npole,
                             "interval_m": int(interval_m),
                             "gap_type": "poles present, no lamp detected" if npole else "no pole or lamp detected"})
            i = j + 1
    for k, g in enumerate(res, 1):
        g["id"] = f"gap{int(interval_m)}-{k:03d}"
    return res


COMPUTED_NOTE = "computed by the app with the pipeline's method (pipeline stored only 60 m)"


class GapCalc:
    """Computed gaps per (area, interval), with their along-road display (streetgeo.gap_display, D13); cached by the
    area's file stamps. Reads plan.json / streets.json / street_names.json next to export.json."""

    def __init__(self, areas_dir):
        self.dir = areas_dir
        self._cache, self._lock = {}, threading.Lock()

    def get(self, bundle, interval_m):
        """{"rows": [...], "display": {id: {...}}} or None when the camera plan is missing (can't be computed)."""
        from . import loader
        from .streetgeo import gap_display, named_streets
        folder = os.path.join(self.dir, bundle["slug"])
        stamps = tuple(os.path.getmtime(os.path.join(folder, n)) if os.path.exists(os.path.join(folder, n)) else 0
                       for n in ("export.json", "plan.json", "streets.json", "street_names.json"))
        key = (bundle["slug"], int(interval_m))
        with self._lock:
            hit = self._cache.get(key)
            if hit and hit[0] == stamps and hit[1] is bundle.get("assets"):
                return hit[2]
        raw, names, plan = loader.read_street_inputs(folder)
        rows = compute_gaps(bundle, plan, display_names(names), interval_m)
        res = None
        if rows is not None:
            disp = gap_display({"streetlight_gaps": rows, "assets": bundle["assets"]}, named_streets(raw, names), plan, names)
            res = {"rows": rows, "display": disp}
        with self._lock:
            self._cache[key] = (stamps, bundle.get("assets"), res)
        return res
