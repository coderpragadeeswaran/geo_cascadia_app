r"""street_name_candidates.py — P7.3: every name each analysed street has, for the street-name picker.

    backend\.venv\Scripts\python tools\street_name_candidates.py [slug ...]      (default: every area folder)

Writes data/areas/<slug>/street_name_candidates.json (a new file; no source file is changed). Per street (streets.json):
- OpenStreetMap: its name (none for an unnamed road);
- Google: the pipeline's geocoding vote over the camera stops (street_names_pipeline.json when the app has changed
  street_names.json, else street_names.json; an "Unnamed road …" label made by the app is not Google's);
- F2 rule: the street picker's answer at the middle of the street (OSM name → Google's name for the road itself →
  "Unnamed road between / near …"), with the rule that produced it; resolved with OpenStreetMap + Google Geocoding;
- register: the synthetic register's street field (it copies the raw OSM label);
- Google Places: no street names are stored (only business names and positions), said as such;
- current: the display name today (street_names.json).
`mismatch` is true when OSM / Google / F2 / current give more than one name. Needs the network and the server key.
"""
import json
import os
import sys
import time
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from app import streetpick  # noqa: E402
from app.settings import Settings  # noqa: E402

RULE = {"osm": "OpenStreetMap name", "google": "Google's name for the road itself",
        "unnamed": "no name for the road itself: named after its cross streets"}


def rd(folder, name, default):
    try:
        with open(os.path.join(folder, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def midpoint(st):
    lines = [l for l in (st.get("lines_latlon") or []) if len(l) >= 2]
    if not lines:
        return None
    l = max(lines, key=len)
    i = max(0, min(len(l) // 2 - 1, len(l) - 2))
    return (l[i][0] + l[i + 1][0]) / 2, (l[i][1] + l[i + 1][1]) / 2


def f2_name(cache, st, key, tries=10):
    at = midpoint(st)
    if not at:
        return None
    for _ in range(tries):
        try:
            r = streetpick.pick(cache, [], at[0], at[1], google_key=key)
            if r.get("osm_details") is not False:
                if not set(r["way_ids"]) & set(st.get("way_ids") or []):
                    return {"name": None, "rule": "the middle of the street resolved to another road", "complete": True}
                return {"name": streetpick.plain_name(r["street"]), "rule": RULE.get(r["name_source"], r["name_source"]),
                        "source": r["name_source"], "complete": True}
        except streetpick.NoRoad:
            return {"name": None, "rule": "no road found at the middle of the street", "complete": True}
        except streetpick.OverpassBusy:
            pass
        while streetpick._INFLIGHT or streetpick._FINISHING:
            time.sleep(1)
    return {"name": None, "rule": "OpenStreetMap did not answer (try again later)", "complete": False}


def area(folder, cache, key):
    streets = rd(folder, "streets.json", [])
    names = rd(folder, "street_names.json", {})
    pipe = rd(folder, "street_names_pipeline.json", None)
    google = pipe if isinstance(pipe, dict) else {k: v for k, v in names.items() if not str(v).startswith("Unnamed road")}
    reg = Counter(r.get("street") for r in rd(folder, "register_synthetic.json", []) if isinstance(r, dict))
    old = {s["raw"]: s for s in (rd(folder, "street_name_candidates.json", {}) or {}).get("streets", [])}
    out = []
    for st in streets:
        raw = st["name"]
        f2 = old.get(raw, {}).get("f2") if (old.get(raw, {}).get("f2") or {}).get("complete") else None
        f2 = f2 or f2_name(cache, st, key)
        osm = None if str(raw).startswith("(unnamed") else raw
        g = google.get(raw)
        cur = names.get(raw, raw)
        sources = [
            {"source": "osm", "label": "OpenStreetMap", "name": osm, "note": None if osm else "no name on OpenStreetMap"},
            {"source": "google", "label": "Google (pipeline vote)", "name": g,
             "note": "the most common Google route name at the street's camera stops (may be a cross street near junctions)" if g else "no Google name recorded"},
            {"source": "f2", "label": "Street picker rule (F2)", "name": (f2 or {}).get("name"), "note": (f2 or {}).get("rule")},
            {"source": "register", "label": "Register (synthetic)", "name": None,
             "note": f"copies the raw map label '{raw}' ({reg.get(raw, 0)} records): not a name" if reg.get(raw) else "no register record on this street"},
            {"source": "places", "label": "Google Places", "name": None, "note": "no street names stored (only business names and positions)"},
        ]
        distinct = {n for n in (osm, g, (f2 or {}).get("name"), cur) if n and not str(n).startswith("(unnamed")}
        out.append({"raw": raw, "way_ids": st.get("way_ids") or [], "length_m": st.get("length_m"), "current": cur,
                    "default": (f2 or {}).get("name") or cur, "f2": f2, "sources": sources, "mismatch": len(distinct) > 1})
    doc = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "streets": out}
    with open(os.path.join(folder, "street_name_candidates.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    st = Settings()
    cache = os.path.join(st.data_dir, "cache", "streetpick")
    slugs = sys.argv[1:] or sorted(d for d in os.listdir(st.areas_dir) if os.path.isfile(os.path.join(st.areas_dir, d, "streets.json")))
    for slug in slugs:
        rows = area(os.path.join(st.areas_dir, slug), cache, st.google_server_key)
        print(f"\n{slug}")
        for r in rows:
            f2 = r["f2"] or {}
            print(f"  {'≠' if r['mismatch'] else '='} {r['raw']}: current '{r['current']}' | F2 '{f2.get('name')}' ({f2.get('rule')})"
                  + "".join(f" | {s['label']}: {s['name']}" for s in r["sources"][:2]))


if __name__ == "__main__":
    main()
