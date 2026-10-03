r"""import_osm_local.py — load OpenStreetMap + Microsoft building footprints for the covered cities into PostGIS (D53).

    backend\.venv\Scripts\python tools\import_osm_local.py                    # load cities not loaded yet
    backend\.venv\Scripts\python tools\import_osm_local.py --refresh          # monthly: replace every city with a new snapshot
    backend\.venv\Scripts\python tools\import_osm_local.py --refresh --cities madurai

Sources (downloaded into data/cache/osm_import/, git-ignored):
- OpenStreetMap: Geofabrik's southern-zone extract of India (~560 MB, one file for all four cities). Its replication
  timestamp is stored as the city's snapshot date.
- Microsoft Global ML Building Footprints: the level-9 tiles (dataset-links.csv) that cover each box. Their upload date is
  stored as the release date.

What is loaded, per city box (tables in backend/migrations/008_local_map_data.sql): every `highway` way (way id, highway,
name, bridge, tunnel, line); every building outline with the pipeline's ids (w<way>, r<relation>_<member index> per outer
member); shop / amenity / office points; Microsoft outlines. A feature that touches the box is kept whole.

Safety: one city per transaction; the database size is printed before and after each city, and the run stops when it
passes --max-db-mb (default 325 MB = 65 % of Supabase's free 500 MB). --refresh deletes a city's rows and loads the new
ones in the same transaction, so a failed refresh leaves the old data in place.
"""
import argparse
import csv
import datetime as dt
import gzip
import io
import json
import math
import os
import sys
import time

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]
from app.db import connect  # noqa: E402

PBF_URL = "https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf"
MS_LINKS = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"
CACHE = os.path.join(ROOT, "data", "cache", "osm_import")
UA = {"User-Agent": "geo-cascadia/0.2 (research prototype; monthly map import)"}
M = 0.005                                    # ~550 m margin around each city boundary
# (south, west, north, east). Boxes are the OSM city boundaries (+ margin); Tiruppur has no city boundary in OSM, so a
# 16 x 16 km box on its city node (owner, D53). Every analysed area and demo street lies inside one of them.
CITIES = {
    "coimbatore": ("Coimbatore", (10.9144 - M, 76.8686 - M, 11.1035 + M, 77.0658 + M),
                   "OSM: the 5 Coimbatore Corporation zone boundaries (relations 7901555, 7901592, 7901728, 7901764, 7901933) + 550 m"),
    "trichy": ("Tiruchirappalli", (10.7273 - M, 78.6461 - M, 10.8458 + M, 78.7427 + M),
               "OSM: city boundary relation 10318360 + 550 m"),
    "tiruppur": ("Tiruppur", (11.1018 - 0.072, 77.3452 - 0.073, 11.1018 + 0.072, 77.3452 + 0.073),
                 "no city boundary in OSM: 16 x 16 km around the city node (11.1018, 77.3452)"),
    "madurai": ("Madurai", (9.8245 - M, 78.0156 - M, 9.9934 + M, 78.2030 + M),
                "OSM: city boundary relation 11268397 + 550 m"),
}
POI_KEYS = ("shop", "amenity", "office")


def mb(n):
    return f"{n / 1e6:.1f} MB"


def download(url, path, timeout=3600):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    t = time.time()
    with requests.get(url, stream=True, timeout=(30, 300), headers=UA) as r:
        r.raise_for_status()
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                if time.time() - t > timeout:
                    raise SystemExit(f"download of {url} took over {timeout} s — stopped")
        os.replace(tmp, path)
    print(f"  downloaded {os.path.basename(path)}: {mb(os.path.getsize(path))} in {time.time() - t:.0f} s")


def city_of(boxes, s, w, n, e):
    for c, (bs, bw, bn, be) in boxes.items():
        if s <= bn and n >= bs and w <= be and e >= bw:
            return c
    return None


def near_any(boxes, la, lo, pad=0.2):
    """cheap first test on a way's first node: a way longer than ~20 km never starts that far from a box here"""
    return any(bs - pad <= la <= bn + pad and bw - pad <= lo <= be + pad for bs, bw, bn, be in boxes.values())


