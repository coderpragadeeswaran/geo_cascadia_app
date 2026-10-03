"""Area model: OSM roads -> street selection, OSM footprints -> ray-cast (cells 17, 18)."""
import os, io, gzip, csv, time, json, math, pickle, hashlib
from collections import defaultdict
import numpy as np
import requests
from shapely.geometry import LineString, Polygon, MultiPolygon, Point, shape, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree
from .geo import Frame

MIRRORS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter",
           "https://overpass.openstreetmap.ru/api/interpreter"]
# Map-source hook (D53; plumbing only, None = unchanged behaviour). When set, it is asked first:
#   MAP_SOURCE("overpass", query_text) -> the Overpass elements, or None (then Overpass + this module's cache, as before)
#   MAP_SOURCE("microsoft", (min_lon, min_lat, max_lon, max_lat)) -> footprint rings [[lon, lat], ...], or None (then the
#     tile download / cache, as before)
# The app sets it to its PostGIS copy of OpenStreetMap + Microsoft footprints for the covered cities (backend: in-process
# for the cost planner; the Colab worker: through the app's API).
MAP_SOURCE = None

ROAD_TYPES = {"residential", "primary", "secondary", "tertiary", "unclassified", "living_street", "trunk",
              "road", "primary_link", "secondary_link", "tertiary_link"}


def overpass(query, cache_dir, tries=6):
    """Cached Overpass call (same md5 key as the notebook, so Ward 29 reuses the notebook's cache)."""
    if MAP_SOURCE is not None:
        els = MAP_SOURCE("overpass", query)
        if els is not None:
            return els
    os.makedirs(cache_dir, exist_ok=True)
    path = f"{cache_dir}/{hashlib.md5(query.encode()).hexdigest()}.pkl"
    if os.path.exists(path):
        return pickle.load(open(path, "rb"))
    hdr = {"User-Agent": "geo-cascadia/0.1 (research prototype)"}
    for i in range(tries):
        url = MIRRORS[i % len(MIRRORS)]
        try:
            r = requests.post(url, data={"data": query}, headers=hdr, timeout=120)
            if r.status_code == 200 and r.text.lstrip().startswith("{"):
                els = r.json()["elements"]
                pickle.dump(els, open(path, "wb"))
                return els
            time.sleep(min(int(r.headers.get("Retry-After", 5)), 20) if r.status_code == 429 else 3)
        except requests.RequestException:
            time.sleep(3)
    raise RuntimeError("Overpass unavailable on all mirrors — retry in a few minutes")


def lines_of(g):
    parts = g.geoms if hasattr(g, "geoms") else [g]
    return [x for x in parts if x.geom_type == "LineString"]


