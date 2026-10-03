"""Buildings seen only by the camera (D56): camera rays from several positions crossing where OpenStreetMap has no
building outline (the pipeline's building_positions.json "no_footprint", P7.3 / D52). They are not analysed buildings
(no use, floors or register check), so the main building count stays the analysed buildings; this count is shown next
to it as "+ N seen only by camera". Read from the area's run files (works with or without the database), cached by the
file's modification time."""
import json
import os
import threading

_DIR = {"areas": None}
_CACHE, _LOCK = {}, threading.Lock()


def configure(areas_dir):
    _DIR["areas"] = areas_dir


def count(slug, areas_dir=None):
    """number of camera-only buildings with a position; 0 when the run has no building_positions.json"""
    d = areas_dir or _DIR["areas"]
    if not d:
        return 0
    path = os.path.join(d, slug, "building_positions.json")
    try:
        stamp = os.path.getmtime(path)
    except OSError:
        return 0
    with _LOCK:
        hit = _CACHE.get(path)
    if hit and hit[0] == stamp:
        return hit[1]
    try:
        with open(path, encoding="utf-8") as f:
            n = sum(1 for q in json.load(f).get("no_footprint") or [] if q.get("lat") is not None)
    except (OSError, ValueError):
        n = 0
    with _LOCK:
        _CACHE[path] = (stamp, n)
    return n


def phrase(n):
    """the plain wording used next to the building count (the web app has the same in lib/labels.ts)"""
    return f"+ {n} seen only by camera (no map outline)" if n else ""
