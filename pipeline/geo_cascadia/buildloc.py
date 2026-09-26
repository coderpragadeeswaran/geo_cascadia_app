"""Building positions predicted from camera rays (P4.5, FarmwiseAI Gate 1), separate from the footprint centroid.

Reuses what the geometry step already has:
- Each level, Google-car building box (geom_ok) gives a ray: camera position + bearing of the box's centre column
  (pixel_to_bearing), exactly as building_views() does.
- Area.cast() returns the first footprint the ray hits (<= ray_max_range_m). The footprint is used ONLY to group the
  rays of one building; it is not the position.
- 2+ camera positions with rays >= 30 deg apart: the box's left and right edges (the ends of the visible front wall)
  are triangulated separately with triangulate_multiview() (the asset solver); the point is their midpoint, on the
  facade (D26). Uncertainty = largest residual (>= 0.5 m), or None when a corner rests on only two cameras.
  method "triangulated". (Part 1 aimed at the box centre, which put points behind the facade: aim="centre".)
- Otherwise (1 camera, or rays too parallel / pointing away): the point where the best ray meets the footprint edge
  (ray_dist_m). method "single_ray", approximate. Its distance ALONG the ray comes from the footprint, so it is not an
  independent position.
- Buildings with no footprint: rays that hit no footprint (building and signboard boxes) are intersected pairwise
  (in front of both cameras, >= 30 deg, <= 60 m); intersections that agree (>= 3 cameras) are solved the same way.

Nothing here changes lat/lon (the centroid) or any other output of the pipeline.
"""
import math
from collections import defaultdict

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from .geo import pixel_to_bearing, ray_crossing_angle, triangulate_multiview

MIN_SEP_DEG, MAX_RANGE_M = 30.0, 60.0


def _dir(b):
    r = math.radians(b)
    return math.sin(r), math.cos(r)


def building_rays(dets, area, classes=("building",)):
    """One ray per level detection of `classes`, cast into the footprints: {..det, bearing, cx, cy, hit_m, fp}."""
    out = []
    for d in dets:
        if d["cls"] not in classes or not d.get("geom_ok"):
            continue
        b = pixel_to_bearing(d["heading"], d["u"], d["W"], d["fov"])
        cx, cy = area.L(d["camera_lat"], d["camera_lon"])
        nx, ny = _dir(b)
        dist, idx = area.cast(cx, cy, nx, ny)
        out.append({**d, "bearing": b, "cx": cx, "cy": cy, "hit_m": dist,
                    "fp": area.fp_ids[idx] if idx is not None else None})
    return out


EDGE_FRAC = 0.03             # a box edge within 3 % of the image border is clipped (same as building_views side_cut)


def _solve(R, bearings, min_sep, max_range):
    """triangulate_multiview over rays R with the given bearings; + the local point and the cameras used."""
    t = triangulate_multiview([(r["camera_lat"], r["camera_lon"]) for r in R], bearings, min_sep, max_range)
    return t


def _uncertainty(*solutions):
    """Largest ray residual (>= 0.5 m, as for assets); None ("not estimated") when any solution rests on exactly two
    cameras: two rays always meet exactly, so their residual says nothing (D26)."""
    if any(len(t["cameras_used"]) < 3 for t in solutions):
        return None
    return round(max(max(max(t["residuals_m"]) for t in solutions), 0.5), 2)


