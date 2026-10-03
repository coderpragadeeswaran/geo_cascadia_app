"""Downloadable area report (D55): a PDF summary for officials and an Excel workbook, for an area or one street.

`content()` builds every number and table ONCE, from the same records and functions the app uses (the KPI formulas of
web/src/lib/derive.ts `kpis`, the app's plain labels from web/src/lib/labels.ts, the lighting priority of D54, Under
the Hood's routing and photo dates, Trust's Gate 1 wording and model-card numbers). `pdf()` and `xlsx()` only render
that content, so the two files carry the same columns and values. tests/test_report.py checks the numbers against the
API for Ward 29 and one small area.

No Google content is embedded: the map is drawn from our own data (OpenStreetMap roads from the app's copy, building
outlines, dark stretches) with "© OpenStreetMap contributors"; each row links to a normal Google Maps URL instead of an
image. Pure-Python libraries only (fpdf2, openpyxl, fontTools via fpdf2; uharfbuzz for Tamil text shaping).
"""
import datetime as _dt
import io
import math
import os

from . import lighting, mapdata
from .hood import hood as hood_view
from .imagery import imagery as imagery_view

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "report_fonts")
LAMP_KEY = "lamp_head"
FOOTER = ("Registers are synthetic demo data. Prototype — imagery © Google (not reproduced here). "
          "Map data © OpenStreetMap contributors (ODbL).")


# ------------------------------------------------------------------------------------- the app's formatting and labels
def fmt(n):
    """Intl.NumberFormat('en-IN') for integers: 1,420 · 1,23,456"""
    if n is None:
        return "—"
    n = int(round(n))
    s, neg = str(abs(n)), n < 0
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups + [tail])
    return ("-" if neg else "") + s


PLURALS = {"stretch": "stretches", "possible dark stretch": "possible dark stretches", "business": "businesses",
           "shop or business": "shops & businesses"}


def noun(n, one, many=None):
    return one if n == 1 else many or PLURALS.get(one) or one + "s"


def plural(n, one, many=None):
    return f"{fmt(n)} {noun(n, one, many)}"


def usd(v, digits=4):
    """lib/utils.ts usd()"""
    if v is None:
        return "—"
    step = 10 ** -digits
    if 0 < v < step / 2:
        return f"< ${step:.{digits}f}"
    return f"${v:.{digits}f}"


def usd_text(v):
    """Hood's usdText: 2 decimals from $1, 4 under 1 cent, else 3"""
    return "—" if v is None else usd(v, 2 if v >= 1 else 4 if v < 0.01 else 3)


MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def month_text(ym):
    if not ym:
        return "—"
    y, m = ym[:7].split("-")
    return f"{MONTHS[int(m) - 1]} {y}"


def day_text(iso):
    if not iso:
        return "date not recorded"
    d = _dt.date.fromisoformat(iso[:10])
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


MATCH = {"matched": "Matches the register", "discrepancy": "Differs from the register", "no_record": "Not in the register"}
MATCHED_USE_UNKNOWN = "Register entry exists — use not compared"
ASSET_REG = {"matched": "In the register", "discrepancy": "Differs from the register", "unrecorded_asset": "Not in the register",
             "unconfirmed_detection": "Seen in one photo only: needs a second look"}
DIFF = {"extra_floor": "more floors than recorded", "use_change": "used differently than recorded",
        "location_shift": "record pinned in the wrong place", "area_understated": "bigger than recorded",
        "missing_record": "no register record", "type_mismatch": "recorded as a different type"}
GAP_TYPE = {"poles present, no lamp detected": "poles, but no streetlight seen",
            "no pole or lamp detected": "no pole or streetlight seen"}
REVIEW = {"pending": "Waiting for review", "approved": "Approved", "rejected": "Rejected", "appealed": "Appealed"}
REASON_DIFF = {"missing_record": "Not in the register", "extra_floor": "Extra floor vs register",
               "use_change": "Use differs from register", "location_shift": "Register pin in the wrong place",
               "area_understated": "Bigger than recorded", "type_mismatch": "Recorded as a different type"}
PRIORITY_WORD = {"high": "High", "medium": "Medium", "low": "Low"}
ROAD_KIND_WORD = {"main": "main road", "connecting": "connecting road", "residential": "residential street",
                  "unknown": "not known"}


def pretty(s):
    return s.replace("_", " ") if s else "—"


def use_label(u):
    if not u:
        return "Use not known"
    return {"mixed": "Shop + home", "other": "Other", "under_construction": "Under construction"}.get(u, u[:1].upper() + u[1:])


def floors_text(n, status=None):
    if n is None:
        return "Floors not known"
    return f"{plural(n, 'floor')}{' (estimate)' if status == 'low_confidence' else ''}"


def match_label(s, use_known=True):
    if s == "matched" and not use_known:
        return MATCHED_USE_UNKNOWN
    return MATCH.get(s, pretty(s))


def review_reasons(reasons, finding=None):
    """lib/labels.ts reviewReasons"""
    import re
    finding = finding or {}
    diffs = [d for d in finding.get("discrepancies") or [] if d != "missing_record"]
    out = []

    def add(s):
        if s and s not in out:
            out.append(s)
    for r in reasons or []:
        if r == "high-severity discrepancy":
            if finding.get("match_status") == "no_record":
                add(REASON_DIFF["missing_record"])
            elif diffs:
                for d in diffs:
                    add(REASON_DIFF.get(d, pretty(d)))
            else:
                add("Differs from the register")
        elif re.match(r"^attribute discrepancy", r):
            a = [d for d in diffs if d in ("extra_floor", "use_change")]
            if a:
                for d in a:
                    add(REASON_DIFF[d])
            elif finding.get("match_status") == "no_record":
                add(REASON_DIFF["missing_record"])
            else:
                add("Differs from the register")
        elif r == "single-detection asset":
            add("Seen in one photo only")
        elif r == "building seen from one view only":
            add("Seen from one camera position only")
        elif re.match(r"^floor count low confidence", r):
            add("Floor count is an estimate (roof not visible)")
        elif re.match(r"^name read by VLM only", r):
            add("Shop name read by the AI model only")
        else:
            add(r[:1].upper() + re.sub(r"\s*[—–�-]\s*verify on imagery", "", r[1:]))
    return out


