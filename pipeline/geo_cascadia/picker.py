"""User selection -> analysis input.
click_to_street(): a map click becomes the OSM street it lands on (by way id, works for unnamed roads too).
The pipeline then runs on WHATEVER street was clicked and reports how much data exists there."""
import math
from collections import defaultdict
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union
from .area import overpass
from .geo import Frame

ROADS = "residential|tertiary|unclassified|secondary|primary|trunk|living_street|road|service"


def click_to_street(lat, lon, cfg, search_m=60, buffer_m=45, max_len_m=1200):
    F = Frame(lat, lon)
    q = f'[out:json][timeout:120];way["highway"~"{ROADS}"](around:{search_m},{lat},{lon});out geom tags;'
    ways = [w for w in overpass(q, f"{cfg.data_dir}/overpass_cache") if "geometry" in w]
    if not ways: raise RuntimeError(f"no road within {search_m} m of the clicked point")
    geom = lambda w: LineString([F.xy(n["lat"], n["lon"]) for n in w["geometry"]])
    hit = min(ways, key=lambda w: geom(w).distance(Point(0, 0)))
    name = hit.get("tags", {}).get("name")
    group = [w for w in ways if name and w.get("tags", {}).get("name") == name] or [hit]
    # extend a named street beyond the search circle
    if name:
        safe = name.replace('\\', '').replace('"', '\\"')
        q2 = f'[out:json][timeout:120];way["highway"]["name"="{safe}"](around:1500,{lat},{lon});out geom tags;'
        group = [w for w in overpass(q2, f"{cfg.data_dir}/overpass_cache") if "geometry" in w] or group
    line = unary_union([geom(w) for w in group]).intersection(Point(0, 0).buffer(max_len_m / 2))   # cap job size
    buf = line.buffer(buffer_m)
    poly = Polygon([F.ll(x, y)[::-1] for x, y in buf.exterior.coords])
    label = name or f"(unnamed {hit.get('tags', {}).get('highway', 'road')} #{hit['id']})"
    return poly, [w["id"] for w in group], {"street": label, "length_m": round(line.length), "osm_ways": len(group)}