def locate_buildings(dets, area, cfg, min_sep=MIN_SEP_DEG, max_range=MAX_RANGE_M, rays=None, aim="corners"):
    """{footprint id: predicted_position} for every footprint hit by at least one building ray.

    aim="corners" (D26, default): the box's LEFT and RIGHT edges are the two ends of the visible front wall. Each edge's
    rays are triangulated across cameras (edges clipped at the image border are left out) and the point is the midpoint
    of the two triangulated corners: a point on the facade line, not behind it. If one corner is clipped in every view,
    the box-centre method is used instead and marked ("triangulated_centre", fallback "corner_clipped_all_views").
    aim="centre" is the P4.5 part-1 method (box-centre rays), kept for comparison.
    Neither uses the footprint in the position; it only groups the rays. "single_ray" (one usable camera) does use it:
    the point is where the best ray meets the footprint edge, so it is marked approximate and "uses footprint".

    predicted_position = {lat, lon, method, n_cameras, uncertainty_m (None = not estimated), approximate, fallback,
    uses_footprint, cameras_seen, basis, best_pano, best_bearing}."""
    rays = rays if rays is not None else building_rays(dets, area)
    by_fp = defaultdict(dict)                                 # footprint -> camera (pano) -> its best ray
    for r in rays:
        if r["fp"] is None:
            continue
        cur = by_fp[r["fp"]].get(r["pano_id"])
        if cur is None or r["conf"] > cur["conf"]:
            by_fp[r["fp"]][r["pano_id"]] = r
    out = {}
    for fp, cams in by_fp.items():
        R = sorted(cams.values(), key=lambda r: -r["conf"])
        pos, fallback = None, None
        if len(R) >= 2 and aim == "corners":
            L = [r for r in R if r["x1"] > r["W"] * EDGE_FRAC]
            Rt = [r for r in R if r["x2"] < r["W"] * (1 - EDGE_FRAC)]
            if not L or not Rt:
                fallback = "corner_clipped_all_views"
            else:
                tl = _solve(L, [pixel_to_bearing(r["heading"], r["x1"], r["W"], r["fov"]) for r in L], min_sep, max_range) if len(L) >= 2 else None
                tr = _solve(Rt, [pixel_to_bearing(r["heading"], r["x2"], r["W"], r["fov"]) for r in Rt], min_sep, max_range) if len(Rt) >= 2 else None
                if tl and tr:
                    (xl, yl), (xr, yr) = area.L(tl["lat"], tl["lon"]), area.L(tr["lat"], tr["lon"])
                    lat, lon = area.frame.ll((xl + xr) / 2, (yl + yr) / 2)
                    pos = {"lat": round(lat, 7), "lon": round(lon, 7), "method": "triangulated",
                           "n_cameras": len({*(L[i]["pano_id"] for i in tl["cameras_used"]),
                                             *(Rt[i]["pano_id"] for i in tr["cameras_used"])}),
                           "uncertainty_m": _uncertainty(tl, tr), "approximate": False, "fallback": None,
                           "uses_footprint": False, "facade_width_m": round(math.dist((xl, yl), (xr, yr)), 1),
                           "basis": "midpoint of the triangulated left and right wall corners (box edges)"}
                else:
                    fallback = "corner_not_triangulable"      # < 2 unclipped cameras for a corner, or < 30 deg apart
        if pos is None and len(R) >= 2 and (aim == "centre" or fallback == "corner_clipped_all_views"):
            t = _solve(R, [r["bearing"] for r in R], min_sep, max_range)
            if t:
                pos = {"lat": round(t["lat"], 7), "lon": round(t["lon"], 7),
                       "method": "triangulated" if aim == "centre" else "triangulated_centre",
                       "n_cameras": len(t["cameras_used"]), "uncertainty_m": _uncertainty(t), "approximate": aim != "centre",
                       "fallback": fallback, "uses_footprint": False,
                       "basis": "box-centre rays of 2+ camera positions >= 30 deg apart"}
        if pos is None:
            r = R[0]
            nx, ny = _dir(r["bearing"])
            lat, lon = area.frame.ll(r["cx"] + r["hit_m"] * nx, r["cy"] + r["hit_m"] * ny)
            pos = {"lat": round(lat, 7), "lon": round(lon, 7), "method": "single_ray", "n_cameras": 1,
                   "uncertainty_m": cfg.single_cam_uncertainty_m, "approximate": True, "fallback": fallback,
                   "uses_footprint": True,
                   "basis": ("one camera: where its ray meets the footprint edge" if len(R) == 1 else
                             f"{len(R)} cameras but no usable triangulation ({fallback or 'rays < 30 deg apart or pointing away'}):"
                             " best ray meets the footprint edge")}
        # the best ray's hit on the footprint edge, kept for every building so a caller can choose per building
        # (e.g. triangulated only with >= 3 cameras, else this point); it uses the footprint (D26)
        r0 = R[0]
        nx0, ny0 = _dir(r0["bearing"])
        la0, lo0 = area.frame.ll(r0["cx"] + r0["hit_m"] * nx0, r0["cy"] + r0["hit_m"] * ny0)
        pos.update(cameras_seen=len(R), best_pano=R[0]["pano_id"], best_bearing=round(R[0]["bearing"], 2),
                   single_ray_point={"lat": round(la0, 7), "lon": round(lo0, 7)})
        out[fp] = pos
    return out