class Area:
    """Everything spatial about one study area, in a local metre frame centred on the polygon."""

    def __init__(self, polygon_ll, cache_dir, max_range=40.0):
        self.poly_ll = polygon_ll
        self.frame = Frame(polygon_ll.centroid.y, polygon_ll.centroid.x)
        self.cache_dir = cache_dir
        self.max_range = max_range
        self.poly_L = self._poly_to_local(polygon_ll)
        mnx, mny, mxx, mxy = polygon_ll.bounds
        self.bbox = f"{mny},{mnx},{mxy},{mxx}"
        self.footprints, self.fp_ids, self.tree = [], [], None
        self.streets = []

    # ---------- helpers ----------
    def L(self, lat, lon):
        return self.frame.xy(lat, lon)

    def _poly_to_local(self, poly):
        ring = lambda r: [self.L(y, x) for x, y in r.coords]
        if poly.geom_type == "MultiPolygon":
            return MultiPolygon([Polygon(ring(g.exterior), [ring(i) for i in g.interiors]) for g in poly.geoms])
        return Polygon(ring(poly.exterior), [ring(i) for i in poly.interiors])

    # ---------- footprints (cell 18) ----------
    def load_footprints(self, ms_fill=True):
        q = f'[out:json][timeout:300];(way["building"]({self.bbox});relation["building"]({self.bbox}););out geom tags;'
        raw = overpass(q, self.cache_dir)
        polys, ids = [], []
        for e in raw:
            if e["type"] == "way" and e.get("geometry") and len(e["geometry"]) >= 4:
                polys.append(Polygon([self.L(n["lat"], n["lon"]) for n in e["geometry"]])); ids.append(f"w{e['id']}")
            elif e["type"] == "relation":
                for k, m in enumerate(e.get("members", [])):
                    if m.get("role") == "outer" and m.get("geometry") and len(m["geometry"]) >= 4:
                        polys.append(Polygon([self.L(n["lat"], n["lon"]) for n in m["geometry"]]))
                        ids.append(f"r{e['id']}_{k}")
        keep = [i for i, p in enumerate(polys) if p.is_valid and p.area > 5 and self.poly_L.intersects(p)]
        self.footprints = [polys[i] for i in keep]
        self.fp_ids = [ids[i] for i in keep]
        self.fp_source = ["osm"] * len(self.footprints)
        n_osm = len(self.footprints)
        osm_cover = sum(p.intersection(self.poly_L).area for p in self.footprints) / max(self.poly_L.area, 1)
        self.osm_built_frac = round(osm_cover, 3)
        if ms_fill and osm_cover < 0.08:                 # only fill when OSM is clearly sparse here
            try:
                osm_tree = STRtree(self.footprints) if self.footprints else None
                for p in self.ms_footprints():
                    if osm_tree is not None:
                        hit = False
                        for c in osm_tree.query(p):
                            g = self.footprints[int(c)] if isinstance(c, (int, np.integer)) else c
                            if p.intersection(g).area > 0.3 * min(p.area, g.area): hit = True; break
                        if hit: continue
                    la, lo = self.frame.ll(p.centroid.x, p.centroid.y)
                    self.footprints.append(p); self.fp_ids.append(f"ms_{la:.6f}_{lo:.6f}"); self.fp_source.append("microsoft")
            except Exception as ex:
                print(f"[area] Microsoft footprints unavailable ({repr(ex)[:100]}) — OSM only")
        self.idx_of = {f: i for i, f in enumerate(self.fp_ids)}
        self.tree = STRtree(self.footprints) if self.footprints else None
        self.fp_counts = {"osm": n_osm, "microsoft": len(self.footprints) - n_osm}
        return len(self.footprints)

    def ms_footprints(self):
        """Microsoft Global ML Building Footprints for this area (fills OSM gaps). Cached per area."""
        mnx, mny, mxx, mxy = self.poly_ll.bounds
        cdir = f"{os.path.dirname(self.cache_dir)}/ms_cache"; os.makedirs(cdir, exist_ok=True)
        cpath = f"{cdir}/{hashlib.md5(f'{mnx:.5f},{mny:.5f},{mxx:.5f},{mxy:.5f}'.encode()).hexdigest()}.json"
        rings = MAP_SOURCE("microsoft", (mnx, mny, mxx, mxy)) if MAP_SOURCE is not None else None
        if rings is None and os.path.exists(cpath):
            rings = json.load(open(cpath))
        elif rings is None:
            def quadkey(lat, lon, z=9):
                sn = math.sin(math.radians(lat)); x = int(((lon + 180) / 360) * (1 << z))
                y = int((0.5 - math.log((1 + sn) / (1 - sn)) / (4 * math.pi)) * (1 << z)); q = ""
                for i in range(z, 0, -1):
                    d, m = 0, 1 << (i - 1)
                    if x & m: d += 1
                    if y & m: d += 2
                    q += str(d)
                return q
            qks = {quadkey(la, lo) for la in (mny, mxy) for lo in (mnx, mxx)}
            links = requests.get("https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv", timeout=300).text
            rows = [r for r in csv.DictReader(io.StringIO(links)) if r.get("QuadKey") in qks]
            rings = []
            tdir = f"{cdir}/tiles"; os.makedirs(tdir, exist_ok=True)
            for r in rows:
                tpath = f"{tdir}/{r['QuadKey']}_{r['Location']}.csv.gz"
                if not os.path.exists(tpath):
                    open(tpath, "wb").write(requests.get(r["Url"], timeout=1800).content)
                raw = open(tpath, "rb").read()
                for line in io.TextIOWrapper(gzip.GzipFile(fileobj=io.BytesIO(raw)), encoding="utf-8", errors="ignore"):
                    if not line.strip(): continue
                    try: g = json.loads(line).get("geometry", {})
                    except Exception: continue
                    if g.get("type") != "Polygon": continue
                    ring = g["coordinates"][0]
                    lons = [c[0] for c in ring]; lats = [c[1] for c in ring]
                    if max(lons) < mnx or min(lons) > mxx or max(lats) < mny or min(lats) > mxy: continue
                    rings.append(ring)
            json.dump(rings, open(cpath, "w"))
        out = []
        for ring in rings:
            p = Polygon([self.L(c[1], c[0]) for c in ring])
            if p.is_valid and p.area > 5 and self.poly_L.intersects(p): out.append(p)
        return out

    def cast(self, x, y, nx, ny, start_m=2.0, min_hit=1.5):
        """First footprint hit by a ray from (x, y) along (nx, ny) -> (distance, index) or (None, None)."""
        if self.tree is None: return None, None
        ray = LineString([(x + start_m * nx, y + start_m * ny), (x + self.max_range * nx, y + self.max_range * ny)])
        o = Point(x, y); bd = bi = None
        for c in self.tree.query(ray):
            i = int(c) if isinstance(c, (int, np.integer)) else self.footprints.index(c)
            it = ray.intersection(self.footprints[i])
            if it.is_empty: continue
            d = o.distance(it)
            if d < min_hit: continue
            if bd is None or d < bd: bd, bi = d, i
        return bd, bi

    def inside_footprint(self, x, y):
        if self.tree is None: return False
        p = Point(x, y)
        for c in self.tree.query(p):
            g = self.footprints[int(c)] if isinstance(c, (int, np.integer)) else c
            if g.contains(p): return True
        return False

    # ---------- streets (cell 17) ----------
    def load_streets(self, panos, cfg, street_filter=None, way_ids=None):
        roads = overpass(f'[out:json][timeout:300];way["highway"]({self.bbox});out geom tags;', self.cache_dir)
        pois = overpass(f'[out:json][timeout:300];(node["shop"]({self.bbox});node["amenity"]({self.bbox});'
                        f'node["office"]({self.bbox});way["shop"]({self.bbox});way["amenity"]({self.bbox}););out center tags;',
                        self.cache_dir)
        poi_pts = []
        for e in pois:
            la = e.get("lat") or (e.get("center") or {}).get("lat")
            lo = e.get("lon") or (e.get("center") or {}).get("lon")
            if la is None: continue
            p = Point(self.L(la, lo))
            if self.poly_L.contains(p): poi_pts.append(p)
        pano_pts = [Point(self.L(p["camera_lat"], p["camera_lon"])) for p in panos]
        streets = defaultdict(lambda: {"parts": [], "types": set()})
        for w in roads:
            t = w.get("tags", {})
            if t.get("highway") not in ROAD_TYPES or "geometry" not in w: continue
            if t.get("bridge") or t.get("tunnel"): continue
            seg = LineString([self.L(n["lat"], n["lon"]) for n in w["geometry"]]).intersection(self.poly_L)
            if seg.is_empty or seg.length < 5: continue
            name = t.get("name") or f"(unnamed {t['highway']} #{w['id']})"
            streets[name]["parts"].append(seg); streets[name]["types"].add(t["highway"])
            streets[name].setdefault("way_ids", set()).add(w["id"])
        rows = []
        for name, d in streets.items():
            geom = unary_union(d["parts"]); length = geom.length
            if length < 30 and not (way_ids and set(d.get("way_ids", [])) & set(way_ids)): continue
            n_p = sum(1 for p in pano_pts if geom.distance(p) <= 15)
            n_poi = sum(1 for p in poi_pts if geom.distance(p) <= 30)
            kind = "commercial" if (n_poi >= 4 or d["types"] & {"primary", "secondary", "trunk"}) else "residential"
            rows.append({"name": name, "way_ids": sorted(d.get("way_ids", [])), "type": "/".join(sorted(d["types"])), "length_m": round(length),
                         "panos": n_p, "coverage": round(min(1.0, n_p * 20.0 / length), 2),
                         "pois": n_poi, "kind": kind, "geom": geom})
        rows.sort(key=lambda r: -r["length_m"])
        if way_ids:
            sel = [r for r in rows if set(r["way_ids"]) & set(way_ids)]
        elif street_filter:
            sel = [r for r in rows if r["name"] in set(street_filter)]
        else:
            ok = [r for r in rows if r["coverage"] >= cfg.min_street_cover and r["length_m"] >= cfg.min_street_len_m]
            comm = [r for r in ok if r["kind"] == "commercial"]
            res = [r for r in ok if r["kind"] == "residential"]
            sel = comm[:4]
            sel += [r for r in res if r["name"] not in {x["name"] for x in sel}][:cfg.max_streets - len(sel)]
        self.streets = sel
        self.all_street_rows = rows
        return sel

    # ---------- serialisation ----------
    def street_records(self):
        out = []
        for r in self.streets:
            lines = [[list(self.frame.ll(x, y)) for x, y in ln.coords] for ln in lines_of(r["geom"])]
            out.append({k: v for k, v in r.items() if k != "geom"} | {"lines_latlon": lines})
        return out
