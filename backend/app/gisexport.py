"""GIS export of the area report (extras 1): one GeoJSON file and a zipped Shapefile set, for an area or one street.

The attribute columns and values are the Excel sheets' (report.content builds them once): buildings with findings
(outlines; a point when a building has no outline), every pole and streetlight (points), possible dark stretches (lines,
as the map draws them), review items (points), and our businesses vs OpenStreetMap (points). WGS84 (EPSG:4326), with a
.prj and a .cpg (UTF-8) per layer. Shapefile field names are at most 10 characters, so fields.csv in the zip gives the
key from each short name to the full column name; text longer than 254 characters (the dBASE limit) is cut there and
counted in README.txt. The GeoJSON keeps the full column names and full text. Pure Python: pyshp + shapely.
"""
import csv
import io
import json
import re
import zipfile

from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

WGS84_PRJ = ('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],'
             'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]')
LAYERS = [  # (layer / file name, table key in report.content, geometry kind)
    ("buildings", "buildings", "polygon"),
    ("poles_streetlights", "assets_all", "point"),
    ("dark_stretches", "stretches", "line"),
    ("review_items", "review", "point"),
    ("businesses_vs_osm", "shops", "point"),
]
SHORT = {  # full column name -> Shapefile field name (<= 10 characters, unique per layer)
    "Building ID": "bldg_id", "Street": "street", "Approx. location (lat, lon)": "location", "Use seen": "use_seen",
    "Floors seen": "floors", "Floor-count confidence": "floor_conf", "OSM building:levels (cross-check)": "osm_levels",
    "Sign text": "sign_text", "In OpenStreetMap (shops)": "in_osm", "Confidence": "confidence", "Finding": "finding",
    "Register record (SYNTHETIC)": "reg_synth", "Review status": "review", "Google Maps": "gmaps_url",
    "Asset ID": "asset_id", "What": "what", "Position": "position",
    "#": "rank", "Priority": "priority", "Why (plain words)": "why", "Stretch ID": "stretch_id",
    "Length (m, recorded)": "length_m", "Road type (OSM)": "road_type", "Shops & businesses ≤ 30 m": "shops_30m",
    "Points (length + road + activity = total)": "points", "Poles here": "poles_here",
    "Priority (1 = most urgent)": "priority", "Item": "item", "Why it needs a look": "why", "Status": "status",
    "Result": "result", "Our business (ID)": "our_id", "What we saw": "what_seen", "OpenStreetMap point": "osm_point",
    "OSM name": "osm_name", "OSM kind": "osm_kind", "Distance (m)": "dist_m", "Same name": "same_name",
}
MAX_C = 254


def _short(col, used):
    s = SHORT.get(col) or re.sub(r"[^a-z0-9]+", "_", col.lower()).strip("_")[:10] or "field"
    base, i = s[:10], 1
    while s in used:
        i += 1
        s = f"{base[:10 - len(str(i))]}{i}"
    used.add(s)
    return s


def _ll(text):
    """'11.03159, 76.97443' -> (lat, lon)"""
    la, lo = (float(x) for x in str(text).split(","))
    return la, lo


def features(c, bundle):
    """[(layer, geometry GeoJSON, {column: value}, link)] for every row of the report's tables"""
    B = {b["id"]: b for b in bundle["buildings"]}
    A = {a["id"]: a for a in bundle["assets"]}
    U = {u["id"]: u for u in bundle["unmapped_businesses"]}
    gaps = {g["id"]: g["line"] for g in c["map"]["gaps"]}
    sh = c.get("shops") or {}
    osm_pts = {o["osm_id"]: o for o in (sh.get("osm_only") or [])} | {m["osm"]["osm_id"]: m["osm"] for m in (sh.get("matched") or [])}
    out = []
    for layer, key, kind in LAYERS:
        t = c["tables"][key]
        cols = t["columns"]
        for row, link in zip(t["rows"], t["links"]):
            props = dict(zip(cols, row))
            if link:
                props[cols[-1]] = link                          # the Google Maps column carries the link itself
            geom = None
            if layer == "buildings":
                b = B.get(row[0]) or {}
                ring = (b.get("footprint") or {}).get("polygon_latlon") or []
                geom = ({"type": "Polygon", "coordinates": [[[lo, la] for la, lo in ring] + ([[ring[0][1], ring[0][0]]] if ring[0] != ring[-1] else [])]}
                        if len(ring) >= 3 else {"type": "Point", "coordinates": [b.get("lon"), b.get("lat")]})
            elif layer == "poles_streetlights":
                a = A[row[0]]
                geom = {"type": "Point", "coordinates": [a["lon"], a["lat"]]}
            elif layer == "dark_stretches":
                geom = {"type": "LineString", "coordinates": [list(p) for p in gaps[row[3]]]}
            elif layer == "review_items":
                la, lo = _ll(row[3])
                geom = {"type": "Point", "coordinates": [lo, la]}
            elif layer == "businesses_vs_osm":
                our = B.get(row[1]) or U.get(row[1])
                if our:
                    geom = {"type": "Point", "coordinates": [our["lon"], our["lat"]]}
                else:
                    o = osm_pts[row[4]]
                    geom = {"type": "Point", "coordinates": [o["lon"], o["lat"]]}
            out.append((layer, geom, props))
    return out


