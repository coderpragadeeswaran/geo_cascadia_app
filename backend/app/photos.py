"""Street View photos Google no longer serves (D60), and the newer photo shown instead.

Google retires panorama ids: about a third of the panoramas the Ward 29 analysis used now answer ZERO_RESULTS, and
their Street View Static photo is a 404. The app checks each stored panorama with the FREE metadata endpoint (by
`pano`), never by asking for the photo, and keeps the answer on disk for 30 days (`data/cache/streetview_meta.json`),
so a photo it knows is gone is never requested again.

When a stored panorama is gone, the photo shown instead is Google's current panorama near where the original camera
stood (metadata by `location`, radius NEAR_RADIUS_M, `source=outdoor`, also free and cached), aimed from ITS position at
the same target (a building's front-wall centre; a pole, light or sign position), with the stored pitch and field of
view. The analysis' boxes are never drawn on it: they belong to the old photo.

Only definite answers are cached (OK / ZERO_RESULTS / NOT_FOUND). A refused key, a quota answer or a network error is
"unknown": the app then shows the stored photo as before. No server key (tests): cache only, no network.
"""
import datetime as _dt
import http.client
import json
import math
import os
import socket
import ssl
import threading
import urllib.parse

from geo_cascadia.geo import Frame, bearing_between, haversine

META_HOST = "maps.googleapis.com"
META_PATH = "/maps/api/streetview/metadata"
TTL_DAYS = 30
NEAR_RADIUS_M = 25            # "the current panorama near the original camera position"
DEFINITE = ("OK", "ZERO_RESULTS", "NOT_FOUND")
GONE = ("ZERO_RESULTS", "NOT_FOUND")


class _V4HTTPS(http.client.HTTPSConnection):
    """HTTPS over IPv4 only: on the owner's laptop IPv6 routes time out and Python tries them first (curl does not)."""
    def connect(self):
        addr = socket.getaddrinfo(self.host, self.port, socket.AF_INET, socket.SOCK_STREAM)[0][4]
        sock = socket.create_connection(addr, self.timeout)
        self.sock = ssl.create_default_context().wrap_socket(sock, server_hostname=self.host)


def google_meta(params, key, timeout=6.0):
    """One free Street View metadata call. Google's JSON answer, or None (network / HTTP error, unreadable answer)."""
    q = urllib.parse.urlencode({**params, "key": key})
    try:
        c = _V4HTTPS(META_HOST, 443, timeout=timeout)
        c.request("GET", f"{META_PATH}?{q}")
        r = c.getresponse()
        body = r.read()
        c.close()
        if r.status != 200:
            return None
        return json.loads(body.decode("utf-8"))
    except (OSError, ValueError, http.client.HTTPException):
        return None


def _now():
    return _dt.datetime.now(_dt.timezone.utc)


class PhotoMeta:
    """The 30-day disk cache of metadata answers: `pano:<id>` and `near:<lat>,<lon>` (6 decimals, ~0.1 m)."""

    def __init__(self, path, key=None, fetch=None, ttl_days=TTL_DAYS):
        self.path, self.key, self.ttl = path, key, _dt.timedelta(days=ttl_days)
        self.fetch = fetch or google_meta
        self._rows, self._lock, self._dirty = None, threading.RLock(), False
        self.calls = 0

    def _load(self):
        if self._rows is None:
            try:
                with open(self.path, encoding="utf-8") as f:
                    self._rows = json.load(f)
            except (OSError, ValueError):
                self._rows = {}
        return self._rows

    def save(self):
        with self._lock:
            if not self._dirty:
                return
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._rows, f, separators=(",", ":"))
            os.replace(tmp, self.path)
            self._dirty = False

    def _fresh(self, row):
        try:
            return _now() - _dt.datetime.fromisoformat(row["checked"]) < self.ttl
        except (KeyError, ValueError, TypeError):
            return False

    def _get(self, k, params, lookup):
        with self._lock:
            row = self._load().get(k)
        if row and self._fresh(row):
            return row
        if not (lookup and self.key):
            return row                                         # stale beats nothing; None = unknown
        j = self.fetch(params, self.key)
        self.calls += 1
        st = (j or {}).get("status")
        if st not in DEFINITE:
            return row                                         # refused / quota / network: unknown, never cached
        loc = j.get("location") or {}
        new = {"status": st, "checked": _now().isoformat(timespec="seconds")}
        if st == "OK":
            new.update(pano_id=j.get("pano_id"), date=j.get("date"), lat=loc.get("lat"), lon=loc.get("lng"))
        with self._lock:
            self._load()[k] = new
            self._dirty = True
        return new

    def pano(self, pano_id, lookup=True):
        return self._get(f"pano:{pano_id}", {"pano": pano_id}, lookup)

    def near(self, lat, lon, lookup=True):
        return self._get(f"near:{lat:.6f},{lon:.6f}", {"location": f"{lat:.6f},{lon:.6f}", "radius": NEAR_RADIUS_M,
                                                       "source": "outdoor"}, lookup)