def maps_url(lat, lon):
    return f"https://www.google.com/maps/search/?api=1&query={lat:.6f},{lon:.6f}"


def loc(lat, lon):
    return f"{lat:.5f}, {lon:.5f}"


# ------------------------------------------------------------------------------------------------------- key numbers
KPI_DEFS = [  # web/src/lib/derive.ts KPI_DEFS: (key, label, singular label), the five main numbers first
    ("buildings_analysed", "Buildings checked", "Building checked"),
    ("unmatched_properties", "Not in register", None),
    ("buildings_with_discrepancy", "Differ from register", "Differs from register"),
    ("streetlight_gaps", "Possible dark stretches", "Possible dark stretch"),
    ("use_not_classified", "Use not known", None),
    ("streetlights", "Streetlights", "Streetlight"),
    ("poles", "Poles, no lamp seen", "Pole, no lamp seen"),
    ("named_businesses", "Shop names read clearly", "Shop name read clearly"),
    ("names_confirmed_by_google", "Also on Google Maps", None),
    ("sign_text_unverified", "Signs to double-check", "Sign to double-check"),
    ("waiting_for_review", "Waiting for review", None),
    ("unmapped_businesses", "Businesses with no analysed building", "Business with no analysed building"),
    ("streets_covered", "Streets", "Street"),
]
MAIN_KPIS = 5


def kpis(bundle, street=None):
    """derive.ts kpis(): the same formulas, optionally for one street"""
    on = lambda s: not street or s == street
    B = [b for b in bundle["buildings"] if on(b.get("street"))]
    A = [a for a in bundle["assets"] if on(a.get("street"))]
    nm = lambda b: ((b.get("attributes") or {}).get("name") or {})
    use = lambda b: ((b.get("attributes") or {}).get("use") or {}).get("value")
    R = [q for q in bundle["review_queue"] if on(q.get("street"))]
    return {
        "streets_covered": len({b.get("street") for b in B}),
        "buildings_analysed": len(B),
        "unmatched_properties": sum(b.get("match_status") == "no_record" for b in B),
        "buildings_with_discrepancy": sum(b.get("match_status") == "discrepancy" for b in B),
        "use_not_classified": sum(use(b) is None for b in B),
        "streetlights": sum(a.get("type") == "streetlight" for a in A),
        "poles": sum(a.get("type") == "pole" for a in A),
        "assets_triangulated": sum(a.get("method") == "triangulated" for a in A),
        "assets": len(A),
        "streetlight_gaps": sum(on(g.get("street")) for g in bundle["streetlight_gaps"]),
        "named_businesses": sum(nm(b).get("quality") == "good" for b in B),
        "sign_text_unverified": sum(nm(b).get("quality") in ("tamil_unverified", "fragment") for b in B),
        "names_confirmed_by_google": sum(bool(nm(b).get("google_confirmed")) for b in B),
        "low_confidence_observations": len(R),
        "waiting_for_review": sum(q.get("status") == "pending" for q in R),
        "unmapped_businesses": sum(on(u.get("street")) for u in bundle["unmapped_businesses"]),
    }


# ------------------------------------------------------------------------------------------------------------ tables
BUILDING_COLS = ["Building ID", "Street", "Approx. location (lat, lon)", "Use seen", "Floors seen", "Sign text",
                 "Confidence", "Finding", "Register record (SYNTHETIC)", "Review status", "Google Maps"]
ASSET_COLS = ["Asset ID", "What", "Street", "Approx. location (lat, lon)", "Position", "Finding",
              "Register record (SYNTHETIC)", "Review status", "Google Maps"]
STRETCH_COLS = ["#", "Priority", "Why (plain words)", "Stretch ID", "Street", "Length (m, recorded)", "Road type (OSM)",
                "Shops & businesses ≤ 30 m", "Points (length + road + activity = total)", "Poles here", "Google Maps"]
REVIEW_COLS = ["Priority (1 = most urgent)", "Item", "Street", "Approx. location (lat, lon)", "Why it needs a look",
               "Status", "Google Maps"]


def _building_rows(bundle, street):
    rank = {"no_record": 0, "discrepancy": 1}
    B = [b for b in bundle["buildings"] if b.get("match_status") in rank and (not street or b.get("street") == street)]
    B.sort(key=lambda b: (rank[b["match_status"]], b.get("street") or "", b["id"]))
    rows, links = [], []
    for b in B:
        at = b.get("attributes") or {}
        use, fl, nm = at.get("use") or {}, at.get("floors") or {}, at.get("name") or {}
        sv = (b.get("evidence") or {}).get("sign_view") or {}
        sign = nm.get("value") or sv.get("ocr_text") or "—"
        if nm.get("value") and nm.get("quality") and nm.get("quality") != "good":
            sign += {"fragment": " (partly readable)", "tamil_unverified": " (Tamil, not confirmed)"}.get(nm["quality"], "")
        reg = b.get("register") or {}
        conf = [{"measured": "floors measured", "low_confidence": "floors an estimate"}.get(fl.get("status"), "floors not measured")]
        if reg.get("match_confidence"):
            conf.append(f"register pairing {reg['match_confidence']}")
        finding = match_label(b["match_status"], bool(use.get("value")))
        diffs = [DIFF.get(d, pretty(d)) for d in b.get("discrepancies") or [] if d != "missing_record"]
        if diffs:
            finding += ": " + "; ".join(diffs)
        if reg.get("property_id"):
            parts = [str(reg["property_id"]), use_label(reg.get("record_use")) if reg.get("record_use") else "use not recorded",
                     floors_text(reg.get("record_floors")) if reg.get("record_floors") is not None else "floors not recorded"]
            if reg.get("record_area_m2") is not None:
                parts.append(f"{fmt(reg['record_area_m2'])} m²")
            if reg.get("record_dist_m") is not None:
                parts.append(f"pin {fmt(reg['record_dist_m'])} m away")
            record = " · ".join(parts)
        else:
            record = "No record"
        rows.append([b["id"], b.get("street") or "—", loc(b["lat"], b["lon"]), use_label(use.get("value")),
                     floors_text(fl.get("value"), fl.get("status")), sign, " · ".join(conf), finding, record,
                     REVIEW.get((b.get("review") or {}).get("status"), "Not queued"), "View in Google Maps"])
        links.append(maps_url(b["lat"], b["lon"]))
    return rows, links


