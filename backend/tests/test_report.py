"""D54 lighting priority + D55 area report: every number in the report equals what the app shows (the API the app reads),
for Ward 29 and one small area (Vadakku Masi Veethi, a live run in Madurai), for the whole area and for one street.
The PDF's text and the Excel sheets are read back and compared with the same values."""
import io

import pytest

from app import lighting, mapdata, report

AREAS = ["ward29", "vadakku_masi_veethi_f17937"]
STREET = {"ward29": "Sathy Main Road", "vadakku_masi_veethi_f17937": None}


@pytest.fixture(scope="module")
def api(online):
    """the online app with the map data pointed at its own database (the session's offline app re-points the module)"""
    mapdata.configure(online.app.state.data.pool)
    mapdata._DOWN["until"] = 0
    return online


def _content(api, slug, street=None):
    app = api.app
    mapdata.configure(app.state.data.pool)
    mapdata._DOWN["until"] = 0
    s = app.state.data.db
    return report.content(s, s.bundle(slug), app.state.runfiles.get(slug), app.state.model_card.get(),
                          app.state.settings.areas_dir, street=street)


# ------------------------------------------------------------------------------------------------ the priority rule
def test_rule_points_and_levels():
    assert [lighting.length_points(m) for m in (60, 119, 120, 239, 240, 900)] == [1, 1, 2, 2, 3, 3]
    assert [lighting.activity_points(n) for n in (0, 1, 4, 5, 9, 10)] == [0, 1, 1, 2, 2, 3]
    assert [lighting.road_kind(h) for h in ("trunk", "secondary_link", "tertiary", "unclassified", "residential",
                                            "service", None)] == ["main", "main", "connecting", "connecting",
                                                                  "residential", "residential", "unknown"]
    assert [lighting.level(s) for s in (9, 7, 6, 5, 4, 0)] == ["high", "high", "medium", "medium", "low", "low"]
    r = lighting.score_row("g", 140, "primary", 5, 3, 1)
    assert r["reason"] == "140 m on a main road, 9 shops and businesses along it" and r["score"] == 2 + 3 + 2
    assert lighting.score_row("g", 70, None, 0, 0, 0)["reason"] == "70 m on a road of unknown type, no shops or businesses along it"
    assert lighting.score_row("g", 70, "service", 1, 0, 0)["reason"].endswith("1 shop or business along it")


def test_ward29_priority_table(api):
    rows = api.get("/areas/ward29/lighting").json()
    assert rows["available"] and len(rows["rows"]) == 11
    for r in rows["rows"]:
        assert r["score"] == sum(r["points"].values())
        assert r["level"] == lighting.level(r["score"])
        assert r["activity"]["total"] == r["activity"]["buildings"] + r["activity"]["osm_points"] + r["activity"]["sign_businesses"]
    order = [(r["score"], r["length_m"]) for r in rows["rows"]]
    assert order == sorted(order, key=lambda x: (-x[0], -x[1]))
    top = rows["rows"][0]
    assert top["id"] == "gap60-001" and top["road_class"] == "trunk" and top["level"] == "high"
    # the map features and a typed question carry the same priority as the table
    feats = {f["properties"]["id"]: f["properties"] for f in api.get("/areas/ward29/geojson?layers=gaps").json()["features"]}
    for r in rows["rows"]:
        assert (feats[r["id"]]["priority"], feats[r["id"]]["priority_reason"]) == (r["level"], r["reason"])
    q = api.post("/query", json={"area": "ward29", "text": "Show high priority dark stretches"}).json()
    assert q["understanding"]["status"] == "ok" and q["parsed_filters"]["priority"] == "high"
    assert {x["id"] for x in q["rows"]} == {r["id"] for r in rows["rows"] if r["level"] == "high"}
    chips = api.post("/query", json={"area": "ward29", "filters": {"intent": "streetlight_gaps", "interval_m": 60, "priority": "low"}}).json()
    assert chips["total"] == sum(r["level"] == "low" for r in rows["rows"])
    # a building question does not take a priority level: it is reported as ignored, never applied silently
    b = api.post("/query", json={"area": "ward29", "text": "high priority commercial buildings"}).json()
    assert b["understanding"]["status"] == "partial" and "high priority" in b["understanding"]["ignored"]
    # "possible dark stretches" is the app's own wording: nothing ignored
    p = api.post("/query", json={"area": "ward29", "text": "Show possible dark stretches"}).json()
    assert p["understanding"]["status"] == "ok" and p["total"] == 11


def test_priority_offline_is_said_plainly(offline):
    r = offline.get("/areas/ward29/lighting").json()
    assert r["available"] is False and r["note"] == lighting.OFFLINE_NOTE
    q = offline.post("/query", json={"area": "ward29", "text": "Show high priority dark stretches"}).json()
    assert q["total"] is None and q["rows"] == [] and "not available" in q["why_empty"][-1]["step"]