_SAME = {"stamp": None, "map": {}}
_SAME_LOCK = threading.Lock()


def same_images(areas_dir):
    """D61: retired panorama id -> its verified re-issue ({pano_id, date, moved_m, checked, ...}) from every area's
    photo_check.json `same_image` block (written by tools/check_photos.py; only verdict "same" counts, and only in an area
    whose go / no-go gate passed, `same_image_restore.restore`). Re-read when a file changes."""
    files = []
    for slug in sorted(os.listdir(areas_dir)) if os.path.isdir(areas_dir) else []:
        p = os.path.join(areas_dir, slug, "photo_check.json")
        if os.path.isfile(p):
            files.append((p, os.path.getmtime(p)))
    stamp = tuple(files)
    with _SAME_LOCK:
        if _SAME["stamp"] == stamp:
            return _SAME["map"]
    m = {}
    for p, _t in files:
        try:
            with open(p, encoding="utf-8") as f:
                c = json.load(f) or {}
        except (OSError, ValueError):
            continue
        if not (c.get("same_image_restore") or {}).get("restore"):
            continue                                            # the area's go / no-go gate failed: nothing restored
        rows = c.get("same_image") or {}
        for old, r in rows.items():
            if (r or {}).get("verdict") == "same" and r.get("pano_id"):
                m[old] = r
    with _SAME_LOCK:
        _SAME.update(stamp=stamp, map=m)
    return m


def status(meta, pano_id, camera, lookup=True, same=None):
    """{"served": True | False | None (unknown), "current": {pano_id, date, lat, lon, moved_m[, same_image]} | None} for
    one stored panorama; `camera` = where it stood ({lat, lon} from panos.json), needed to find a current one.
    D61: `same` = same_images(); a current panorama that is the verified re-issue of this one gets `same_image: true`."""
    p = meta.pano(pano_id, lookup) if pano_id else None
    if p is None:
        return {"served": None, "current": None}
    if p["status"] == "OK":
        return {"served": True, "current": None}
    out = {"served": False, "current": None}
    if not camera:
        return out
    n = meta.near(camera["lat"], camera["lon"], lookup)
    if n and n["status"] == "OK" and n.get("pano_id") and n.get("lat") is not None and n["pano_id"] != pano_id:
        out["current"] = {"pano_id": n["pano_id"], "date": n.get("date"), "lat": n["lat"], "lon": n["lon"],
                          "moved_m": round(haversine(camera["lat"], camera["lon"], n["lat"], n["lon"]), 1)}
        s = (same or {}).get(pano_id)
        if s and s.get("pano_id") == n["pano_id"]:
            out["current"]["same_image"] = True
    return out


def aimed(cur, view, target):
    """The newer photo's view: from the current panorama's position at `target` (lat, lon), same pitch and fov. With no
    target (or one under the camera) the stored heading is kept. D61: a verified re-issue (same image) keeps the stored
    heading, so the saved boxes sit where they were."""
    h = view["heading"]
    if target and not cur.get("same_image") and haversine(cur["lat"], cur["lon"], *target) >= 1.0:
        h = round(bearing_between(cur["lat"], cur["lon"], *target), 1)
    return {**cur, "heading": h, "pitch": view.get("pitch") or 0, "fov": view.get("fov") or 90}


def front_centre(bundle, b):
    """A building's target: the middle of its road-facing wall (the same wall as its position, D33), else its point."""
    from . import frontwall
    got = frontwall.road_edge(bundle, b)
    if got is None:
        return (b["lat"], b["lon"])
    fr, _poly, _lines, edge = got
    m = edge.interpolate(0.5, normalized=True)
    return fr.ll(m.x, m.y)


