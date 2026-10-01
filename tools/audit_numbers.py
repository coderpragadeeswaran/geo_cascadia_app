r"""audit_numbers.py — P7 R3 (C3): the headline numbers of an area recomputed straight from the database (SQL counts), plus
Gate 1 from data/model_card.json, to compare with what the app shows. Read-only.

    backend\.venv\Scripts\python tools\audit_numbers.py [slug]        (default ward29; prints JSON)
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend")]

from app.db import connect  # noqa: E402

SQL = {
    "buildings": "select count(*) from buildings where area_id = %(a)s",
    "differ_from_register": "select count(*) from buildings where area_id = %(a)s and match_status = 'discrepancy'",
    "not_in_register": "select count(*) from buildings where area_id = %(a)s and match_status = 'no_record'",
    "use_not_known": "select count(*) from buildings where area_id = %(a)s and use is null",
    "names_read_clearly": "select count(*) from buildings where area_id = %(a)s and name_quality = 'good'",
    "review_items": "select count(*) from review_items where area_id = %(a)s",
    "review_waiting": "select count(*) from review_items where area_id = %(a)s and status = 'pending'",
    "dark_stretches": "select count(*) from streetlight_gaps where area_id = %(a)s",
    "poles_and_lights": "select count(*) from assets where area_id = %(a)s",
    "streetlights": "select count(*) from assets where area_id = %(a)s and type = 'streetlight'",
    "poles": "select count(*) from assets where area_id = %(a)s and type = 'pole'",
}


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else "ward29"
    out = {"area": slug}
    with connect() as c:
        a = c.execute("select id from areas where slug = %s", (slug,)).fetchone()
        if not a:
            sys.exit(f"no area {slug!r} in the database")
        for k, q in SQL.items():
            out[k] = c.execute(q, {"a": a[0]}).fetchone()[0]
    with open(os.path.join(ROOT, "data", "model_card.json"), encoding="utf-8") as f:
        g = (json.load(f).get("gate1_position") or {})
    front = (g.get("vs OSM front-wall centre") or {}).get(slug) or {}
    cam = next((v for k, v in front.items() if k.startswith("camera-derived")), None) if isinstance(front, dict) else None
    out["gate1"] = {"status": g.get("status"), "camera_derived": {k: cam.get(k) for k in ("n", "median_m", "p90_m", "within_3_5_m_pct")} if cam else None}
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
