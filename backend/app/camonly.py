"""Buildings seen only by the camera (D56): camera rays from several positions crossing where OpenStreetMap has no
building outline (the pipeline's building_positions.json "no_footprint", P7.3 / D52). They are not analysed buildings
(no use, floors or register check), so the main building count stays the analysed buildings; this count is shown next
to it as "+ N seen only by camera"; only those inside the area's boundary (D65). Read from the area's run files (works with or without the database), cached by the
file's modification time."""
import json
import os
import threading

_DIR = {"areas": None}
_CACHE, _LOCK = {}, threading.Lock()


def configure(areas_dir):
    _DIR["areas"] = areas_dir


def _polygon(folder):
    """the area's own boundary, by the loader's rule (the study area when the records lie inside it, else the streets
    buffered 40 m): the same polygon the area is shown and counted with"""
    from shapely.geometry import shape
    from . import loader
    exp = loader._read(os.path.join(folder, "export.json"))
    streets, _, _ = loader.read_street_inputs(folder)
    poly, _src = loader.area_polygon(exp, streets)
    return shape(poly) if isinstance(poly, dict) else poly


def points(slug, areas_dir=None):
    """[(index in no_footprint, point)] of the camera-only buildings INSIDE the area's boundary (D65: as for the analysed
    buildings; a point outside, e.g. a building across a boundary road whose outline the run's map did not load, is not
    shown or counted). Cached by the files' modification times."""
    d = areas_dir or _DIR["areas"]
    if not d:
        return []
    folder = os.path.join(d, slug)
    path = os.path.join(folder, "building_positions.json")
    try:
        stamp = (os.path.getmtime(path), os.path.getmtime(os.path.join(folder, "export.json")))
    except OSError:
        return []
    with _LOCK:
        hit = _CACHE.get(path)
    if hit and hit[0] == stamp:
        return hit[1]
    try:
        from shapely.geometry import Point
        from shapely.prepared import prep
        with open(path, encoding="utf-8") as f:
            nf = json.load(f).get("no_footprint") or []
        area = prep(_polygon(folder))
        pts = [(i, q) for i, q in enumerate(nf) if q.get("lat") is not None and area.covers(Point(q["lon"], q["lat"]))]
    except (OSError, ValueError, KeyError):
        pts = []
    with _LOCK:
        _CACHE[path] = (stamp, pts)
    return pts


def count(slug, areas_dir=None):
    """number of camera-only buildings with a position inside the area; 0 when the run has no building_positions.json"""
    return len(points(slug, areas_dir))


def phrase(n):
    """the plain wording used next to the building count (the web app has the same in lib/labels.ts)"""
    return f"+ {n} seen only by camera (no map outline)" if n else ""
