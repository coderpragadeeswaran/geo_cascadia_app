"""Design pass B §7: query UX on the rule-based QueryEngine (no LLM) — synonyms, and the "didn't understand" state
(never a silent wrong answer). docs/QUERY.md lists the rules tested here."""
import pytest

from app import queryparse, views
from app.store import JsonStore
from app.settings import Settings


def q(client, text, area="ward29"):
    r = client.post("/query", json={"area": area, "text": text})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("text,expect,synonym", [
    ("shops with more than 2 storeys not in register",
     {"intent": "buildings", "use": "commercial", "floors_op": ">", "floors_n": 2, "match_status": "no_record"}, "storeys"),
    ("houses with more than two stories", {"intent": "buildings", "use": "residential", "floors_op": ">", "floors_n": 2}, "stories"),
    ("houses with 3+ floors", {"intent": "buildings", "use": "residential", "floors_op": ">=", "floors_n": 3}, "3+ floors"),
    ("buildings with 2 floors", {"intent": "buildings", "floors_op": "==", "floors_n": 2}, "with 2 floors"),
    ("2-storey shops", {"intent": "buildings", "use": "commercial", "floors_op": "==", "floors_n": 2}, "2-storey shops"),
    ("buildings missing from the register", {"intent": "buildings", "match_status": "no_record"}, "missing from the register"),
    ("buildings with a missing record", {"intent": "buildings", "match_status": "no_record"}, "missing record"),
    ("unregistered buildings", {"intent": "buildings", "match_status": "no_record"}, "unregistered"),
    ("buildings that differ from the register", {"intent": "buildings", "match_status": "discrepancy"}, "differ from the register"),
    ("show dark stretches", {"intent": "streetlight_gaps", "interval_m": 60}, "dark stretches"),
    ("street lamps", {"intent": "assets", "asset_type": "streetlight"}, "street lamps"),
    ("stores not in the register for each street", {"intent": "buildings", "use": "commercial", "match_status": "no_record", "group_by": "street"}, "for each street"),
])
def test_synonyms(client, text, expect, synonym):
    r = q(client, text)
    assert r["parsed_filters"] == expect, (text, r["parsed_filters"])
    u = r["understanding"]
    assert u["status"] == "ok" and not u["ignored"], (text, u)
    assert any(s["from"] == synonym for s in u["synonyms"]), (text, u["synonyms"])


def test_spec_queries_fully_understood(client):
    """The four spec questions (§10) parse exactly as before and nothing is reported ignored."""
    for text in ("Show commercial buildings with more than two visible floors that do not have a matching property record",
                 "Show streets where no streetlight is detected within 60 m",
                 "Display only low-confidence floor-count predictions and create a review queue",
                 "Chart of unmatched buildings by street"):
        u = q(client, text)["understanding"]
        assert u["status"] == "ok" and u["ignored"] == [] and u["synonyms"] == [], (text, u)


def test_partly_understood_says_what_was_ignored(client):
    r = q(client, "commercial buildings with 2 storeys in the tax list")
    u = r["understanding"]
    assert u["status"] == "partial"
    assert u["ignored"] == ["tax list"]
    assert [m["meaning"] for m in u["understood"]] == ["shops & businesses", "exactly 2 floors"]
    assert u["suggestions"] and u["suggestions"][0] == views.compose_query(r["parsed_filters"])
    # an unknown street is reported, not dropped silently
    u2 = q(client, "street lamps on MG Road")["understanding"]
    assert u2["status"] == "partial" and u2["ignored"] == ["mg road"]


def test_not_understood(client):
    r = q(client, "trees along the road")
    u = r["understanding"]
    assert u["status"] == "not_understood" and u["understood"] == [] and u["ignored"] == ["trees"]   # "along" is filler (D23)
    assert len(u["suggestions"]) >= 1
    # a floor count with no comparison the rules can read is reported, never answered for all buildings
    u2 = q(client, "buildings with a green roof and 2 floors")["understanding"]
    assert u2["status"] != "ok" and any("2 floors" in x for x in u2["ignored"])


def test_suggestions_and_canonical_text_are_fully_understood():
    """Suggestions and chip-built questions are canonical text: they must read back complete (status ok)."""
    b = JsonStore(Settings().areas_dir).bundle("ward29")
    qe = views.engine(b)
    combos = [f for f, _ in queryparse.TEMPLATES] + [
        {"intent": "buildings", "use": "residential", "floors_op": "<", "floors_n": 3, "match_status": "discrepancy", "street": "Korathottam Road"},
        {"intent": "buildings", "discrepancy": "use_change"}, {"intent": "streetlight_gaps", "interval_m": 60, "street": "Sathy Main Road"},
        {"intent": "assets", "asset_type": "streetlight"}, {"intent": "review"}]
    for f in combos:
        text = views.compose_query(f)
        _, u = queryparse.understand(qe, text, views.compose_query)
        assert u["status"] == "ok", (text, u["ignored"])
