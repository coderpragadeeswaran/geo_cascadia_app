"""Shared geometry: local metric frame, bearings, triangulation (ported from notebook cell 3)."""
import math
import numpy as np


def _earth_radii(lat_deg):
    a, e2 = 6378137.0, 6.69437999014e-3
    s2 = math.sin(math.radians(lat_deg)) ** 2
    N = a / math.sqrt(1 - e2 * s2)
    M = a * (1 - e2) / (1 - e2 * s2) ** 1.5
    return M, N


class Frame:
    """Flat metre grid around (lat0, lon0): x = east, y = TRUE north."""
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.M, self.N = _earth_radii(lat0)
        self.kx = self.N * math.cos(math.radians(lat0))

    def xy(self, lat, lon):
        return math.radians(lon - self.lon0) * self.kx, math.radians(lat - self.lat0) * self.M

    def ll(self, x, y):
        return self.lat0 + math.degrees(y / self.M), self.lon0 + math.degrees(x / self.kx)


def pixel_to_bearing(theta_cam, u, W, fov):
    off = math.degrees(math.atan((2 * u / W - 1) * math.tan(math.radians(fov / 2))))
    return (theta_cam + off) % 360


def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def bearing_between(lat1, lon1, lat2, lon2):
    p1, p2, dl = map(math.radians, (lat1, lat2, lon2 - lon1))
    return math.degrees(math.atan2(math.sin(dl) * math.cos(p2),
                        math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl))) % 360


def _dir(b):
    r = math.radians(b)
    return math.sin(r), math.cos(r)


def ray_crossing_angle(b1, b2):
    sep = abs(b1 - b2) % 360
    sep = min(sep, 360 - sep)
    return min(sep, 180 - sep)


def _lsq(points, bearings):
    A, b = [], []
    for (e, n), brg in zip(points, bearings):
        dx, dy = _dir(brg)
        A.append([-dy, dx]); b.append(-dy * e + dx * n)
    sol, *_ = np.linalg.lstsq(np.array(A), np.array(b), rcond=None)
    return sol


def triangulate_multiview(cams, bearings, min_sep=30, max_range=60):
    """Best-fit point from 2+ camera rays; drops cameras without a good-angle partner or pointing away."""
    n = len(cams)
    if n < 2:
        return None
    f = Frame(*cams[0])
    pts = [f.xy(*c) for c in cams]
    active = list(range(n))
    for _ in range(n):
        good = set()
        for a in range(len(active)):
            for b in range(a + 1, len(active)):
                i, j = active[a], active[b]
                if ray_crossing_angle(bearings[i], bearings[j]) >= min_sep:
                    good.update([i, j])
        active = [i for i in active if i in good]
        if len(active) < 2:
            return None
        e, nn = _lsq([pts[i] for i in active], [bearings[i] for i in active])
        bad = []
        for i in active:
            dx, dy = _dir(bearings[i])
            along = (e - pts[i][0]) * dx + (nn - pts[i][1]) * dy
            if along <= 0 or along > max_range:
                bad.append(i)
        if not bad:
            break
        active = [i for i in active if i not in bad]
        if len(active) < 2:
            return None
    res = []
    for i in active:
        dx, dy = _dir(bearings[i])
        res.append(abs(-dy * (e - pts[i][0]) + dx * (nn - pts[i][1])))
    lat, lon = f.ll(e, nn)
    return {"lat": lat, "lon": lon, "cameras_used": active, "residuals_m": res}