def _asset_rows(bundle, street):
    keep = ("unrecorded_asset", "discrepancy")
    A = [a for a in bundle["assets"] if (a.get("register") or {}).get("status") in keep and (not street or a.get("street") == street)]
    A.sort(key=lambda a: (keep.index(a["register"]["status"]), a.get("street") or "", a["id"]))
    rows, links = [], []
    for a in A:
        reg = a.get("register") or {}
        pos = ("pinpointed from " + plural(a.get("cameras_used") or 0, "camera position") if a.get("method") == "triangulated"
               else f"approximate (±{a.get('uncertainty_m'):g} m)" if a.get("uncertainty_m") is not None else "approximate")
        finding = ASSET_REG.get(reg.get("status"), pretty(reg.get("status")))
        if reg.get("flags"):
            finding += ": " + "; ".join(DIFF.get(f, pretty(f)) for f in reg["flags"])
        record = " · ".join(x for x in (reg.get("asset_no"), pretty(reg.get("record_type")) if reg.get("record_type") else None) if x) \
            or "No record"
        rows.append([a["id"], "Streetlight" if a.get("type") == "streetlight" else "Pole, no lamp seen", a.get("street") or "—",
                     loc(a["lat"], a["lon"]), pos, finding, record,
                     REVIEW.get((a.get("review") or {}).get("status"), "Not queued"), "View in Google Maps"])
        links.append(maps_url(a["lat"], a["lon"]))
    return rows, links


def _stretch_rows(bundle, street, prio):
    gaps = {g["id"]: g for g in bundle["streetlight_gaps"] if not street or g.get("street") == street}
    if prio["available"]:
        order = [r["id"] for r in lighting.order([r for r in prio["rows"].values() if r["id"] in gaps])]
    else:
        order = [g["id"] for g in sorted(gaps.values(), key=lambda g: (-g["length_m"], g["id"]))]
    rows, links = [], []
    for i, gid in enumerate(order, 1):
        g, p = gaps[gid], prio["rows"].get(gid) if prio["available"] else None
        mid = ((g["start"][0] + g["end"][0]) / 2, (g["start"][1] + g["end"][1]) / 2)
        if p:
            pts = p["points"]
            road = ROAD_KIND_WORD[p["road_kind"]] + (f" ({p['road_class']})" if p["road_class"] else "")
            rows.append([i, PRIORITY_WORD[p["level"]], p["reason"], gid, g.get("street") or "—", fmt(g["length_m"]), road,
                         fmt(p["activity"]["total"]), f"{pts['length']} + {pts['road']} + {pts['activity']} = {p['score']}",
                         GAP_TYPE.get(g.get("gap_type"), g.get("gap_type") or "—"), "View in Google Maps"])
        else:
            rows.append([i, "not available", lighting.OFFLINE_NOTE, gid, g.get("street") or "—", fmt(g["length_m"]), "—", "—", "—",
                         GAP_TYPE.get(g.get("gap_type"), g.get("gap_type") or "—"), "View in Google Maps"])
        links.append(maps_url(*mid))
    return rows, links


def _review_rows(bundle, street):
    B = {b["id"]: b for b in bundle["buildings"]}
    A = {a["id"]: a for a in bundle["assets"]}
    Q = [q for q in bundle["review_queue"] if not street or q.get("street") == street]
    Q = sorted(Q, key=lambda q: (q.get("priority") or 9, q.get("street") or "", str(q.get("ref_id") or q.get("building_id") or "")))
    rows, links = [], []
    for q in Q:
        ref = q.get("ref_id") or q.get("building_id")
        if q.get("item_type") == "building":
            b = B.get(ref) or {}
            what = f"Building {ref} · {use_label(((b.get('attributes') or {}).get('use') or {}).get('value'))}"
            why = review_reasons(q.get("reasons"), {"match_status": b.get("match_status"), "discrepancies": q.get("discrepancies")
                                                    or b.get("discrepancies")})
        else:
            a = A.get(ref) or {}
            kind = a.get("type") or q.get("asset_cls")
            what = f"{'Streetlight' if kind == 'streetlight' else 'Pole'} {ref or ''}".strip()
            why = review_reasons(q.get("reasons"))
        rows.append([q.get("priority"), what, q.get("street") or "—", loc(q["lat"], q["lon"]), "; ".join(why) or "—",
                     REVIEW.get(q.get("status"), pretty(q.get("status"))), "View in Google Maps"])
        links.append(maps_url(q["lat"], q["lon"]))
    return rows, links


# ----------------------------------------------------------------------------------------------------- photo dates
def _street_photo_dates(F, names, street, today=None):
    """Hood's photo-date rule (imagery.py) for one street: the camera stops planned on it"""
    from .imagery import OLD_MONTHS, _today_m, months
    date = {p["pano_id"]: p.get("date") for p in F.get("panos") or [] if p.get("pano_id")}
    used = [date.get(e["pano_id"]) for e in F.get("plan") or [] if e.get("camera_lat") is not None
            and names.get(e.get("street"), e.get("street")) == street and date.get(e.get("pano_id"))]
    cutoff = _today_m(today) - OLD_MONTHS
    return {"camera_stops_dated": len(used), "oldest": min(used) if used else None, "newest": max(used) if used else None,
            "older_than_cutoff": sum(1 for d in used if months(d) is not None and months(d) < cutoff)}


