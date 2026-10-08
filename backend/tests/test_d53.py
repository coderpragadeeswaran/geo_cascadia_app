"""D53: local OpenStreetMap + Microsoft footprints (PostGIS) for the covered cities; the pipeline's map-source hook; the
worker's map source; the 30-day Overpass cache; the "within N m of a possible dark stretch" question."""
import json
import os
import sys
import time

import pytest
import requests

from app import mapdata, spatial, streetpick
from conftest import ROOT

sys.path.insert(0, os.path.join(ROOT, "tools"))

WARD29_TILE = (11.030, 76.975, 11.034, 76.979)           # inside Coimbatore
CHENNAI = (13.05, 80.25, 13.06, 80.26)                    # not covered


@pytest.fixture(scope="module")
def local(online):
    """mapdata on the real database (the session also builds an offline app, which re-points the module)"""
    mapdata.configure(online.app.state.data.pool)
    mapdata._DOWN["until"] = 0
    if not mapdata.cities():
        pytest.skip("no local map data loaded (tools/import_osm_local.py)")
    yield
    mapdata.configure(online.app.state.data.pool)


def q_roads(s, w, n, e):
    return f'[out:json][timeout:25];way["highway"]({s},{w},{n},{e});out geom tags;'


def test_cities_cover_every_analysed_area(local):
    names = {c["city"] for c in mapdata.cities()}
    assert names == {"coimbatore", "trichy", "tiruppur", "madurai"}
    for c in mapdata.cities():
        assert c["osm_snapshot"] and c["ms_release"] and c["counts"]["osm_roads"] > 0
    for slug in os.listdir(os.path.join(ROOT, "data", "areas")):
        with open(os.path.join(ROOT, "data", "areas", slug, "export.json"), encoding="utf-8") as f:
            b = json.load(f)["buildings"]
        if not b:
            continue
        lats, lons = [x["lat"] for x in b], [x["lon"] for x in b]
        assert mapdata.city_for_box(min(lats), min(lons), max(lats), max(lons)), slug


def test_answers_in_overpass_format(local):
    els, src = mapdata.answer(q_roads(*WARD29_TILE))
    assert src["source"] == "local" and src["city"] == "coimbatore"
    assert els and all(e["type"] == "way" and e["tags"]["highway"] and len(e["geometry"]) >= 2 for e in els)
    assert {"lat", "lon"} <= set(els[0]["geometry"][0])
    s, w, n, e = WARD29_TILE
    b, _ = mapdata.answer(f'[out:json][timeout:300];(way["building"]({s},{w},{n},{e});relation["building"]({s},{w},{n},{e}););out geom tags;')
    ways = [x for x in b if x["type"] == "way"]
    assert ways and all(len(x["geometry"]) >= 4 for x in ways)
    for r in (x for x in b if x["type"] == "relation"):          # outer members keep their member index (r<id>_<k>)
        assert any(m.get("role") == "outer" and m.get("geometry") for m in r["members"])
    p, _ = mapdata.answer(f'[out:json][timeout:300];(node["shop"]({s},{w},{n},{e});node["amenity"]({s},{w},{n},{e});'
                          f'node["office"]({s},{w},{n},{e});way["shop"]({s},{w},{n},{e});way["amenity"]({s},{w},{n},{e}););out center tags;')
    assert p and all(("lat" in x) or ("center" in x) for x in p)
    named, _ = mapdata.answer('[out:json][timeout:25];way["highway"]["name"="Sathy Main Road"](around:1500,11.033,76.978);out geom tags;')
    assert named and all(x["tags"]["name"] == "Sathy Main Road" for x in named)
    assert mapdata.answer(q_roads(*CHENNAI)) is None                     # outside every city: Overpass as before
    assert mapdata.answer("[out:json];node(1);out;") is None             # not one of our queries


def test_nearest_road_is_a_postgis_knn(local, tmp_path, monkeypatch):
    """the demo point on Dr Alagesan Road is a junction: two roads are 0 m away. The picker keeps its old rule among
    PostGIS's nearest candidates (ties to the lowest way id, as Overpass's id-ordered answer did), so it resolves the
    named road as before (warm-up cache of 1 Oct: Dr Alagesan Road, way 593359198)."""
    near = mapdata.nearest_roads(11.0228307, 76.9454516, streetpick.ROADS, 60)
    assert near and near[0][1] <= 60 and {593359198, 992434646} <= {i for i, d in near if d < 0.5}
    monkeypatch.setattr(streetpick.requests, "post", lambda *a, **k: pytest.fail("Overpass called"))
    res = streetpick.pick(str(tmp_path), [], 11.0228307, 76.9454516)
    assert res["way_ids"] == [593359198] and res["street"] == "Dr Alagesan Road" and res["source"] == "local"


