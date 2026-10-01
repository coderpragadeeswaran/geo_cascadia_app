"""P7.3: street-name consistency picker.

Every analysed street can carry several names: OpenStreetMap's, Google's (the pipeline's geocoding vote, kept in
street_names_pipeline.json once the app changed street_names.json), the street picker's F2 rule (OSM name → Google's name
for the road itself → "Unnamed road between / near …"), and the synthetic register's (it copies the raw OSM label).
`tools/street_name_candidates.py` lists them per street in data/areas/<slug>/street_name_candidates.json (no network at
request time). A person may pick the name to DISPLAY; picks are stored in data/street_name_picks.json and applied when an
area is read (JSON store and database loader alike). No source file is ever changed by a pick.
"""
import copy
import json
import os
import threading

STREET_KEYS = ("buildings", "assets", "missing_asset_records", "streetlight_gaps", "unmapped_businesses", "review_queue")
_LOCK = threading.Lock()


def picks_path(data_dir):
    return os.path.join(data_dir, "street_name_picks.json")


def read_picks(data_dir):
    try:
        with open(picks_path(data_dir), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_pick(data_dir, slug, raw, name):
    """name None = remove the pick (back to the default display name)"""
    with _LOCK:
        p = read_picks(data_dir)
        area = p.setdefault(slug, {})
        if name is None:
            area.pop(raw, None)
        else:
            area[raw] = name
        if not area:
            p.pop(slug, None)
        tmp = picks_path(data_dir) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(p, f, ensure_ascii=False, indent=1)
        os.replace(tmp, picks_path(data_dir))
    return p.get(slug, {})


def apply(folder, exp, names):
    """(export, street_names) with this area's picks applied: the street's display name and every record that carries it.
    Returns copies when a pick applies; the inputs otherwise."""
    folder = os.path.abspath(folder)
    slug = os.path.basename(folder.rstrip("\\/"))
    picks = read_picks(os.path.dirname(os.path.dirname(folder))).get(slug) or {}
    if not picks:
        return exp, names
    names = dict(names if isinstance(names, dict) else {})
    rename = {}
    for raw, new in picks.items():
        old = names.get(raw, raw)
        if old != new:
            rename[old] = new
        names[raw] = new
    if not rename:
        return exp, names
    exp = copy.deepcopy(exp)
    for key in STREET_KEYS:
        for rec in exp.get(key) or []:
            if isinstance(rec, dict) and rec.get("street") in rename:
                rec["street"] = rename[rec["street"]]
    d = exp.get("dashboard") or {}
    by = (d.get("charts") or {}).get("by_street")
    if isinstance(by, dict):
        d["charts"]["by_street"] = {rename.get(k, k): v for k, v in by.items()}
    if isinstance(d.get("streets"), list):
        d["streets"] = [rename.get(x, x) for x in d["streets"]]
    if exp.get("meta", {}).get("area") in rename:
        exp["meta"]["area"] = rename[exp["meta"]["area"]]
    return exp, names


def candidates(folder):
    """street_name_candidates.json (made by tools/street_name_candidates.py), or None"""
    p = os.path.join(folder, "street_name_candidates.json")
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None