def camera_of(areas_dir, D, pano_id):
    """where a stored panorama's camera stood ({lat, lon, date}, from any area's panos.json), or None"""
    for slug in sorted(os.listdir(areas_dir)) if os.path.isdir(areas_dir) else []:
        c = D.cameras(slug).get(pano_id)
        if c:
            return c
    return None


def target_of(bundle, kind, obj_id):
    if kind == "building":
        b = next((x for x in bundle["buildings"] if x["id"] == obj_id), None)
        return front_centre(bundle, b) if b else None
    rows = bundle["assets"] if kind == "asset" else bundle.get("unmapped_businesses") or []
    r = next((x for x in rows if x["id"] == obj_id), None)
    return (r["lat"], r["lon"]) if r and r.get("lat") is not None else None


def sign_point(camera, heading, target):
    """A sign's position: on the stored photo's sight line (its heading points at the sign) at the target's distance"""
    d = haversine(camera["lat"], camera["lon"], *target)
    fr = Frame(camera["lat"], camera["lon"])
    h = math.radians(heading)
    return fr.ll(d * math.sin(h), d * math.cos(h))


def annotate(meta, bundle, kind, obj_id, views, lookup=True, same=None):
    """Adds `served` and, for a gone photo, `current` (Google's current photo there aimed at the same target, or null)
    to each evidence view. Target: a building's front-wall centre; a pole / light / business position; a sign view
    aims at the sign itself (on its stored sight line). D61: a verified re-issue (`same` = same_images()) keeps the
    stored heading / pitch / fov and is marked `same_image`, so the browser draws the saved boxes on it."""
    if not views:
        return views
    target = target_of(bundle, kind, obj_id)
    try:
        for v in views:
            s = status(meta, v.get("pano_id"), v.get("camera"), lookup, same)
            v["served"] = s["served"]
            t = sign_point(v["camera"], v["heading"], target) if v.get("key") == "sign" and v.get("camera") and target else target
            v["current"] = aimed(s["current"], v, t) if s["current"] else None
    finally:
        meta.save()
    return views


# ------------------------------------------------------------------ the one-off check (tools/check_photos.py) + Hood
def photo_refs(D, bundle):
    """Every photo the app shows as evidence for this area (the evidence API's own views, so exactly what a user sees):
    [(kind, id, view)]."""
    from . import evidence
    refs = []
    for kind, rows in (("building", bundle["buildings"]), ("asset", bundle["assets"]),
                       ("unmapped", bundle.get("unmapped_businesses") or [])):
        for r in rows:
            for v in evidence.evidence(D, bundle, kind, r["id"]) or []:
                refs.append((kind, r["id"], v))
    return refs


def when(cur, stored_date):
    """'newer' / 'same_month' / 'older' / None: the current photo's capture month against the analysis photo's"""
    a, b = (cur or {}).get("date"), stored_date
    if not (a and b):
        return None
    return "same_month" if a == b else "newer" if a > b else "older"


def gone_panoramas(meta, D, bundle, lookup=True):
    """{retired pano id: {"current": ..., "stored_date": ...}} among this area's evidence photos (D61 spot-check input)"""
    cams = D.cameras(bundle["slug"])
    out = {}
    for _k, _i, v in photo_refs(D, bundle):
        pid = v.get("pano_id")
        if pid in out or not pid:
            continue
        s = status(meta, pid, cams.get(pid), lookup)
        if s["served"] is False:
            out[pid] = {"current": s["current"], "stored_date": (cams.get(pid) or {}).get("date")}
    meta.save()
    return {k: v for k, v in out.items()}