# --------------------------------------------------------------------------------------- report numbers = the app's
@pytest.mark.parametrize("slug", AREAS)
def test_report_numbers_equal_the_app(api, slug):
    c = _content(api, slug)
    area = api.get(f"/areas/{slug}").json()
    kpi = area["dashboard"]["kpi"]
    k = c["kpis"]
    for key in ("buildings_analysed", "unmatched_properties", "buildings_with_discrepancy", "streetlights", "poles",
                "named_businesses", "sign_text_unverified", "names_confirmed_by_google", "low_confidence_observations",
                "unmapped_businesses", "use_not_classified", "waiting_for_review", "streets_covered"):
        assert k[key] == kpi[key], key
    gaps = api.get(f"/areas/{slug}/geojson?layers=gaps").json()["features"]      # the app counts the map's stretches
    assert k["streetlight_gaps"] == len(gaps)
    assert [n["value"] for n in c["numbers"]] == [k[d[0]] for d in report.KPI_DEFS]

    T = c["tables"]
    assert len(T["buildings"]["rows"]) == kpi["unmatched_properties"] + kpi["buildings_with_discrepancy"]
    review = api.get(f"/review?area={slug}").json()
    items = list(range(review["total"]))
    assert len(T["review"]["rows"]) == len(items) == kpi["low_confidence_observations"]
    geo = api.get(f"/areas/{slug}/geojson?layers=assets").json()["features"]
    assert len(T["assets"]["rows"]) == sum(f["properties"]["register_status"] in ("unrecorded_asset", "discrepancy") for f in geo)

    light = api.get(f"/areas/{slug}/lighting").json()["rows"]
    assert [(r[3], r[1], r[2]) for r in T["stretches"]["rows"]] == \
        [(x["id"], report.PRIORITY_WORD[x["level"]], x["reason"]) for x in light]

    hood = api.get(f"/areas/{slug}/hood").json()
    rt = hood["routing"]
    sv, ai = rt["street_view"]["usd"], rt["totals"]["usd"]
    assert report.usd_text(sv + ai) in c["cost"]["line"] and report.usd_text(sv) in c["cost"]["line"]
    assert report.fmt(rt["street_view"]["photos"]) in c["cost"]["line"] and report.usd_text(ai) in c["cost"]["line"]
    im = hood["imagery"]
    assert c["sources"][0][1].startswith(f"taken {report.month_text(im['oldest'])} – {report.month_text(im['newest'])}; "
                                         f"{im['older_than_cutoff']} of {im['camera_stops_dated']}")

    g = api.get("/model-card").json().get("gate1_position") or api.app.state.model_card.get()["gate1_position"]
    assert c["gate1"]["status"] == "Status: Not verified" and c["gate1"]["note"].startswith(g["status_note"])
    fair = next((v for kk, v in (g["vs OSM front-wall centre"].get(slug) or {}).items() if kk.startswith("camera-derived")), None)
    if fair:
        assert f"n = {fair['n']}, median {fair['median_m']} m" in c["gate1"]["row"]
    else:
        assert "not in Trust's Gate 1 table" in c["gate1"]["row"]

    _files_carry_the_same_values(c)


@pytest.mark.parametrize("slug", ["ward29"])
def test_street_report_equals_the_app(api, slug):
    street = STREET[slug]
    c = _content(api, slug, street)
    k = c["kpis"]

    def total(f):
        return api.post("/query", json={"area": slug, "filters": {**f, "street": street}}).json()["total"]
    assert k["buildings_analysed"] == total({"intent": "buildings"})
    assert k["unmatched_properties"] == total({"intent": "buildings", "match_status": "no_record"})
    assert k["buildings_with_discrepancy"] == total({"intent": "buildings", "match_status": "discrepancy"})
    assert k["streetlight_gaps"] == total({"intent": "streetlight_gaps", "interval_m": 60})
    assert k["streetlights"] == total({"intent": "assets", "asset_type": "streetlight"})
    assert k["poles"] == total({"intent": "assets", "asset_type": "pole"})
    assert all(r[2] == street for r in c["tables"]["review"]["rows"])
    assert all(r[1] == street for r in c["tables"]["buildings"]["rows"])
    _files_carry_the_same_values(c)
    assert api.get(f"/areas/{slug}/report.pdf?street=Nowhere Street").status_code == 404


def _files_carry_the_same_values(c):
    import pypdfium2
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(report.xlsx(c)))
    for t in c["tables"].values():
        sh = wb[t["sheet"]]
        got = [[cell.value for cell in row] for row in sh.iter_rows(min_row=1)]
        assert got[0] == t["columns"]
        assert got[1:] == [[v for v in r] for r in t["rows"]]
        for i, link in enumerate(t["links"], start=2):
            assert sh.cell(row=i, column=len(t["columns"])).hyperlink.target == link
    about = {r[0].value: r[1].value for r in wb["About"].iter_rows() if r[0].value}
    for n in c["numbers"]:
        assert about[n["label"]] == n["value"]
    doc = pypdfium2.PdfDocument(report.pdf(c))
    text = "".join(doc[i].get_textpage().get_text_range() for i in range(len(doc))).replace("\r\n", " ").replace("\n", " ")
    flat = " ".join(text.split())
    for n in c["numbers"]:
        assert f"{n['label']} {report.fmt(n['value'])}" in flat or report.fmt(n["value"]) in flat
    for r in c["tables"]["stretches"]["rows"]:
        assert r[3] in flat                                             # every stretch id is in the PDF
    for r in c["tables"]["buildings"]["rows"]:
        assert r[0] in flat
    assert "SYNTHETIC" in flat and "© OpenStreetMap contributors" in flat


def test_report_offline_builds_and_says_so(offline):
    """D4 offline data mode: the report still builds from the JSON copy; priority is said to be unavailable"""
    r = offline.get("/areas/ward29/report.xlsx")
    assert r.status_code == 200
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(r.content))
    rows = list(wb["Possible dark stretches"].iter_rows(min_row=2, values_only=True))
    assert len(rows) == 11 and all(x[1] == "not available" and x[2] == lighting.OFFLINE_NOTE for x in rows)
    assert offline.get("/areas/ward29/report.pdf?street=Sathy Main Road").status_code == 200