def test_import_hash_equals_postgis(local, online):
    """the refresh diff compares a local WKB md5 with PostGIS's md5(ST_AsBinary(geom, 'NDR')): they must agree, or a
    refresh would rewrite every row"""
    import import_osm_local as T
    with online.app.state.data.pool.connection() as c:
        rows = c.execute("select ST_AsGeoJSON(geom, 7), md5(ST_AsBinary(geom, 'NDR')) from osm_buildings "
                         "where city = 'coimbatore' order by id limit 200").fetchall()
        roads = c.execute(f"select way_id, highway, name, bridge, tunnel, ST_AsGeoJSON(geom, 7), {T.ROAD_MD5} from osm_roads "
                          "where city = 'trichy' order by way_id limit 200").fetchall()
        ms = c.execute("select ST_AsGeoJSON(geom, 7), md5(ST_AsBinary(geom, 'NDR')) from ms_buildings "
                       "where city = 'madurai' order by id limit 200").fetchall()
    for gj, h in rows + ms:
        assert T.wkb_md5("poly", [(la, lo) for lo, la in json.loads(gj)["coordinates"][0]]) == h
    for wid, hw, name, br, tu, gj, h in roads:
        assert T.road_md5((wid, hw, name, br, tu, [(la, lo) for lo, la in json.loads(gj)["coordinates"]])) == h


def test_pipeline_hook(monkeypatch):
    """area.MAP_SOURCE is asked first; None falls through to the pipeline's own Overpass call / Microsoft tile"""
    import geo_cascadia.area as A
    asked = []

    def src(kind, arg):
        asked.append(kind)
        return [] if kind == "overpass" else [[[76.97, 11.03], [76.9701, 11.03], [76.9701, 11.0301], [76.97, 11.0301], [76.97, 11.03]]]
    monkeypatch.setattr(A, "MAP_SOURCE", src)
    monkeypatch.setattr(A.requests, "post", lambda *a, **k: pytest.fail("Overpass called"))
    monkeypatch.setattr(A.requests, "get", lambda *a, **k: pytest.fail("Microsoft tile downloaded"))
    from shapely.geometry import box
    area = A.Area(box(76.9695, 11.0295, 76.9705, 11.0305), "unused_cache_dir", 40)
    area.load_footprints(ms_fill=True)
    assert asked == ["overpass", "microsoft"] and area.fp_counts == {"osm": 0, "microsoft": 1}
    monkeypatch.setattr(A, "MAP_SOURCE", lambda kind, arg: None)
    calls = []
    monkeypatch.setattr(A.requests, "post", lambda *a, **k: calls.append(1) or (_ for _ in ()).throw(requests.ConnectionError()))
    monkeypatch.setattr(A.time, "sleep", lambda s: None)
    with pytest.raises(RuntimeError, match="Overpass unavailable"):
        A.overpass("[out:json];way(1);out;", os.path.join(ROOT, "data", "cache", "pytest_d53_nocache"), tries=2)
    assert len(calls) == 2


def test_worker_map_source(tmp_path, monkeypatch):
    import types
    src = open(os.path.join(ROOT, "worker", "colab_worker.py"), encoding="utf-8").read()
    for v in ("HOME", "USERPROFILE"):
        monkeypatch.setenv(v, str(tmp_path))
    for v in ("USE_TF", "TRANSFORMERS_NO_TF"):
        monkeypatch.delenv(v, raising=False)
    g = {"__name__": "colab_worker_test"}
    exec(compile(src.rstrip()[:-len("main()")], "colab_worker.py", "exec"), g)       # the cell without its main()
    W = types.SimpleNamespace(**g)
    monkeypatch.setattr(g["time"], "sleep", lambda s: None)

    class Api:
        def __init__(self, answers):
            self.answers = list(answers)

        def call(self, path, body=None, timeout=30):
            assert path == "/worker/mapdata"
            a = self.answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return a
    m = W.MapSource(Api([{"source": "pending", "retry_after_s": 1},
                         {"source": "local", "elements": [1], "city": "coimbatore", "osm_snapshot": "2026-10-02T20:21:34Z", "ms_release": "2026-02-23"},
                         {"source": "local", "rings": [[0]], "city": "coimbatore", "osm_snapshot": "2026-10-02T20:21:34Z", "ms_release": "2026-02-23"}]))
    assert m("overpass", "q") == [1] and m("microsoft", (1, 2, 3, 4)) == [[0]]
    s = m.summary()
    assert s["local"] and s["osm_snapshot"].startswith("2026-10-02") and s["answers"]["overpass"]["app_local"] == 1
    m2 = W.MapSource(Api([requests.ConnectionError(), {"source": "none"}]))
    assert m2("overpass", "q") is None and m2("microsoft", (1, 2, 3, 4)) is None
    assert m2.summary() == {"local": False, "answers": {"overpass": {"worker_direct": 1}, "microsoft": {"worker_direct": 1}}}