def check_area(meta, D, bundle, lookup=True, same=None):
    """Per-area availability of the stored photos. Counts photo references (an object's evidence photo; one panorama
    can serve several) and distinct panoramas; for gone ones, whether Google's current photo there is newer, and (D61)
    whether it is the verified same image under a new id (`same` = same_images(); `references` lists every gone one)."""
    refs = photo_refs(D, bundle)
    cams = D.cameras(bundle["slug"])
    seen = {}
    for _k, _i, v in refs:
        pid = v.get("pano_id")
        if pid not in seen:
            s = status(meta, pid, cams.get(pid), lookup, same)
            s["when"] = when(s["current"], (cams.get(pid) or {}).get("date"))
            seen[pid] = s
    meta.save()
    by = lambda f: sum(1 for _k, _i, v in refs if f(seen[v.get("pano_id")]))
    gone = lambda s: s["served"] is False
    cur = lambda s: gone(s) and s["current"] is not None
    sam = lambda s: cur(s) and bool(s["current"].get("same_image"))
    panos = list(seen.values())
    references = [{"kind": k, "id": i, "view": v.get("key"), "old_pano": v.get("pano_id"),
                   "new_pano": (seen[v.get("pano_id")]["current"] or {}).get("pano_id"),
                   "same_image": sam(seen[v.get("pano_id")])}
                  for k, i, v in refs if gone(seen[v.get("pano_id")])]
    return {
        "checked": _now().date().isoformat(),
        "photo_refs": len(refs), "served": by(lambda s: s["served"] is True), "gone": by(gone),
        "gone_current_available": by(cur), "gone_current_newer": by(lambda s: cur(s) and s["when"] == "newer"),
        "gone_current_same_month": by(lambda s: cur(s) and s["when"] == "same_month"),
        "unknown": by(lambda s: s["served"] is None),
        "panoramas": len(panos), "panoramas_gone": sum(gone(s) for s in panos),
        "panoramas_gone_current_available": sum(cur(s) for s in panos),
        "max_moved_m": max([s["current"]["moved_m"] for s in panos if cur(s)], default=None),
        "gone_same_image": by(sam), "panoramas_gone_same_image": sum(sam(s) for s in panos),
        "source": "Google Street View metadata (free), by panorama id; for a gone one, by location within "
                  f"{NEAR_RADIUS_M} m of its camera (outdoor)",
        "references": references,
    }


def area_note(areas_dir, slug):
    """Under the Hood's one-line data note, from data/areas/<slug>/photo_check.json (written by tools/check_photos.py)."""
    path = os.path.join(areas_dir, slug, "photo_check.json")
    try:
        with open(path, encoding="utf-8") as f:
            c = json.load(f)
    except (OSError, ValueError):
        return None
    n, g, k = c.get("photo_refs") or 0, c.get("gone") or 0, c.get("gone_current_available") or 0
    if not n:
        return None
    s = c.get("gone_same_image") or 0
    if not g:
        text = f"All {n} analysis photos are still served by Google (checked {c['checked']})."
    elif s:
        # D61: verified re-issues keep their boxes
        rest = g - s
        tail = ("" if not rest else f"; for the other {rest}, " + (
            "Google's current photo taken near the same spot is shown instead, without boxes" if k - s >= rest else
            f"Google's current photo taken near the same spot is shown without boxes where there is one ({k - s})"))
        text = (f"{g} of {n} analysis photos are no longer served under their old Google IDs; {s} of them are the same "
                f"photos under new IDs (checked by re-running the detector) and are shown with their boxes{tail}. "
                f"Checked {c['checked']}.")
    else:
        same = c.get("gone_current_same_month") or 0
        what = ("Google's current photos taken near the same spots are shown instead, without boxes" if k == g else
                f"for {k} of them Google's current photo taken near the same spot is shown instead, without boxes" if k else
                "Google has no current photo near them")
        if k and same == k:
            # D61: same month + a few metres = a neighbouring photo of the same drive, not the old photo under a new ID
            gate = c.get("same_image_restore") or {}
            what += (f" (taken on the same drive, up to {c.get('max_moved_m'):g} m from the analysis cameras: neighbouring "
                     "photos, not the ones the analysis used" if c.get("max_moved_m") is not None else
                     " (taken on the same drive: neighbouring photos, not the ones the analysis used")
            if gate.get("judged"):
                what += (f"; re-running the detector, the saved boxes came back on {gate['passed']} of "
                         f"{gate['judged']} checked panoramas")
            what += ")"
        elif k and c.get("gone_current_newer") == k:
            what += " (newer photos)"
        text = f"{g} of {n} analysis photos are no longer served by Google; {what}. Checked {c['checked']}."
    return {**{k: v for k, v in c.items() if k not in ("references", "same_image")}, "text": text}


def billing(data_dir):
    """D60: what Google actually billed for Street View (data/billing.json, the owner's billing report; account-wide).
    The app's dollar figures stay at Google's global list price; this line says what was billed."""
    try:
        with open(os.path.join(data_dir, "billing.json"), encoding="utf-8") as f:
            return (json.load(f) or {}).get("street_view")
    except (OSError, ValueError):
        return None