def geojson(c, bundle):
    """one FeatureCollection; each feature's `layer` property names its layer (QGIS can split by it)"""
    feats = [{"type": "Feature", "geometry": g, "properties": {"layer": layer, **p}} for layer, g, p in features(c, bundle)]
    doc = {"type": "FeatureCollection", "name": f"geo-cascadia_{c['slug']}" + (f"_{c['street']}" if c["street"] else ""),
           "geo_cascadia": {"title": c["title"], "scope": c["scope"], "made": c["generated"],
                            "register": "SYNTHETIC demo data (made up), not the city's records",
                            "layers": {layer: sum(1 for f in feats if f["properties"]["layer"] == layer) for layer, _, _ in LAYERS},
                            "crs": "WGS84 (EPSG:4326), longitude / latitude",
                            "attribution": "Map data © OpenStreetMap contributors (ODbL). Imagery © Google (not reproduced)."},
           "features": feats}
    return json.dumps(doc, ensure_ascii=False).encode("utf-8")


def shapefile_zip(c, bundle):
    import shapefile                                           # pyshp
    feats = features(c, bundle)
    zbuf = io.BytesIO()
    key_rows, cut = [], {}
    with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
        for layer, tkey, kind in LAYERS:
            t = c["tables"][tkey]
            rows = [(g, p) for la, g, p in feats if la == layer]
            used, names = set(), []
            for col in t["columns"]:
                names.append(_short(col, used))
                key_rows.append([layer, names[-1], col])
            shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
            geoms = {g["type"] for g, _ in rows}
            stype = (shapefile.POLYGON if kind == "polygon" and geoms <= {"Polygon"} else
                     shapefile.POLYLINE if kind == "line" else shapefile.POINT)
            pts_layer = kind == "polygon" and "Point" in geoms        # buildings with no outline: their own point layer
            w = shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=stype, encoding="utf-8")
            wp = None
            if pts_layer:
                pshp, pshx, pdbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
                wp = shapefile.Writer(shp=pshp, shx=pshx, dbf=pdbf, shapeType=shapefile.POINT, encoding="utf-8")
            for wr in [x for x in (w, wp) if x is not None]:
                for col, nm in zip(t["columns"], names):
                    vals = [p.get(col) for _, p in rows]
                    if vals and all(isinstance(v, int) and not isinstance(v, bool) for v in vals if v is not None) \
                            and any(v is not None for v in vals):
                        wr.field(nm, "N", 10, 0)
                    elif vals and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in vals if v is not None) \
                            and any(v is not None for v in vals):
                        wr.field(nm, "F", 12, 2)
                    else:
                        wr.field(nm, "C", MAX_C)
            for g, p in rows:
                rec = []
                for col in t["columns"]:
                    v = p.get(col)
                    if isinstance(v, str) and len(v.encode("utf-8")) > MAX_C:
                        cut[layer] = cut.get(layer, 0) + 1
                        v = v.encode("utf-8")[:MAX_C].decode("utf-8", "ignore")
                    rec.append(v)
                if g["type"] == "Polygon":
                    ring = list(orient(Polygon(g["coordinates"][0]), sign=-1.0).exterior.coords)   # clockwise outer ring
                    w.poly([[list(x) for x in ring]])
                    w.record(*rec)
                elif g["type"] == "LineString":
                    w.line([g["coordinates"]])
                    w.record(*rec)
                elif wp is not None:
                    wp.point(*g["coordinates"])
                    wp.record(*rec)
                else:
                    w.point(*g["coordinates"])
                    w.record(*rec)
            for wr, name, bufs in [(w, layer, (shp, shx, dbf))] + ([(wp, layer + "_points", (pshp, pshx, pdbf))] if wp else []):
                if wr is wp and not any(g["type"] == "Point" for g, _ in rows):
                    continue
                wr.close()
                for ext, b in zip(("shp", "shx", "dbf"), bufs):
                    z.writestr(f"{name}.{ext}", b.getvalue())
                z.writestr(f"{name}.prj", WGS84_PRJ)
                z.writestr(f"{name}.cpg", "UTF-8")
        kb = io.StringIO()
        cw = csv.writer(kb)
        cw.writerow(["layer", "shapefile field", "full column name (as in the Excel sheet)"])
        cw.writerows(key_rows)
        z.writestr("fields.csv", kb.getvalue().encode("utf-8-sig"))
        counts = {layer: sum(1 for la, _, _ in feats if la == layer) for layer, _, _ in LAYERS}
        readme = [f"GEO-CASCADIA GIS export · {c['title']} · {c['scope']} · made {c['generated']}",
                  "Coordinates: WGS84 (EPSG:4326), longitude / latitude. Text encoding: UTF-8 (.cpg).",
                  "The property and asset registers are SYNTHETIC demo data (made up), not the city's records.",
                  "Attribute columns and values are the Excel report's; field names are shortened to 10 characters: "
                  "fields.csv gives the key.", ""]
        readme += [f"{layer}: {n} feature(s)" for layer, n in counts.items()]
        if cut:
            readme += ["", "Text longer than 254 bytes was cut (the Shapefile limit): "
                       + ", ".join(f"{k} {v}" for k, v in cut.items()) + ". The GeoJSON keeps the full text."]
        readme += ["", "Map data © OpenStreetMap contributors (ODbL). Imagery © Google (not reproduced)."]
        z.writestr("README.txt", "\n".join(readme).encode("utf-8"))
    return zbuf.getvalue()


def filename(c, ext):
    from .report import filename as rf
    return rf(c, ext).replace("_report_", "_gis_")
