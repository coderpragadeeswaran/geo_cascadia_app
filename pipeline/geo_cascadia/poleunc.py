"""Single-camera pole uncertainty by distance (D45).

A pole seen from one camera position only is placed from its direction and a rough distance: where its base meets the
ground in the photo (geometry._rough_distance, camera height 2.5 m, kept up to 15 m). That distance gets worse the
farther the pole is. Before D45 every such pole got a fixed ±3.5 m ("86% within 3.5 m", which the notebook measured for
0–8 m only).

Measurement (a consistency check, not surveyed truth): for every pole that WAS triangulated from 2+ camera positions,
each single camera's own estimate is compared with the triangulated point, grouped by that camera's rough distance.
`measure()` returns the per-band table; config.single_cam_unc_bands holds the fitted values (copied from the table by
tools/pole_uncertainty.py, which also writes model_card.json "single_camera_by_distance"). `uncertainty_for()` is what
the export uses. No sklearn: runs on the laptop as well.

The consistency check leans small (only poles two cameras agreed on are in it), so each band uses the LARGER of its 80th
percentile and the notebook's surveyed check for that distance (SURVEYED_MEDIAN_M, rounded up to 0.5 m): 8–15 m median
4.55 m → ±5 m. That surveyed number is a median, so about half of such estimates fall inside a ±5 m circle.
"""
import math

from .geo import Frame, bearing_between, haversine, pixel_to_bearing

BANDS = ((0, 8), (8, 11), (11, 15))           # >= 10 samples per band in the P7a measurement (63 in all)
# the notebook's surveyed single-camera check (n=1469 detections): (from m, to m) → median error m
SURVEYED_MEDIAN_M = (((0, 8), 1.64), ((8, 15), 4.55))


def surveyed_median(band):
    """the surveyed median of the surveyed band that contains this band (None if none does)"""
    return next((m for (lo, hi), m in SURVEYED_MEDIAN_M if lo <= band[0] and band[1] <= hi), None)


def rough_distance(d, cfg):
    """geometry._rough_distance (the same formula), without importing geometry (sklearn)."""
    v, H, fov = d.get("v_base"), d.get("H") or 640, d.get("fov") or 90
    if v is None or v >= H - 4:
        return None
    ratio = (2.0 * v / H - 1.0) * math.tan(math.radians(fov) / 2.0)
    if ratio < cfg.min_ratio:
        return None
    dist = cfg.cam_h / ratio
    return dist if dist <= cfg.rough_max_d else None


def _pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def single_camera_errors(dets, assets, cfg, max_bearing_deg=6.0):
    """[(rough distance m, error m, pano, asset index)] for every level pole ray of a triangulated asset.
    A ray belongs to the asset when it comes from one of the asset's panoramas and points at it (bearing within
    max_bearing_deg). One ray per (panorama, heading, bearing/3°), as in locate_assets."""
    tri = [(i, a) for i, a in enumerate(assets) if a.get("method") == "triangulated" and a.get("lat") is not None]
    out, seen = [], set()
    for d in sorted((d for d in dets if d.get("cls") == "pole" and d.get("geom_ok")), key=lambda d: -d.get("conf", 0)):
        dist = rough_distance(d, cfg)
        if dist is None:
            continue
        b = pixel_to_bearing(d["heading"], d["u"], d.get("W") or 640, d.get("fov") or 90)
        key = (d["pano_id"], d["heading"], round(b / 3.0))
        if key in seen:
            continue
        best = None
        for i, a in tri:
            if d["pano_id"] not in (a.get("pano_ids") or []):
                continue
            ab = bearing_between(d["camera_lat"], d["camera_lon"], a["lat"], a["lon"])
            off = abs((b - ab + 180) % 360 - 180)
            if off <= max_bearing_deg and (best is None or off < best[0]):
                best = (off, i, a)
        if best is None:
            continue
        seen.add(key)
        F = Frame(d["camera_lat"], d["camera_lon"])
        la, lo = F.ll(dist * math.sin(math.radians(b)), dist * math.cos(math.radians(b)))
        out.append((dist, haversine(la, lo, best[2]["lat"], best[2]["lon"]), d["pano_id"], best[1]))
    return out


def measure(samples, bands=BANDS):
    """per distance band: n, median and 80th-percentile single-camera error (m)"""
    rows = []
    for lo, hi in bands:
        e = [err for dist, err, *_ in samples if lo <= dist < hi or (hi == bands[-1][1] and dist == hi)]
        rows.append({"band_m": [lo, hi], "n": len(e),
                     "median_m": round(_pct(e, 0.5), 2) if e else None, "p80_m": round(_pct(e, 0.8), 2) if e else None})
    return rows


def camera_distance(asset, panos):
    """mean distance (m) from the asset's cameras to its position; None when no camera is known"""
    ds = [haversine(p["camera_lat"], p["camera_lon"], asset["lat"], asset["lon"])
          for pid in (asset.get("pano_ids") or []) if (p := panos.get(pid))]
    return round(sum(ds) / len(ds), 1) if ds else None


def uncertainty_for(dist_m, cfg):
    """±m for a single-camera asset at this camera distance (config.single_cam_unc_bands: upper edge → ±m, the larger of
    the band's 80th percentile and the surveyed median, rounded up to 0.5 m). Beyond the last band, or with no distance, the last (largest) value."""
    bands = cfg.single_cam_unc_bands
    if dist_m is not None:
        for upper, unc in bands:
            if dist_m <= upper:
                return unc
    return bands[-1][1]