def test_worker_mapdata_endpoint(local, online, monkeypatch):
    tok = online.app.state.settings.worker_token
    if not tok:
        pytest.skip("WORKER_TOKEN not set")
    h = {"X-Worker-Token": tok}
    assert online.post("/worker/mapdata", json={"kind": "overpass", "query": q_roads(*WARD29_TILE)}).status_code == 401
    r = online.post("/worker/mapdata", json={"kind": "overpass", "query": q_roads(*WARD29_TILE)}, headers=h).json()
    assert r["source"] == "local" and r["elements"] and r["osm_snapshot"]
    r = online.post("/worker/mapdata", json={"kind": "microsoft", "bbox": [76.968, 11.044, 76.971, 11.049]}, headers=h).json()
    assert r["source"] == "local" and r["rings"]                                    # Bharathiar Road: Microsoft-filled
    assert online.post("/worker/mapdata", json={"kind": "microsoft", "bbox": [80.25, 13.05, 80.26, 13.06]}, headers=h).json() == {"source": "none"}

    def busy(*a, **k):
        raise streetpick.OverpassBusy("busy")
    monkeypatch.setattr(streetpick, "overpass", busy)
    assert online.post("/worker/mapdata", json={"kind": "overpass", "query": q_roads(*CHENNAI)}, headers=h).json() == {"source": "none"}


def test_street_click_without_overpass(local, tmp_path, monkeypatch):
    """inside a covered city a click resolves with every Overpass mirror blocked"""
    monkeypatch.setattr(streetpick.requests, "post", lambda *a, **k: pytest.fail("Overpass called"))
    res = streetpick.pick(str(tmp_path), [], 11.0228307, 76.9454516)
    assert res["source"] == "local" and res["length_m"] > 0 and res["way_ids"]


def test_overpass_cache_expires_after_30_days(tmp_path):
    p = tmp_path / "x.json"
    p.write_text("[1]")
    assert streetpick._read_json(str(p), streetpick.CACHE_TTL_S) == [1]
    old = time.time() - streetpick.CACHE_TTL_S - 60
    os.utime(p, (old, old))
    assert streetpick._read_json(str(p), streetpick.CACHE_TTL_S) is None
    assert streetpick._read_json(str(p)) == [1]                                     # no age limit asked


def test_mapdata_and_hood_lines(local, online):
    st = online.get("/mapdata").json()
    assert st["available"] and len(st["cities"]) == 4 and "OpenStreetMap contributors" in st["attribution"]["osm"]
    h = online.get("/areas/ward29/hood").json()["map_data"]
    assert h["city"]["city"] == "coimbatore" and h["run"]["kind"] == "snapshot"     # D64 re-run: read the app's OSM copy


def test_spatial_phrase():
    assert spatial.extract("Show not-in-register buildings within 50 m of a possible dark stretch")[:2] == \
        ("Show not-in-register buildings", 50)
    assert spatial.extract("buildings near a dark stretch")[1] == spatial.DEFAULT_M
    assert spatial.extract("Streets where no streetlight is detected within 60 m")[1] is None     # the gap question


Q50 = "Show not-in-register buildings within 50 m of a possible dark stretch"


def test_near_dark_question(client):
    """same answer online (PostGIS) and offline (shapely); a subset of the not-in-register buildings"""
    r = client.post("/query", json={"area": "ward29", "text": Q50}).json()
    assert r["parsed_filters"] == {"intent": "buildings", "match_status": "no_record", "near_dark_m": 50}
    assert r["understanding"]["status"] == "ok" and not r["understanding"]["ignored"]
    allnr = client.post("/query", json={"area": "ward29", "text": "Show buildings not in the register"}).json()
    ids = {x["id"] for x in r["rows"]}
    assert r["total"] == len(ids) == r["spatial"]["after"] and ids <= {x["id"] for x in allnr["rows"]}
    assert r["spatial"]["before"] == allnr["total"]
    chips = client.post("/query", json={"area": "ward29", "filters": r["parsed_filters"]}).json()
    assert {x["id"] for x in chips["rows"]} == ids
    wide = client.post("/query", json={"area": "ward29", "filters": {**r["parsed_filters"], "near_dark_m": 500}}).json()
    assert wide["total"] >= r["total"]


def test_near_dark_online_equals_offline(online, offline):
    a = online.post("/query", json={"area": "ward29", "text": Q50}).json()
    b = offline.post("/query", json={"area": "ward29", "text": Q50}).json()
    assert {x["id"] for x in a["rows"]} == {x["id"] for x in b["rows"]}
    assert a["spatial"]["method"].startswith("PostGIS") and not b["spatial"]["method"].startswith("PostGIS")