def _street_names(areas_dir, slug):
    import json
    try:
        with open(os.path.join(areas_dir, slug, "street_names.json"), encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


# ------------------------------------------------------------------------------------------------------------ map
def _map(store, bundle, street, prio):
    """what the PDF map draws, in lon/lat: roads (OpenStreetMap copy; analysed streets when it is not available),
    the area outline, building outlines by finding, dark stretches by priority (numbered as in the table)"""
    on = lambda s: not street or s == street
    pts = []
    for b in bundle["buildings"]:
        if on(b.get("street")):
            pts += [(lo, la) for la, lo in ((b.get("footprint") or {}).get("polygon_latlon") or [[b["lat"], b["lon"]]])]
    for g in bundle["streetlight_gaps"]:
        if on(g.get("street")):
            pts += [(g["start"][1], g["start"][0]), (g["end"][1], g["end"][0])]
    for s in bundle["streets"]:
        if street and s["name"] == street and s.get("geometry"):
            geo = s["geometry"]
            lines = geo["coordinates"] if geo["type"] == "MultiLineString" else [geo["coordinates"]]
            pts += [tuple(p) for ln in lines for p in ln]
    if not street or not pts:
        w, s_, e, n = bundle["bbox"]
    else:
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        w, s_, e, n = min(xs), min(ys), max(xs), max(ys)
    pad_y, pad_x = 40 / 110540, 40 / (111320 * math.cos(math.radians((s_ + n) / 2)))
    box = (w - pad_x, s_ - pad_y, e + pad_x, n + pad_y)
    roads, road_source = None, "analysed streets only (the OpenStreetMap copy was not available)"
    if getattr(store, "pool", None) is not None:
        ways = mapdata.roads_in_box(box[1], box[0], box[3], box[2])
        if ways is not None:
            roads = [{"cls": w_["tags"].get("highway"), "line": [(p["lon"], p["lat"]) for p in w_["geometry"]]} for w_ in ways]
            c = mapdata.city_for_box(box[1], box[0], box[3], box[2])
            road_source = f"OpenStreetMap snapshot {day_text(c['osm_snapshot'])} (the app's copy)" if c else "OpenStreetMap"
    if roads is None:
        roads = []
        for s in bundle["streets"]:
            geo = s.get("geometry")
            if geo:
                lines = geo["coordinates"] if geo["type"] == "MultiLineString" else [geo["coordinates"]]
                roads += [{"cls": "residential", "line": [tuple(p) for p in ln]} for ln in lines]
    buildings = [{"status": b.get("match_status"), "ring": [(lo, la) for la, lo in b["footprint"]["polygon_latlon"]]}
                 for b in bundle["buildings"] if on(b.get("street")) and len((b.get("footprint") or {}).get("polygon_latlon") or []) >= 3]
    disp = bundle.get("gap_display") or {}
    rank = {}
    if prio["available"]:
        rank = {r["id"]: i for i, r in enumerate(lighting.order([r for r in prio["rows"].values()
                                                                if on(next((g.get("street") for g in bundle["streetlight_gaps"]
                                                                            if g["id"] == r["id"]), None))]), 1)}
    gaps = []
    for g in bundle["streetlight_gaps"]:
        if not on(g.get("street")):
            continue
        d = disp.get(g["id"]) or {}
        line = d.get("path") if d.get("mode") == "along_road" and d.get("path") else [g["start"][::-1], g["end"][::-1]]
        p = prio["rows"].get(g["id"]) if prio["available"] else None
        gaps.append({"id": g["id"], "level": p["level"] if p else None, "rank": rank.get(g["id"]), "line": [tuple(x) for x in line]})
    outline = []
    poly = bundle.get("polygon") or {}
    if not street and poly.get("type") in ("Polygon", "MultiPolygon"):
        rings = [poly["coordinates"][0]] if poly["type"] == "Polygon" else [p[0] for p in poly["coordinates"]]
        outline = [[tuple(x) for x in r] for r in rings]
    return {"box": box, "roads": roads, "road_source": road_source, "buildings": buildings, "gaps": gaps, "outline": outline}


# --------------------------------------------------------------------------------------------------------- content
def content(store, bundle, F, model_card, areas_dir, street=None, today=None):
    if street and street not in {b.get("street") for b in bundle["buildings"]} | {s["name"] for s in bundle["streets"]} \
            | {g.get("street") for g in bundle["streetlight_gaps"]} | {a.get("street") for a in bundle["assets"]}:
        raise KeyError(street)
    mc = model_card or {}
    today = today or _dt.date.today()
    area_name = bundle["name"].replace("Unseen street: ", "")
    k = kpis(bundle, street)
    numbers = [{"key": key, "label": (one if k[key] == 1 and one else label), "value": k[key], "main": i < MAIN_KPIS}
               for i, (key, label, one) in enumerate(KPI_DEFS)]
    prio = lighting.for_area(store, bundle)
    hood = hood_view(bundle, F, mc)
    im = imagery_view(bundle, F)["summary"] if not street else _street_photo_dates(F, _street_names(areas_dir, bundle["slug"]), street)
    md = mapdata.area_map_data(bundle, areas_dir)
    lamp = ((mc.get("detector") or {}).get("per_class") or {}).get(LAMP_KEY) or {}
    recall = f"{round(lamp['R'] * 100)}%" if lamp.get("R") is not None else "not measured"

    # data sources
    city = md.get("city")
    run = md.get("run") or {}
    sources = [
        ("Street View photos (Google)", (f"taken {month_text(im['oldest'])} – {month_text(im['newest'])}; "
                                         f"{im['older_than_cutoff']} of {im['camera_stops_dated']} camera positions are over 3 years old")
         if im.get("oldest") else "photo dates not recorded"),
        ("OpenStreetMap (roads, building outlines, shop points)",
         (f"this analysis used OpenStreetMap's snapshot of {day_text(run.get('osm_snapshot'))}" if run.get("kind") == "snapshot"
          else f"this analysis read OpenStreetMap's live servers{(' on ' + day_text(run['date'])) if run.get('date') else ' on its run day'}")
         + (f"; this report's map and road types use the app's snapshot of {day_text(city['osm_snapshot'])}" if city else "")),
        ("Property and asset registers", "SYNTHETIC demo data: made-up records that copy what the photos show, except planted "
                                         "mistakes. Not the city's records."),
        ("Accuracy figures", "the team's model card (measured on hand-labelled samples)"),
    ]
    if city and city.get("ms_release"):
        sources.insert(2, ("Microsoft building footprints", f"release {day_text(city['ms_release'])} (used only where OpenStreetMap has few outlines)"))

    # routing and cost (Under the Hood › Routing and cost)
    rt = hood.get("routing")
    cost = None
    if rt:
        sv, ai = rt["street_view"], rt["totals"]["usd"]
        total = sv["usd"] + ai if sv.get("usd") is not None and ai is not None else None
        line = None
        if total:
            cloud = sorted([(x["usd"], t["key"]) for t in rt["tasks"] for x in t["routes"] if x["route"] == "cloud" and x["usd"] is not None],
                           reverse=True)
            line = (f"This run cost about {usd_text(total)}: Street View photos {usd_text(sv['usd'])} ({fmt(sv['photos'])} at "
                    f"Google’s list price, {round(100 * sv['usd'] / total)}%) and cloud AI (Nova Lite) {usd_text(ai)} "
                    f"({100 * ai / total:.1f}%)." + (" Floor counting is the largest AI cost; it isn’t routed yet."
                                                     if cloud and cloud[0][1] == "floors" else ""))
        tasks = [[t["title"], f"{x['route']} · {x['model']}", fmt(x["n"]), "$0" if x["route"] == "local" else usd_text(x["usd"]),
                  "" if x["route"] == "local" else x["usd_status"]] for t in rt["tasks"] if t["input"] > 0 for x in t["routes"]]
        cost = {"line": line, "tasks": tasks, "as_run": (rt["totals"]["calls"], rt["totals"]["usd"], rt["totals"]["status"]),
                "no_router": (rt["all_cloud"]["calls"], rt["all_cloud"]["usd"]) if rt.get("all_cloud") else None}

    # Gate 1, worded as on Trust
    g1 = mc.get("gate1_position") or {}
    fair = None
    for key, v in ((g1.get("vs OSM front-wall centre") or {}).get(bundle["slug"]) or {}).items():
        if key.startswith("camera-derived") and v.get("n"):
            fair = v
    gate1 = {"title": f"Position accuracy — target ≤ {g1.get('target_m')} m (FarmwiseAI Gate 1)",
             "status": "Status: " + ("Not verified" if g1.get("status") == "not verified" else str(g1.get("status"))),
             "note": f"{g1.get('status_note')} No surveyed reference exists.",
             "row": (f"All camera-derived positions (the two camera methods together), vs the centre of the OSM front wall: "
                     f"n = {fmt(fair['n'])}, median {fair['median_m']} m, p90 {fair['p90_m']} m, {fair['within_3_5_m_pct']}% within "
                     f"{g1.get('target_m')} m.") if fair else "This area is not in Trust's Gate 1 table (it was analysed from the app)."}

    limits = [
        "The property and asset registers are SYNTHETIC. They copy what the photos show, except planted mistakes, so "
        "“not in the register” and “differs” test the comparison end to end; they do not say the city’s records are wrong.",
        f"Possible dark stretches mean no lamp was seen within 60 m, not that none exists: the lamp detector finds about {recall} of "
        f"lamp heads (n = {lamp.get('n', '—')}), and a photo can’t tell whether a lamp works. The priority ranks these candidates; "
        "it does not confirm them.",
        "The priority’s activity count includes only buildings whose use is known (commercial or shop + home) — "
        f"{plural(k['use_not_classified'], 'building')} here have no known use — plus OpenStreetMap shop / amenity / office "
        "points (which include some non-business places) and businesses read from signs.",
        (f"Street View photos are {month_text(im['oldest'])} – {month_text(im['newest'])}; {im['older_than_cutoff']} of "
         f"{im['camera_stops_dated']} camera positions are over 3 years old, so the street may have changed since.")
        if im.get("oldest") else "Photo dates are not recorded for this area.",
        "Gate 1 (building position within 3.5 m) is measured against OpenStreetMap’s outlines, not a surveyed reference, so it "
        "is not verified.",
        "Locations are approximate (map points, not survey points). The Google Maps links open the location only.",
    ]

    b_rows, b_links = _building_rows(bundle, street)
    a_rows, a_links = _asset_rows(bundle, street)
    s_rows, s_links = _stretch_rows(bundle, street, prio)
    r_rows, r_links = _review_rows(bundle, street)
    return {
        "area": area_name, "slug": bundle["slug"], "street": street, "generated": today.isoformat(),
        "title": f"{street} — {area_name}" if street else area_name,
        "scope": f"One street: {street}" if street else f"Whole area ({plural(k['streets_covered'], 'street')})",
        "sources": sources, "numbers": numbers, "kpis": k, "recall": recall,
        "priority": {"available": prio["available"], "rule": prio["rule"], "note": prio["note"],
                     "counts": {lv: sum(1 for r in s_rows if r[1] == PRIORITY_WORD[lv]) for lv in PRIORITY_WORD}},
        "tables": {
            "buildings": {"title": "Buildings with findings", "sheet": "Buildings with findings", "columns": BUILDING_COLS,
                          "rows": b_rows, "links": b_links},
            "assets": {"title": "Poles and streetlights with a register finding", "sheet": "Assets", "columns": ASSET_COLS,
                       "rows": a_rows, "links": a_links},
            "stretches": {"title": "Possible dark stretches, in priority order", "sheet": "Possible dark stretches",
                          "columns": STRETCH_COLS, "rows": s_rows, "links": s_links},
            "review": {"title": "Review queue", "sheet": "Review items", "columns": REVIEW_COLS, "rows": r_rows, "links": r_links},
        },
        "cost": cost, "cost_scope": "for the whole analysed area’s run" if street else None,
        "gate1": gate1, "limits": limits, "map": _map(store, bundle, street, prio),
    }


# ----------------------------------------------------------------------------------------------------------- PDF
INK, INK2, INK3 = (27, 31, 42), (61, 67, 86), (91, 96, 112)
LINE = (214, 210, 200)
SODIUM = (156, 78, 7)
STATUS = {"no_record": (204, 31, 99), "discrepancy": (0, 132, 159), "matched": (142, 157, 196)}
PRIORITY_RGB = {"high": (63, 75, 176), "medium": (134, 145, 210), "low": (195, 200, 232)}   # daylight ramp (D54)
DARK = (27, 31, 42)
ROAD_W = {"motorway": 1.2, "trunk": 1.2, "primary": 1.0, "secondary": 0.9, "tertiary": 0.7}


def _hex(rgb):
    return "%02X%02X%02X" % rgb


SYMBOLS = {"≤": "<=", "≥": ">=", "→": "->", "↑": "^"}   # not in Anek Tamil; drawn from Arial when the system has it
SYSTEM_SYMBOL_FONT = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", "arial.ttf")


def _font(pdf):
    for w, style in ((400, ""), (600, "B")):
        pdf.add_font("Anek", style, os.path.join(FONT_DIR, f"AnekTamil-latin-{w}.ttf"))
        pdf.add_font("AnekTa", style, os.path.join(FONT_DIR, f"AnekTamil-tamil-{w}.ttf"))
    fallbacks = ["AnekTa"]
    if os.path.isfile(SYSTEM_SYMBOL_FONT):
        for style in ("", "B"):
            pdf.add_font("Sym", style, SYSTEM_SYMBOL_FONT)
        fallbacks.append("Sym")
    else:
        pdf.replace_symbols = True
    pdf.set_fallback_fonts(fallbacks, exact_match=False)
    try:
        pdf.set_text_shaping(True)                     # Tamil vowel signs need shaping (uharfbuzz)
    except Exception:                                  # noqa: BLE001 - without uharfbuzz Latin text is unchanged
        pass


def _pdf_class():
    from fpdf import FPDF

    class Report(FPDF):
        doc_title = ""
        replace_symbols = False

        def normalize_text(self, text):
            if self.replace_symbols:
                for a, b in SYMBOLS.items():
                    text = text.replace(a, b)
            return super().normalize_text(text)

        def footer(self):
            self.set_y(-12)
            self.set_font("Anek", "", 7.5)
            self.set_text_color(*INK3)
            self.cell(0, 3.6, f"{self.doc_title} · page {self.page_no()}/{{nb}}", align="L", new_x="LMARGIN", new_y="NEXT")
            self.cell(0, 3.6, FOOTER, align="L")
    return Report


def _h(pdf, text, size=13, top=4, keep=0):
    """a heading; `keep` mm of room needed below it (else a new page, so a heading never sits alone at a page end)"""
    if keep and pdf.get_y() + keep > pdf.h - pdf.b_margin:
        pdf.add_page(orientation=pdf.cur_orientation)
        top = 0
    pdf.ln(top)
    pdf.set_font("Anek", "B", size)
    pdf.set_text_color(*INK)
    pdf.multi_cell(0, size * 0.5, text, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)


def _p(pdf, text, size=9.5, color=INK2, bold=False):
    pdf.set_font("Anek", "B" if bold else "", size)
    pdf.set_text_color(*color)
    pdf.multi_cell(0, size * 0.48, text, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(0.8)


def _draw_map(pdf, m, x, y, w, h):
    w0, s0, e0, n0 = m["box"]
    kx = math.cos(math.radians((s0 + n0) / 2))
    gw, gh = (e0 - w0) * kx, (n0 - s0)
    sc = min(w / gw, h / gh)
    ox, oy = x + (w - gw * sc) / 2, y + (h - gh * sc) / 2
    P = lambda lon, lat: (ox + (lon - w0) * kx * sc, oy + (n0 - lat) * sc)
    pdf.set_fill_color(250, 248, 242)
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.2)
    pdf.rect(x, y, w, h, style="DF")
    with pdf.rect_clip(x, y, w, h):
        pdf.set_draw_color(190, 186, 176)
        for r in m["roads"]:
            if len(r["line"]) >= 2:
                pdf.set_line_width(ROAD_W.get((r["cls"] or "").replace("_link", ""), 0.45))
                pdf.polyline([P(*p) for p in r["line"]])
        for ring in m["outline"]:
            pdf.set_draw_color(*INK3)
            pdf.set_line_width(0.35)
            with pdf.local_context(dash_pattern={"dash": 1.2, "gap": 0.8}):
                pdf.polyline([P(*p) for p in ring])
        pdf.set_line_width(0.12)
        for status in ("matched", "discrepancy", "no_record"):                 # findings drawn on top
            col = STATUS.get(status)
            pdf.set_fill_color(*col)
            pdf.set_draw_color(*[max(0, c - 40) for c in col])
            for b in m["buildings"]:
                if b["status"] == status:
                    pdf.polygon([P(*p) for p in b["ring"]], style="DF")
        for lv in ("low", "medium", "high", None):
            for g in m["gaps"]:
                if g["level"] != lv or len(g["line"]) < 2:
                    continue
                pts = [P(*p) for p in g["line"]]
                pdf.set_draw_color(*(PRIORITY_RGB.get(lv) or (150, 150, 150)))
                pdf.set_line_width({"high": 2.4, "medium": 2.0, "low": 1.7}.get(lv, 1.7))
                pdf.polyline(pts)
                pdf.set_draw_color(*DARK)
                pdf.set_line_width(0.9)
                pdf.polyline(pts)
        for g in m["gaps"]:                                                        # rank numbers = the table's "#"
            if g["rank"] is None:
                continue
            cx, cy = P(*g["line"][len(g["line"]) // 2])
            pdf.set_fill_color(255, 255, 255)
            pdf.set_draw_color(*(PRIORITY_RGB.get(g["level"]) or INK))
            pdf.set_line_width(0.4)
            pdf.circle(x=cx, y=cy, radius=2.1, style="DF")
            pdf.set_font("Anek", "B", 6.5)
            pdf.set_text_color(*INK)
            pdf.set_xy(cx - 2.1, cy - 1.6)
            pdf.cell(4.2, 3.2, str(g["rank"]), align="C")
    # scale bar + attribution
    m_per_mm = 111320 / sc
    nice = next(v for v in (10, 20, 50, 100, 200, 250, 500, 1000, 2000) if v / m_per_mm >= 15)
    L = nice / m_per_mm
    pdf.set_draw_color(*INK)
    pdf.set_line_width(0.4)
    pdf.line(x + 4, y + h - 5, x + 4 + L, y + h - 5)
    pdf.set_font("Anek", "", 7)
    pdf.set_text_color(*INK2)
    pdf.set_xy(x + 4, y + h - 9.5)
    pdf.cell(L, 4, f"{fmt(nice)} m")
    pdf.set_xy(x + w - 62, y + h - 5)
    pdf.cell(60, 4, "© OpenStreetMap contributors", align="R")
    pdf.set_xy(x + w - 10, y + 2)
    pdf.set_font("Anek", "B", 8)
    pdf.cell(8, 4, "N ↑", align="C")


def _legend(pdf, m):
    items = [("fill", STATUS["no_record"], "Not in the register"), ("fill", STATUS["discrepancy"], "Differs from the register"),
             ("fill", STATUS["matched"], "Matches / entry exists"),
             ("line", PRIORITY_RGB["high"], "Possible dark stretch, High priority"),
             ("line", PRIORITY_RGB["medium"], "… Medium priority"), ("line", PRIORITY_RGB["low"], "… Low priority")]
    pdf.set_font("Anek", "", 8)
    x0, y = pdf.get_x(), pdf.get_y()
    col_w = 62
    for i, (kind, col, label) in enumerate(items):
        x = x0 + (i % 3) * col_w
        yy = y + (i // 3) * 5
        if kind == "fill":
            pdf.set_fill_color(*col)
            pdf.rect(x, yy + 0.8, 4, 3, style="F")
        else:
            pdf.set_draw_color(*col)
            pdf.set_line_width(2)
            pdf.line(x, yy + 2.3, x + 6, yy + 2.3)
            pdf.set_draw_color(*DARK)
            pdf.set_line_width(0.8)
            pdf.line(x, yy + 2.3, x + 6, yy + 2.3)
        pdf.set_text_color(*INK2)
        pdf.set_xy(x + 7.5, yy)
        pdf.cell(col_w - 8, 4.6, label)
    pdf.set_xy(x0, y + 11)
    _p(pdf, f"Roads: {m['road_source']}. Building outlines: OpenStreetMap (as analysed). Numbers on the dark stretches = "
            "their place in the priority list. No Google map or photo is reproduced.", size=7.5, color=INK3)


def _table(pdf, t, widths, size=7.6):
    from fpdf.fonts import FontFace
    pdf.set_font("Anek", "", size)
    pdf.set_text_color(*INK)
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.2)
    pdf.set_fill_color(255, 255, 255)
    head = FontFace(emphasis="BOLD", color=INK, fill_color=(236, 232, 222))
    if not t["rows"]:
        _p(pdf, "None.", color=INK3)
        return
    with pdf.table(col_widths=widths, headings_style=head, line_height=size * 0.52, padding=1.1,
                   borders_layout="HORIZONTAL_LINES", first_row_as_headings=True, text_align="LEFT",
                   cell_fill_mode="NONE") as tb:
        r = tb.row()
        for c in t["columns"]:
            r.cell(c)
        for row, link in zip(t["rows"], t["links"]):
            r = tb.row()
            for i, v in enumerate(row):
                if i == len(row) - 1 and link:
                    r.cell(str(v), link=link, style=FontFace(color=SODIUM, emphasis="UNDERLINE"))
                else:
                    r.cell("" if v is None else str(v))


def pdf(c):
    Report = _pdf_class()
    doc = Report(orientation="P", unit="mm", format="A4")
    doc.doc_title = f"GEO-CASCADIA report · {c['title']}"
    doc.set_title(doc.doc_title)
    doc.set_author("GEO-CASCADIA (prototype)")
    doc.set_creator("GEO-CASCADIA API")
    _font(doc)
    doc.set_auto_page_break(True, margin=15)
    doc.set_margins(14, 14, 14)
    doc.alias_nb_pages()

    # page 1: summary
    doc.add_page()
    doc.set_font("Anek", "B", 9)
    doc.set_text_color(*SODIUM)
    doc.cell(0, 5, "GEO-CASCADIA · STREET SURVEY REPORT", new_x="LMARGIN", new_y="NEXT")
    doc.set_font("Anek", "B", 20)
    doc.set_text_color(*INK)
    doc.multi_cell(0, 9, c["title"], new_x="LMARGIN", new_y="NEXT")
    _p(doc, f"{c['scope']} · report made {day_text(c['generated'])}", size=10, color=INK2)
    doc.set_fill_color(253, 236, 242)
    doc.set_draw_color(*STATUS["no_record"])
    doc.set_line_width(0.3)
    doc.set_font("Anek", "B", 9)
    doc.set_text_color(*INK)
    doc.multi_cell(0, 5.2, "The property and asset registers in this report are SYNTHETIC demo data (made up), not the "
                           "city's records.", border=1, fill=True, padding=1.5, new_x="LMARGIN", new_y="NEXT")
    _h(doc, "Key numbers", 12)
    nums = c["numbers"]
    w = (doc.w - 28) / 5
    y = doc.get_y()
    for i, n in enumerate(nums[:MAIN_KPIS]):
        x = 14 + i * w
        doc.set_xy(x, y)
        doc.set_font("Anek", "B", 18)
        doc.set_text_color(*(STATUS["no_record"] if n["key"] == "unmatched_properties" else STATUS["discrepancy"]
                             if n["key"] == "buildings_with_discrepancy" else INK))
        doc.cell(w - 2, 8, fmt(n["value"]))
        doc.set_xy(x, y + 8.5)
        doc.set_font("Anek", "", 8.5)
        doc.set_text_color(*INK2)
        doc.multi_cell(w - 3, 4, n["label"], new_x="LMARGIN", new_y="NEXT")
    doc.set_xy(14, y + 18)
    doc.set_font("Anek", "", 8.5)
    doc.set_text_color(*INK2)
    doc.multi_cell(0, 4.3, " · ".join(f"{n['label']} {fmt(n['value'])}" for n in nums[MAIN_KPIS:]), new_x="LMARGIN", new_y="NEXT")
    pc = c["priority"]["counts"]
    _p(doc, (f"Possible dark stretches by lighting priority: High {pc['high']} · Medium {pc['medium']} · Low {pc['low']}. "
             if c["priority"]["available"] else c["priority"]["note"] + " ")
       + f"Possible, not certain: the detector finds about {c['recall']} of lamp heads in a photo.", size=8.5, color=INK2)

    _h(doc, "Data sources", 12)
    for k, v in c["sources"]:
        doc.set_font("Anek", "B", 8.5)
        doc.set_text_color(*INK)
        doc.multi_cell(0, 4.2, k, new_x="LMARGIN", new_y="NEXT")
        _p(doc, v, size=8.5)

    # page 2: map
    doc.add_page()
    _h(doc, "Map", 13, top=0)
    _p(doc, "Drawn from the app's own data. Building outlines coloured by finding; possible dark stretches by priority.", size=8.5)
    y = doc.get_y()
    mh = min(185, doc.h - y - 45)
    _draw_map(doc, c["map"], 14, y, doc.w - 28, mh)
    doc.set_xy(14, y + mh + 3)
    _legend(doc, c["map"])

    # tables (landscape)
    T = c["tables"]
    doc.add_page(orientation="L")
    _h(doc, T["stretches"]["title"], 13, top=0)
    rule = c["priority"]["rule"]
    _p(doc, f"How the priority is set (a fixed rule, not tuned): length — {rule['length']}; road — {rule['road']}; activity — "
            f"{rule['activity']}. {rule['levels']}. These are POSSIBLE dark stretches (the lamp detector finds about "
            f"{c['recall']} of lamp heads), so this ranks candidates, not confirmed gaps.", size=8)
    _table(doc, T["stretches"], (7, 14, 58, 18, 36, 16, 30, 18, 26, 30, 20))
    _h(doc, T["buildings"]["title"], 13, keep=45)
    _p(doc, "Every building that is not in the register or differs from it (synthetic register). “View in Google Maps” opens "
            "the location.", size=8)
    _table(doc, T["buildings"], (19, 28, 24, 20, 20, 26, 26, 36, 38, 18, 18))
    _h(doc, T["assets"]["title"], 13, keep=45)
    _table(doc, T["assets"], (20, 24, 34, 26, 32, 44, 30, 22, 20))
    _h(doc, T["review"]["title"], 13, keep=45)
    _p(doc, "Items a person should check, most urgent first (1 = most urgent).", size=8)
    _table(doc, T["review"], (22, 46, 44, 28, 76, 26, 20))

    # routing and cost, Gate 1, limits
    doc.add_page(orientation="P")
    _h(doc, "Routing and cost", 13, top=0)
    if c["cost"]:
        if c["cost_scope"]:
            _p(doc, f"Cost and routing are {c['cost_scope']}.", size=8.5, color=INK3)
        if c["cost"]["line"]:
            _p(doc, c["cost"]["line"], size=9.5, color=INK)
        _p(doc, "Small models on the analysis computer handle everything first; only what they can't do, or aren't sure of, goes "
                "to the cloud model (Amazon Nova Lite), billed per call.", size=8.5)
        _table(doc, {"columns": ["Task", "Route", "How many", "Cost", "Cost status"], "rows": c["cost"]["tasks"],
                     "links": [None] * len(c["cost"]["tasks"])}, (52, 50, 22, 22, 36), size=8)
        ar = c["cost"]["as_run"]
        _p(doc, f"Cloud AI as run: {fmt(ar[0])} calls, {usd_text(ar[1])} ({ar[2]})."
                + (f" With no local router: {fmt(c['cost']['no_router'][0])} calls, {usd_text(c['cost']['no_router'][1])}."
                   if c["cost"]["no_router"] else ""), size=8.5)
    else:
        _p(doc, "This run saved no cloud-call records, so its routing and cost can't be shown.", size=8.5)
    _h(doc, c["gate1"]["title"], 12)
    _p(doc, c["gate1"]["status"], size=9.5, color=INK, bold=True)
    _p(doc, c["gate1"]["note"], size=9)
    _p(doc, c["gate1"]["row"], size=9)
    _h(doc, "Limits", 12)
    for t in c["limits"]:
        _p(doc, "• " + t, size=9)
    return bytes(doc.output())


# ---------------------------------------------------------------------------------------------------------- Excel
def xlsx(c):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    wb = Workbook()
    ws = wb.active
    ws.title = "About"
    bold = Font(bold=True)
    ws.append(["GEO-CASCADIA report", c["title"]])
    ws.append(["Scope", c["scope"]])
    ws.append(["Made", c["generated"]])
    ws.append(["Register", "SYNTHETIC demo data (made up), not the city's records"])
    ws.append([])
    ws.append(["Key number", "Value"])
    for n in c["numbers"]:
        ws.append([n["label"], n["value"]])
    ws.append([])
    ws.append(["Data source", "Detail"])
    for k, v in c["sources"]:
        ws.append([k, v])
    ws.append([])
    ws.append(["Limits", ""])
    for t in c["limits"]:
        ws.append(["", t])
    ws.append([])
    ws.append(["Footer", FOOTER])
    for row in ws.iter_rows():
        if row[0].value in ("GEO-CASCADIA report", "Key number", "Data source", "Limits"):
            for cell in row:
                cell.font = bold
    ws.column_dimensions["A"].width = 44
    ws.column_dimensions["B"].width = 110
    head_fill = PatternFill("solid", fgColor="ECE8DE")
    for key in ("buildings", "assets", "stretches", "review"):
        t = c["tables"][key]
        sh = wb.create_sheet(t["sheet"])
        sh.append(t["columns"])
        for cell in sh[1]:
            cell.font, cell.fill = bold, head_fill
            cell.alignment = Alignment(wrap_text=True, vertical="top")
        for row, link in zip(t["rows"], t["links"]):
            sh.append(row)
            if link:
                cell = sh.cell(row=sh.max_row, column=len(row))
                cell.hyperlink = link
                cell.font = Font(color="9C4E07", underline="single")
        for i, col in enumerate(t["columns"], 1):
            width = max([len(str(col))] + [len(str(r[i - 1])) for r in t["rows"]]) + 2
            sh.column_dimensions[get_column_letter(i)].width = min(60, max(8, width))
        sh.freeze_panes = "A2"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def filename(c, ext):
    import re
    base = c["slug"] + (("_" + re.sub(r"[^a-z0-9]+", "_", c["street"].lower()).strip("_")) if c["street"] else "")
    return f"geo-cascadia_report_{base}_{c['generated']}.{ext}"
