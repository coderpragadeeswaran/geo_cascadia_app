"""Offline data mode (D4): with a bad DATABASE_URL the API serves read-only data from data/areas/*.json,
flags every response with offline=true, refuses writes with 503, and returns the same shapes/values as the DB."""
import pytest
from shapely.geometry import shape

from conftest import AREAS

Q = ["Show commercial buildings with more than two visible floors that do not have a matching property record",
     "Show streets where no streetlight is detected within 60 m",
     "Display only low-confidence floor-count predictions and create a review queue",
     "Chart of unmatched buildings by street"]


def test_offline_mode_serves_json_read_only(offline):
    r = offline.get("/areas")
    assert r.status_code == 200 and r.json()["offline"] is True
    assert {a["slug"] for a in r.json()["areas"]} == set(AREAS)
    w = next(a for a in r.json()["areas"] if a["slug"] == "ward29")
    assert w["counts"]["buildings"] == 381 and w["counts"]["assets_triangulated"] == 20 and w["counts"]["use_not_classified"] == 160
    for path in ("/areas/ward29", "/areas/ward29/geojson", "/areas/ward29/buildings", "/areas/ward29/assets",
                 "/buildings/ward29/w1252504337", "/review?area=ward29", "/jobs", "/config/public", "/model-card"):
        res = offline.get(path)
        assert res.status_code == 200, path
        assert res.json()["offline"] is True, path
    assert offline.post("/query", json={"area": "ward29", "text": Q[0]}).json()["offline"] is True
    # writes are refused with a clear read-only error
    r = offline.patch("/review/1", data={"action": "approve"})
    assert r.status_code == 503 and r.json() == {"detail": "offline data mode — read only", "offline": True}
    r = offline.post("/jobs", json={"polygon": {"type": "Polygon", "coordinates": [[[76.97, 11.03], [76.971, 11.03], [76.971, 11.031], [76.97, 11.03]]]}})
    assert r.status_code == 503 and r.json()["offline"] is True
    assert offline.get("/health").json()["offline"] is True


def _strip(x):
    """Drop values that legitimately differ between modes: DB review ids/timestamps, polygons (compared separately)."""
    if isinstance(x, dict):
        return {k: _strip(v) for k, v in x.items() if k not in ("offline", "id", "updated_at", "polygon", "bbox")
                or (k == "id" and isinstance(v, str))}
    if isinstance(x, list):
        return [_strip(v) for v in x]
    return x


@pytest.mark.parametrize("slug", AREAS)
def test_same_answers_from_db_and_json(online, offline, slug):
    a, b = online.get(f"/areas/{slug}").json(), offline.get(f"/areas/{slug}").json()
    assert a["offline"] is False and b["offline"] is True
    assert _strip(a) == _strip(b)
    pa, pb = shape(a["polygon"]), shape(b["polygon"])
    assert pa.symmetric_difference(pb).area < 1e-9 * max(pa.area, 1e-12) + 1e-12
    assert a["bbox"] == pytest.approx(b["bbox"], abs=1e-6)
    layers = "buildings,assets,gaps,unmapped,missing,streets"
    ga, gb = online.get(f"/areas/{slug}/geojson?layers={layers}").json(), offline.get(f"/areas/{slug}/geojson?layers={layers}").json()
    assert _strip(ga) == _strip(gb) and len(ga["features"]) > 0
    x0, y0, x1, y1 = a["bbox"]
    half = f"{x0},{y0},{(x0 + x1) / 2},{(y0 + y1) / 2}"
    ga = online.get(f"/areas/{slug}/geojson?layers={layers}&bbox={half}").json()       # PostGIS ST_Intersects
    gb = offline.get(f"/areas/{slug}/geojson?layers={layers}&bbox={half}").json()      # shapely
    assert sorted(f["properties"]["id"] for f in ga["features"]) == sorted(f["properties"]["id"] for f in gb["features"])
    for q in Q:
        ra = online.post("/query", json={"area": slug, "text": q}).json()
        rb = offline.post("/query", json={"area": slug, "text": q}).json()
        assert _strip(ra) == _strip(rb), q
    la, lb = online.get(f"/areas/{slug}/buildings?page_size=500").json(), offline.get(f"/areas/{slug}/buildings?page_size=500").json()
    assert _strip(la) == _strip(lb)
    ra, rb = online.get(f"/review?area={slug}&page_size=500").json(), offline.get(f"/review?area={slug}&page_size=500").json()
    assert _strip(ra) == _strip(rb)