def extract_osm(pbf, boxes):
    """{city: {"roads": [...], "buildings": [...], "pois": [...]}} from the PBF. Pass 1: building relations and their
    outer member ways; pass 2: tagged nodes and ways (locations kept in a disk index); pass 3: the member ways."""
    import osmium
    out = {c: {"roads": [], "buildings": [], "pois": []} for c in boxes}
    t0 = time.time()
    rels = {}
    for o in osmium.FileProcessor(pbf, osmium.osm.RELATION).with_filter(osmium.filter.KeyFilter("building")):
        rels[o.id] = [(k, m.ref) for k, m in enumerate(o.members) if m.type == "w" and m.role == "outer"]
    need = {ref for ms in rels.values() for _, ref in ms}
    print(f"  pass 1: {len(rels):,} building relations, {len(need):,} outer member ways ({time.time() - t0:.0f} s)", flush=True)
    os.makedirs(CACHE, exist_ok=True)
    idx = os.path.join(CACHE, "node_locations.idx")
    if os.path.exists(idx):
        os.remove(idx)

    def pts(nodes):
        try:
            return [(n.lat, n.lon) for n in nodes]
        except osmium.InvalidLocationError:
            return None

    member = {}
    loc = osmium.index.create_map(f"sparse_file_array,{idx}")      # ours, so the file can be closed and deleted after
    fp = (osmium.FileProcessor(pbf, osmium.osm.NODE | osmium.osm.WAY)
          .with_locations(loc)
          .with_filter(osmium.filter.KeyFilter("highway", "building", *POI_KEYS)))
    for o in fp:
        t = o.tags
        if o.is_node():
            if any(k in t for k in POI_KEYS) and o.location.valid():   # highway / building nodes pass the filter too
                la, lo = o.location.lat, o.location.lon
                c = city_of(boxes, la, lo, la, lo)
                if c:
                    out[c]["pois"].append(("n", o.id, la, lo))
            continue
        try:
            first = o.nodes[0].location
            if not first.valid() or not near_any(boxes, first.lat, first.lon):
                continue
        except (IndexError, osmium.InvalidLocationError):
            continue
        g = pts(o.nodes)
        if not g:
            continue
        lats, lons = [p[0] for p in g], [p[1] for p in g]
        c = city_of(boxes, min(lats), min(lons), max(lats), max(lons))
        if not c:
            continue
        hw = t.get("highway")
        if hw and len(g) >= 2:
            out[c]["roads"].append((o.id, hw, t.get("name"), t.get("bridge"), t.get("tunnel"), g))
        if "building" in t and len(g) >= 4:          # the pipeline needs >= 4 nodes for an outline
            out[c]["buildings"].append((f"w{o.id}", g))
        if any(k in t for k in POI_KEYS[:2]):        # the pipeline's shop/amenity ways (as their centre)
            out[c]["pois"].append(("w", o.id, (min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2))
        if o.id in need:
            member[o.id] = g
    print(f"  pass 2: tagged nodes and ways ({time.time() - t0:.0f} s)", flush=True)
    left = need - set(member)
    if left:
        fp = (osmium.FileProcessor(pbf, osmium.osm.NODE | osmium.osm.WAY)
              .with_locations(loc)
              .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
              .with_filter(osmium.filter.IdFilter(left)))
        for o in fp:
            g = pts(o.nodes)
            if g:
                member[o.id] = g
        print(f"  pass 3: {len(left):,} untagged member ways ({time.time() - t0:.0f} s)", flush=True)
    for rid, ms in rels.items():
        for k, ref in ms:
            g = member.get(ref)
            if not g or len(g) < 4:
                continue
            c = city_of(boxes, min(p[0] for p in g), min(p[1] for p in g), max(p[0] for p in g), max(p[1] for p in g))
            if c:
                out[c]["buildings"].append((f"r{rid}_{k}", g))
    return out


def _extract_child(pbf, boxes, result_path):
    import pickle
    with open(result_path, "wb") as f:
        pickle.dump(extract_osm(pbf, boxes), f, protocol=pickle.HIGHEST_PROTOCOL)


def extract_osm_isolated(pbf, boxes):
    """extract_osm in a child process: pyosmium keeps its node-location file (~2.5 GB for southern India) memory-mapped
    until the process ends, so on Windows it can only be deleted once the child has exited."""
    import multiprocessing
    import pickle
    os.makedirs(CACHE, exist_ok=True)
    result = os.path.join(CACHE, "extract.pkl")
    p = multiprocessing.get_context("spawn").Process(target=_extract_child, args=(pbf, boxes, result))
    p.start()
    p.join()
    try:
        if p.exitcode != 0:
            raise SystemExit(f"reading the OpenStreetMap extract failed (exit code {p.exitcode})")
        with open(result, "rb") as f:
            return pickle.load(f)
    finally:
        for f in (result, os.path.join(CACHE, "node_locations.idx")):
            try:
                os.remove(f)
            except OSError:
                pass


def tile_xy(lat, lon, z=9):
    sn = math.sin(math.radians(lat))
    return (int(((lon + 180) / 360) * (1 << z)), int((0.5 - math.log((1 + sn) / (1 - sn)) / (4 * math.pi)) * (1 << z)))


def quadkey(x, y, z=9):
    q = ""
    for i in range(z, 0, -1):
        d, m = 0, 1 << (i - 1)
        d += 1 if x & m else 0
        d += 2 if y & m else 0
        q += str(d)
    return q


def microsoft(boxes, ms_dir, fresh):
    """{city: [ring [(lat, lon), ...]]} and the tiles' upload date. Tiles are the level-9 quadkeys over each box (the
    pipeline's own tiling, area.ms_footprints)."""
    os.makedirs(ms_dir, exist_ok=True)
    links_path = os.path.join(ms_dir, "dataset-links.csv")
    if fresh or not os.path.exists(links_path):
        download(MS_LINKS, links_path, timeout=1800)
    rows = list(csv.DictReader(open(links_path, encoding="utf-8")))
    out, dates = {c: [] for c in boxes}, set()
    want = {}
    for c, (s, w, n, e) in boxes.items():
        x0, y1 = tile_xy(s, w)
        x1, y0 = tile_xy(n, e)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                want[quadkey(x, y)] = True
    for r in rows:
        if r["QuadKey"] not in want:
            continue
        path = os.path.join(ms_dir, f"{r['QuadKey']}_{r['Location']}.csv.gz")
        if fresh or not os.path.exists(path):
            download(r["Url"], path)
        dates.add(r.get("UploadDate"))
        with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    g = json.loads(line).get("geometry", {})
                except ValueError:
                    continue
                if g.get("type") != "Polygon":
                    continue
                ring = [(p[1], p[0]) for p in g["coordinates"][0]]
                if len(ring) < 4:
                    continue
                c = city_of(boxes, min(p[0] for p in ring), min(p[1] for p in ring), max(p[0] for p in ring), max(p[1] for p in ring))
                if c:
                    out[c].append(ring)
    release = max(d for d in dates if d) if any(dates) else None
    return out, release


def ewkt_line(g):
    return "SRID=4326;LINESTRING(" + ",".join(f"{lo:.7f} {la:.7f}" for la, lo in g) + ")"


def ewkt_poly(g):
    if g[0] != g[-1]:
        g = list(g) + [g[0]]
    return "SRID=4326;POLYGON((" + ",".join(f"{lo:.7f} {la:.7f}" for la, lo in g) + "))"


def db_size(c):
    return c.execute("select pg_database_size(current_database())").fetchone()[0]


def copy(c, sql, rows, batch=20000):
    for i in range(0, len(rows), batch):
        with c.cursor().copy(sql) as cp:
            for r in rows[i:i + batch]:
                cp.write_row(r)


def _r7(v):
    return float(f"{v:.7f}")                 # the value PostGIS stores after parsing the 7-decimal text


def wkb_md5(kind, g):
    """md5 of the geometry's little-endian WKB exactly as PostGIS will hold it (ST_AsBinary(geom, 'NDR')), so a refresh
    can tell unchanged rows from changed ones without downloading geometries"""
    import hashlib
    import struct
    pts = [(_r7(lo), _r7(la)) for la, lo in g]
    if kind == "point":
        b = struct.pack("<BIdd", 1, 1, *pts[0])
    elif kind == "line":
        b = struct.pack("<BII", 1, 2, len(pts)) + b"".join(struct.pack("<dd", *p) for p in pts)
    else:
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        b = struct.pack("<BIII", 1, 3, 1, len(pts)) + b"".join(struct.pack("<dd", *p) for p in pts)
    return hashlib.md5(b).hexdigest()


GEOM_MD5 = "md5(ST_AsBinary(geom, 'NDR'))"
# roads: a renamed or re-classified road is a changed row too
ROAD_MD5 = (f"md5({GEOM_MD5} || '|' || highway || '|' || coalesce(name, '') || '|' || coalesce(bridge, '') || '|' "
            "|| coalesce(tunnel, ''))")


def road_md5(r):
    import hashlib
    return hashlib.md5(f"{wkb_md5('line', r[5])}|{r[1]}|{r[2] or ''}|{r[3] or ''}|{r[4] or ''}".encode()).hexdigest()


def sync(c, table, key_cols, city, new, copy_sql, hash_sql=GEOM_MD5):
    """Make the city's rows of `table` equal `new` ({key: (row, md5)}): delete rows that vanished or changed, insert new
    or changed ones; unchanged rows are not touched (a monthly refresh rewrites only what OSM changed, so the tables do
    not grow by a whole city's size). Returns (inserted, deleted, unchanged)."""
    keys = ", ".join(key_cols)
    have = {}
    for r in c.execute(f"select {keys}, {hash_sql} from {table} where city = %s", (city,)):
        have[tuple(r[:-1]) if len(key_cols) > 1 else r[0]] = r[-1]
    gone = [k for k, h in have.items() if k not in new or new[k][1] != h]
    add = [row for k, (row, h) in new.items() if have.get(k) != h]
    if gone:
        if len(key_cols) == 1:
            for i in range(0, len(gone), 5000):
                c.execute(f"delete from {table} where city = %s and {keys} = any(%s)", (city, gone[i:i + 5000]))
        else:
            for i in range(0, len(gone), 5000):
                part = gone[i:i + 5000]
                c.execute(f"delete from {table} where city = %s and ({keys}) in (select * from unnest(%s::text[], %s::bigint[]))",
                          (city, [k[0] for k in part], [k[1] for k in part]))
    copy(c, copy_sql, add)
    return len(add), len(gone), len(new) - len(add)


def load_city(c, city, osm, ms, snapshot, release):
    """One transaction per city (a failure leaves the city as it was)."""
    name, (s, w, n, e), src = CITIES[city]
    roads = {r[0]: ((r[0], city, r[1], r[2], r[3], r[4], ewkt_line(r[5])), road_md5(r)) for r in osm["roads"]}
    bld = {}
    for bid, g in osm["buildings"]:
        bld.setdefault(bid, ((bid, city, ewkt_poly(g)), wkb_md5("poly", g)))
    pois = {(t, i): ((t, i, city, f"SRID=4326;POINT({lo:.7f} {la:.7f})"), wkb_md5("point", [(la, lo)]))
            for t, i, la, lo in osm["pois"]}
    # Microsoft outlines have no stable id: the geometry itself is the key (md5 of its WKB, numbered if repeated)
    msr, seen = {}, {}
    for g in ms:
        h = wkb_md5("poly", g)
        seen[h] = seen.get(h, 0) + 1
        msr[(h, seen[h])] = ((city, ewkt_poly(g)), h)
    with c.transaction():
        c.execute("set local statement_timeout = 0")
        stats = {
            "osm_roads": sync(c, "osm_roads", ["way_id"], city, roads,
                              "copy osm_roads (way_id, city, highway, name, bridge, tunnel, geom) from stdin", ROAD_MD5),
            "osm_buildings": sync(c, "osm_buildings", ["id"], city, bld, "copy osm_buildings (id, city, geom) from stdin"),
            "osm_pois": sync(c, "osm_pois", ["osm_type", "osm_id"], city, pois,
                             "copy osm_pois (osm_type, osm_id, city, geom) from stdin"),
        }
        # ms_buildings rows are keyed by geometry: delete the ids whose (md5, n) is not in the new set
        have = {}
        for i, h in c.execute("select id, md5(ST_AsBinary(geom, 'NDR')) from ms_buildings where city = %s order by id", (city,)):
            have.setdefault(h, []).append(i)
        old = {(h, k + 1): i for h, ids in have.items() for k, i in enumerate(ids)}
        gone = [i for key, i in old.items() if key not in msr]
        add = [row for key, (row, _) in msr.items() if key not in old]
        for i in range(0, len(gone), 5000):
            c.execute("delete from ms_buildings where id = any(%s)", (gone[i:i + 5000],))
        copy(c, "copy ms_buildings (city, geom) from stdin", add)
        stats["ms_buildings"] = (len(add), len(gone), len(msr) - len(add))
        counts = {"osm_roads": len(roads), "osm_buildings": len(bld), "osm_pois": len(pois), "ms_buildings": len(msr)}
        c.execute("""insert into map_cities (city, name, box, box_source, osm_snapshot, ms_release, counts, loaded_at)
                     values (%s, %s, ST_MakeEnvelope(%s, %s, %s, %s, 4326), %s, %s, %s, %s, now())
                     on conflict (city) do update set name = excluded.name, box = excluded.box, box_source = excluded.box_source,
                       osm_snapshot = excluded.osm_snapshot, ms_release = excluded.ms_release, counts = excluded.counts,
                       loaded_at = now()""",
                  (city, name, w, s, e, n, src, snapshot, release, json.dumps(counts)))
    return counts, stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cities", default="all", help="comma list of " + ", ".join(CITIES) + " (default all)")
    ap.add_argument("--refresh", action="store_true", help="download a new snapshot and replace the cities' rows")
    ap.add_argument("--pbf", help="use this .osm.pbf instead of downloading (must cover the cities)")
    ap.add_argument("--ms-dir", help="folder with dataset-links.csv and <quadkey>_India.csv.gz tiles (reused if present)")
    ap.add_argument("--max-db-mb", type=float, default=325, help="stop when the database passes this size (default 325 = 65%% of 500 MB)")
    ap.add_argument("--keep", action="store_true", help="keep the downloaded files in data/cache/osm_import/")
    a = ap.parse_args()
    cities = list(CITIES) if a.cities == "all" else [x.strip() for x in a.cities.split(",")]
    bad = [x for x in cities if x not in CITIES]
    if bad:
        raise SystemExit(f"unknown city {bad}; known: {', '.join(CITIES)}")
    c = connect()
    c.autocommit = True
    loaded = {r[0] for r in c.execute("select city from map_cities")}
    todo = [x for x in cities if a.refresh or x not in loaded]
    print(f"database size before: {mb(db_size(c))} (limit for this run {a.max_db_mb:.0f} MB)")
    if not todo:
        print("every city is loaded already; use --refresh to replace them with a new snapshot")
        return
    boxes = {x: CITIES[x][1] for x in todo}
    pbf = a.pbf or os.path.join(CACHE, "southern-zone-latest.osm.pbf")
    if not a.pbf and (a.refresh or not os.path.exists(pbf)):
        print("downloading the OpenStreetMap extract (Geofabrik, ~560 MB)…")
        download(PBF_URL, pbf)
    import osmium
    hdr = osmium.io.Reader(pbf, osmium.osm.NOTHING).header()
    snapshot = hdr.get("osmosis_replication_timestamp") or None
    print(f"OpenStreetMap snapshot: {snapshot}")
    print("reading roads, buildings and shops for", ", ".join(todo), "…")
    osm = extract_osm_isolated(pbf, boxes)
    print("reading Microsoft building footprints…")
    ms, release = microsoft(boxes, a.ms_dir or os.path.join(CACHE, "microsoft"), fresh=a.refresh and not a.ms_dir)
    print(f"Microsoft release: {release}")
    for city in todo:
        before = db_size(c)
        t = time.time()
        counts, stats = load_city(c, city, osm[city], ms[city], snapshot, release)
        for tb in ("osm_roads", "osm_buildings", "osm_pois", "ms_buildings", "map_cities"):
            c.execute(f"analyze {tb}")
        after = db_size(c)
        print(f"{city}: rows {counts}; changes (inserted, deleted, unchanged) {stats}")
        print(f"{city}: {time.time() - t:.0f} s — database {mb(before)} -> {mb(after)} "
              f"({100 * after / 500e6:.1f}% of 500 MB)", flush=True)
        if after > a.max_db_mb * 1e6:
            rest = todo[todo.index(city) + 1:]
            raise SystemExit(f"STOP: the database is {mb(after)}, above the {a.max_db_mb:.0f} MB limit. "
                             f"Not loaded: {', '.join(rest) or 'nothing left'}.")
    print(f"database size after: {mb(db_size(c))}")
    if not a.keep and not a.pbf:
        try:
            os.remove(pbf)
        except OSError:
            pass


if __name__ == "__main__":
    main()