def _link(points, eps):
    """Single-link clusters of points closer than eps (= DBSCAN min_samples=1), without scikit-learn so the step
    also runs on the laptop. Returns one label per point."""
    P = np.asarray(points, float)
    parent = list(range(len(P)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    order = np.argsort(P[:, 0])
    for k, i in enumerate(order):                          # sweep along x: only neighbours within eps in x
        for j in order[k + 1:]:
            if P[j, 0] - P[i, 0] > eps:
                break
            if math.dist(P[i], P[j]) <= eps:
                parent[find(i)] = find(j)
    return [find(i) for i in range(len(P))]


def _intersect(a, b):
    """Point where rays a and b cross, with the distance along each; None when parallel."""
    ax, ay = _dir(a["bearing"]); bx, by = _dir(b["bearing"])
    den = ax * by - ay * bx
    if abs(den) < 1e-9:
        return None
    dx, dy = b["cx"] - a["cx"], b["cy"] - a["cy"]
    ta = (dx * by - dy * bx) / den
    tb = (dx * ay - dy * ax) / den
    return a["cx"] + ta * ax, a["cy"] + ta * ay, ta, tb


def locate_unmapped_buildings(dets, area, cfg, min_sep=MIN_SEP_DEG, max_range=MAX_RANGE_M, eps_m=3.0, min_cameras=3,
                              rays=None):
    """Points for buildings with NO footprint: rays (building and signboard boxes) that hit no footprint, crossed
    pairwise; intersections within eps_m of each other form a cluster; a cluster seen from >= min_cameras camera
    positions is solved with triangulate_multiview and kept if its largest residual <= eps_m.
    Returns (points, stats)."""
    rays = rays if rays is not None else building_rays(dets, area, ("building", "signboard"))
    free = [r for r in rays if r["fp"] is None]
    pts, pairs = [], []
    for cls in ("building", "signboard"):
        R = [r for r in free if r["cls"] == cls]
        C = np.array([[r["cx"], r["cy"]] for r in R]) if R else np.zeros((0, 2))
        for i in range(len(R)):
            near = np.where(np.hypot(*(C[i + 1:] - C[i]).T) <= 2 * max_range)[0] + i + 1 if i + 1 < len(R) else []
            for j in near:
                a, b = R[i], R[j]
                if a["pano_id"] == b["pano_id"] or ray_crossing_angle(a["bearing"], b["bearing"]) < min_sep:
                    continue
                x = _intersect(a, b)
                if x is None or not (0 < x[2] <= max_range and 0 < x[3] <= max_range):
                    continue
                pts.append((x[0], x[1])); pairs.append((cls, i, j, R))
    stats = {"rays_without_footprint": len(free), "crossing_pairs": len(pts), "clusters_2_cameras_only": 0,
             "clusters_solved": 0, "clusters_rejected_residual": 0}
    if not pts:
        return [], stats
    labels = _link(pts, eps_m)
    groups = defaultdict(list)
    for lab, (cls, i, j, R) in zip(labels, pairs):
        groups[(lab, cls)].append((R[i], R[j]))
    out = []
    for (lab, cls), prs in groups.items():
        cams = {}
        for r in (x for p in prs for x in p):
            if r["pano_id"] not in cams or r["conf"] > cams[r["pano_id"]]["conf"]:
                cams[r["pano_id"]] = r
        if len(cams) < min_cameras:
            stats["clusters_2_cameras_only"] += 1
            continue
        M = list(cams.values())
        t = triangulate_multiview([(r["camera_lat"], r["camera_lon"]) for r in M], [r["bearing"] for r in M],
                                  min_sep, max_range)
        if not t or max(t["residuals_m"]) > eps_m:
            stats["clusters_rejected_residual"] += 1
            continue
        stats["clusters_solved"] += 1
        out.append({"lat": round(t["lat"], 7), "lon": round(t["lon"], 7), "method": "triangulated_no_footprint",
                    "from": cls, "n_cameras": len(t["cameras_used"]),
                    "uncertainty_m": _uncertainty(t), "approximate": False})
    # the same building seen as building boxes AND signs: merge points closer than eps_m (keep more cameras)
    out.sort(key=lambda p: -p["n_cameras"])
    kept = []
    for p in out:
        x, y = area.L(p["lat"], p["lon"])
        if all(math.dist((x, y), area.L(q["lat"], q["lon"])) > eps_m for q in kept):
            kept.append(p)
    stats["points"] = len(kept)
    return kept, stats


# ================================================================== the production rule (D27)
ROAD_EDGE_MIN_M = 1.0
WALL_HIT_TOL_M = 0.5        # the ray's first hit on this footprint must BE the road-facing wall
PLAUSIBLE_MAX_M = 10.0      # a triangulated point farther than this from the road-facing wall is rejected


def road_facing_edge(poly, street_line):
    """The footprint edge (>= 1 m) whose midpoint is nearest the building's street line (the longer on a tie)."""
    ring = list(poly.exterior.coords)
    edges = [LineString([ring[i], ring[i + 1]]) for i in range(len(ring) - 1)
             if math.dist(ring[i], ring[i + 1]) >= ROAD_EDGE_MIN_M]
    if not edges or street_line is None:
        return None
    return min(edges, key=lambda e: (round(street_line.distance(e.interpolate(0.5, normalized=True)), 1), -e.length))


def _corner_bearing(r, side):
    return pixel_to_bearing(r["heading"], r["x1"] if side == "left" else r["x2"], r["W"], r["fov"])


def _pair_spread(L, Rt, final_xy, area, min_sep, max_range):
    """Self-consistency: every camera pair that sees BOTH corners unclipped gives its own wall-corner midpoint; the
    spread is each pair estimate's distance from the final point."""
    left, right = {r["pano_id"]: r for r in L}, {r["pano_id"]: r for r in Rt}
    both = [p for p in left if p in right]
    out = []
    for i in range(len(both)):
        for j in range(i + 1, len(both)):
            a, b = both[i], both[j]
            cams = [(left[a]["camera_lat"], left[a]["camera_lon"]), (left[b]["camera_lat"], left[b]["camera_lon"])]
            tl = triangulate_multiview(cams, [_corner_bearing(left[a], "left"), _corner_bearing(left[b], "left")], min_sep, max_range)
            tr = triangulate_multiview(cams, [_corner_bearing(right[a], "right"), _corner_bearing(right[b], "right")], min_sep, max_range)
            if tl and tr:
                (xl, yl), (xr, yr) = area.L(tl["lat"], tl["lon"]), area.L(tr["lat"], tr["lon"])
                out.append(math.dist(((xl + xr) / 2, (yl + yr) / 2), final_xy))
    return out


def predict_positions(dets, area, buildings, street_lines, cfg, min_sep=MIN_SEP_DEG, max_range=MAX_RANGE_M, rays=None,
                      min_cameras=2):
    """predicted_position for EVERY registered building, by the fixed production rule (D27):
      a) "triangulated": the box's wall corners triangulate (unclipped edges, pairs >= 30 deg apart, in front, <= 60 m)
         and >= 2 camera positions take part (D28, owner decision: variant B) -> midpoint of the two corners.
         uncertainty_m = median distance of the
         single-pair estimates from the final point (self-consistency), None when no pair sees both corners;
      b) "wall_hit": the highest-confidence camera ray whose first hit on this footprint is its road-facing wall -> that
         hit point (uses the map footprint); uncertainty None ("not estimated");
      c) "footprint_centre": the footprint centroid; uncertainty None.
    Plausibility: a triangulated point > PLAUSIBLE_MAX_M from the building's ROAD-FACING WALL (the footprint edge it
    should lie on) is rejected; the building falls back to b) then c) and "reason" says so ("triangulation rejected:
    implausible (X m from road-facing wall)"). Without a street line to pick that wall, the footprint polygon is used.
    min_cameras: camera positions a triangulation needs (production rule: 2 since D28; 3 was variant A). With
    exactly 2 cameras the one pair estimate IS the final point, so uncertainty is None (not estimated).
    `buildings` = the building register ({building_id, lat, lon, street, footprint_latlon}); `street_lines` = {street
    name: line geometry in area-local metres} (Area.streets or streets.json). lat/lon of a building stay its centroid.
    Returns {building_id: {lat, lon, method, n_cameras, uncertainty_m, reason, cameras_seen, pair_estimates}}."""
    rays = rays if rays is not None else building_rays(dets, area)
    by_fp = defaultdict(dict)
    for r in rays:
        if r["fp"] is not None:
            cur = by_fp[r["fp"]].get(r["pano_id"])
            if cur is None or r["conf"] > cur["conf"]:
                by_fp[r["fp"]][r["pano_id"]] = r
    all_streets = unary_union(list(street_lines.values())) if street_lines else None
    out = {}
    for b in buildings:
        bid = b["building_id"]
        R = sorted(by_fp.get(bid, {}).values(), key=lambda r: -r["conf"])
        base = {"cameras_seen": len(R), "pair_estimates": 0}
        pos, reason = None, None
        poly = area.footprints[area.idx_of[bid]] if bid in getattr(area, "idx_of", {}) else \
            Polygon([area.L(p[0], p[1]) for p in b["footprint_latlon"]])
        edge = road_facing_edge(poly, street_lines.get(b.get("street")) if street_lines else None) or \
            road_facing_edge(poly, all_streets)
        # a) wall-corner triangulation with >= min_cameras cameras
        L = [r for r in R if r["x1"] > r["W"] * EDGE_FRAC]
        Rt = [r for r in R if r["x2"] < r["W"] * (1 - EDGE_FRAC)]
        if len(L) >= 2 and len(Rt) >= 2:
            tl = triangulate_multiview([(r["camera_lat"], r["camera_lon"]) for r in L], [_corner_bearing(r, "left") for r in L], min_sep, max_range)
            tr = triangulate_multiview([(r["camera_lat"], r["camera_lon"]) for r in Rt], [_corner_bearing(r, "right") for r in Rt], min_sep, max_range)
            if tl and tr:
                used = {*(L[i]["pano_id"] for i in tl["cameras_used"]), *(Rt[i]["pano_id"] for i in tr["cameras_used"])}
                if len(used) >= min_cameras:
                    (xl, yl), (xr, yr) = area.L(tl["lat"], tl["lon"]), area.L(tr["lat"], tr["lon"])
                    fx, fy = (xl + xr) / 2, (yl + yr) / 2
                    spread = _pair_spread(L, Rt, (fx, fy), area, min_sep, max_range)
                    lat, lon = area.frame.ll(fx, fy)
                    # plausibility (D27): a point on the front wall cannot be far from the road-facing wall
                    if edge is not None:
                        off, ref = edge.distance(Point(fx, fy)), "road-facing wall"
                    else:
                        off, ref = (0.0 if poly.contains(Point(fx, fy)) else poly.exterior.distance(Point(fx, fy))), "footprint"
                    if off > PLAUSIBLE_MAX_M:
                        reason = f"triangulation rejected: implausible ({off:.1f} m from {ref})"
                    else:
                        pos = {"lat": round(lat, 7), "lon": round(lon, 7), "method": "triangulated", "n_cameras": len(used),
                               "uncertainty_m": (round(float(np.median(spread)), 2) if spread and len(used) >= 3 else None),
                               **base, "pair_estimates": len(spread)}
        # b) the best ray that meets the road-facing wall first
        if pos is None and R:
            for r in R:
                if edge is None or r["hit_m"] is None:
                    break
                nx, ny = _dir(r["bearing"])
                seg = LineString([(r["cx"], r["cy"]), (r["cx"] + (r["hit_m"] + 5) * nx, r["cy"] + (r["hit_m"] + 5) * ny)])
                hit = seg.intersection(edge)
                if hit.is_empty:
                    continue
                d = Point(r["cx"], r["cy"]).distance(hit)
                if abs(d - r["hit_m"]) <= WALL_HIT_TOL_M:
                    lat, lon = area.frame.ll(r["cx"] + d * nx, r["cy"] + d * ny)
                    pos = {"lat": round(lat, 7), "lon": round(lon, 7), "method": "wall_hit", "n_cameras": 1,
                           "uncertainty_m": None, **base}
                    break
        # c) the footprint centre
        if pos is None:
            pos = {"lat": b["lat"], "lon": b["lon"], "method": "footprint_centre", "n_cameras": 0,
                   "uncertainty_m": None, **base}
        pos["reason"] = reason
        out[bid] = pos
    return out
