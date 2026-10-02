"""Imagery age (P8): when the Street View photos behind each finding were taken.

Source: panos.json `date` ("YYYY-MM", Google's capture month from the panorama metadata the pipeline already stored).
Nothing is fetched. A "missing" or "not in the register" finding whose newest photo is more than OLD_MONTHS old is marked
"imagery may be outdated": the street may have changed since (a building added, a light installed or removed).

Which photos count for an object:
- building / pole / streetlight: its own evidence photos (evidence.views, attribute_view, sign_view);
- dark stretch / register entry not seen: the camera stops within NEAR_M of it (they have no photo of their own).
The NEWEST of those decides, so one recent photo is enough to clear the mark.
"""
import datetime as _dt
import math

OLD_MONTHS = 36
NEAR_M = 30.0


def months(d):
    """'2022-11' -> months since year 0 (None when missing or unreadable)"""
    try:
        y, m = str(d)[:7].split("-")
        return int(y) * 12 + int(m) - 1
    except (ValueError, AttributeError):
        return None


def _today_m(today=None):
    t = today or _dt.date.today()
    return t.year * 12 + t.month - 1


def _xy(lat0):
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110540.0
    return lambda la, lo: (lo * kx, la * ky)


def _seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def imagery(bundle, F, today=None):
    panos = F.get("panos") or []
    date = {p["pano_id"]: p.get("date") for p in panos if p.get("pano_id")}
    now = _today_m(today)
    cutoff = now - OLD_MONTHS
    old = lambda d: (months(d) is not None and months(d) < cutoff)
    stops = [e for e in F.get("plan") or [] if e.get("camera_lat") is not None]
    used = [date.get(e["pano_id"]) for e in stops if date.get(e["pano_id"])]
    found = [d for d in date.values() if d]
    by_year = {}
    for d in used:
        by_year[d[:4]] = by_year.get(d[:4], 0) + 1
    summary = {
        "source": "panos.json date (Google's capture month, stored by the pipeline; nothing fetched)",
        "as_of": (today or _dt.date.today()).isoformat()[:7], "old_months": OLD_MONTHS,
        "cutoff": f"{cutoff // 12:04d}-{cutoff % 12 + 1:02d}",
        "camera_stops": len(stops), "camera_stops_dated": len(used),
        "oldest": min(used) if used else None, "newest": max(used) if used else None,
        "older_than_cutoff": sum(old(d) for d in used), "by_year": dict(sorted(by_year.items())),
        "panoramas_found": {"n": len(found), "oldest": min(found) if found else None, "newest": max(found) if found else None},
    }
    objects = {}

    def put(key, ds, finding, photo=None):
        ds = [d for d in ds if d]
        newest = max(ds) if ds else None
        objects[key] = {"date": photo or newest, "newest": newest, "oldest": min(ds) if ds else None,
                        "outdated": bool(finding and newest and old(newest))}

    for b in bundle["buildings"]:
        ev = b.get("evidence") or {}
        pv = [ev.get("attribute_view"), ev.get("sign_view")] + list(ev.get("views") or [])
        ds = [date.get((v or {}).get("pano_id")) for v in pv]
        main = next((date.get(v["pano_id"]) for v in pv if v and date.get(v.get("pano_id"))), None)
        put(f"building:{b['id']}", ds, b.get("match_status") == "no_record", main)
    for a in bundle["assets"]:
        ds = [date.get(v.get("pano_id")) for v in (a.get("evidence") or {}).get("views") or []]
        put(f"asset:{a['id']}", ds, ((a.get("register") or {}).get("status") == "unrecorded_asset"))
    if stops:
        P = _xy(stops[0]["camera_lat"])
        S = [(P(e["camera_lat"], e["camera_lon"]), date.get(e["pano_id"])) for e in stops]
        for g in bundle["streetlight_gaps"]:
            a, b = P(*g["start"]), P(*g["end"])
            put(f"gap:{g['id']}", [d for xy, d in S if _seg_dist(xy, a, b) <= NEAR_M], True)
        for i, m in enumerate(bundle.get("missing_asset_records") or []):
            p = P(m["lat"], m["lon"])
            put(f"missing:{m.get('asset_no') or i}", [d for xy, d in S if math.dist(xy, p) <= NEAR_M], True)
    flagged = {k.split(":")[0]: 0 for k in objects}
    for k, v in objects.items():
        flagged[k.split(":")[0]] += v["outdated"]
    summary["outdated_findings"] = flagged
    return {"summary": summary, "objects": objects}
