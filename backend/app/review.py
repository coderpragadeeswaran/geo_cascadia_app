"""Review queue: list (works offline, read-only), decisions (DB only), appeal photos (Supabase Storage, private).

ui-polish-2 (D59): each item is asked as a plain question with Yes / No answers (web/src/lib/reviewQuestions.ts);
Yes = approve (the finding is right), No = reject. A "No" can carry the reviewer's corrected value (floors / use / sign
name) and a note; the value is saved in review_items.corrected with the decision (and in review_events, so Undo restores
it) and is never written over the AI's value or the register."""
import json
from typing import Optional

from psycopg.types.json import Jsonb

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from . import storage, views
from .store import Data

router = APIRouter(tags=["review"])
ACTIONS = {"approve": "approved", "reject": "rejected", "appeal": "appealed"}
# the values a reviewer may correct (D59); uses = the pipeline's building-use values
USES = ("residential", "commercial", "mixed", "institutional", "industrial", "under_construction", "other")


def parse_corrected(raw):
    """the `corrected` form field (JSON) -> a clean dict or None; 422 on anything else. floors: whole number 0-60;
    use: one of USES; name: text, 1-120 characters."""
    if raw is None or not str(raw).strip():
        return None
    try:
        d = json.loads(raw)
    except ValueError:
        raise HTTPException(422, 'corrected must be JSON, e.g. {"floors": 2}')
    if not isinstance(d, dict) or not d:
        raise HTTPException(422, "corrected must be an object with floors, use or name")
    out = {}
    for k, v in d.items():
        if k == "floors":
            if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 60:
                raise HTTPException(422, "corrected floors must be a whole number from 0 to 60")
            out[k] = v
        elif k == "use":
            if v not in USES:
                raise HTTPException(422, f"corrected use must be one of {list(USES)}")
            out[k] = v
        elif k == "name":
            v = str(v or "").strip()
            if not 1 <= len(v) <= 120:
                raise HTTPException(422, "a corrected name must be 1 to 120 characters")
            out[k] = v
        else:
            raise HTTPException(422, f"corrected: unknown field {k!r} (floors, use or name)")
    return out


def get_data(request: Request) -> Data:
    return request.app.state.data


@router.get("/review")
def review_list(area: Optional[str] = None, status: Optional[str] = None,
                item_type: Optional[str] = None, street: Optional[str] = None, priority: Optional[int] = None,
                reason: Optional[str] = None, page: int = 1, page_size: int = 100, D: Data = Depends(get_data)):
    """Review items ordered by priority (1 = most urgent). Filters combine (AND): status, item_type, street, priority and
    reason (one of the pipeline's reason strings). Offline mode lists the export's queue (ids are null)."""
    def fn(s):
        slugs = [area] if area else s.slugs()
        rows = []
        for slug in slugs:
            b = s.bundle(slug)
            if b is None:
                raise HTTPException(404, f"area {slug!r} not found")
            rows += [views.review_row(b, q) for q in b["review_queue"]
                     if (not status or q["status"] == status) and (not item_type or q["item_type"] == item_type)
                     and (not street or q["street"] == street) and (priority is None or q["priority"] == priority)
                     and (not reason or reason in (q.get("reasons") or []))]
        rows.sort(key=lambda r: (r["priority"] if r["priority"] is not None else 99))
        return views.page(rows, page, page_size)
    res, off = D.read(fn)
    return {"offline": off, **res}


def _find(s, item_id):
    with s.pool.connection() as c:
        row = c.execute("select a.slug from review_items r join areas a on a.id = r.area_id where r.id = %s",
                        (item_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"review item {item_id} not found")
    b = s.bundle(row[0])
    item = next((q for q in b["review_queue"] if q["id"] == item_id), None)
    return b, item


@router.get("/review/{item_id}")
def review_item(item_id: int, D: Data = Depends(get_data)):
    """One review item (needs the database: offline items have no ids)."""
    b, item = D.write(lambda s: _find(s, item_id))
    return {"offline": False, **views.review_row(b, item)}


# The decision, its history row (review_events, D24), the object's review_status and the area's new cache version, in ONE
# statement: the history can never miss a change made through the API. `prev` reads the row before the update.
DECIDE_SQL = """
with prev as (select id, area_id, ref_id, status, reviewer, note, appeal_photo_url, corrected from review_items
             where id = %(id)s for update),
r as (
    update review_items r set status = %(status)s, reviewer = %(reviewer)s, note = %(note)s, appeal_photo_url = %(path)s,
           corrected = %(corrected)s, updated_at = now()
    from prev where r.id = prev.id
    returning r.id, r.area_id, r.item_type, r.ref_id, r.status, r.reviewer, r.note, r.appeal_photo_url, r.updated_at, r.corrected),
e as (
    insert into review_events (item_id, area_id, ref_id, action, status, previous_status, previous_reviewer, previous_note,
                               previous_photo, reviewer, note, photo, previous_corrected, corrected)
    select prev.id, prev.area_id, prev.ref_id, %(action)s, r.status, prev.status, prev.reviewer, prev.note,
           prev.appeal_photo_url, r.reviewer, r.note, r.appeal_photo_url, prev.corrected, r.corrected
    from prev join r on r.id = prev.id
    returning id),
b as (update buildings t set review_status = r.status from r where r.item_type = 'building' and t.area_id = r.area_id and t.id = r.ref_id),
s as (update assets t set review_status = r.status from r where r.item_type = 'asset' and t.area_id = r.area_id and t.id = r.ref_id)
select a.slug, r.status, r.reviewer, r.note, r.appeal_photo_url, r.updated_at,
       a.id, a.updated_at, greatest((select max(updated_at) from review_items x where x.area_id = a.id), r.updated_at),
       (select count(*) from review_items x where x.area_id = a.id),
       (select id from e), r.corrected
from r join areas a on a.id = r.area_id
"""

# Undo (review fix 1): restores exactly one item to what it was before exactly one decision (the event in the toast).
# Refused unless that event belongs to that item, is a decision (not an undo), is not undone yet and every later decision
# on the item has been undone (undo steps back one decision at a time, newest first).
UNDO_SQL = """
with ev as (select * from review_events e where id = %(event)s and item_id = %(id)s and action <> 'undo'
             and not exists (select 1 from review_events u where u.undoes = e.id)             -- not undone already
             and not exists (select 1 from review_events x where x.item_id = e.item_id and x.id > e.id  -- no later live decision
                             and x.action <> 'undo' and not exists (select 1 from review_events y where y.undoes = x.id))),
prev as (select i.id, i.area_id, i.ref_id, i.status, i.reviewer, i.note, i.appeal_photo_url, i.corrected
         from review_items i, ev where i.id = %(id)s for update of i),
r as (
    update review_items r set status = ev.previous_status, reviewer = ev.previous_reviewer, note = ev.previous_note,
           appeal_photo_url = ev.previous_photo, corrected = ev.previous_corrected, updated_at = now()
    from prev, ev where r.id = prev.id
    returning r.id, r.area_id, r.item_type, r.ref_id, r.status, r.reviewer, r.note, r.appeal_photo_url, r.updated_at, r.corrected),
e as (
    insert into review_events (item_id, area_id, ref_id, action, status, previous_status, previous_reviewer, previous_note,
                               previous_photo, reviewer, note, undoes, previous_corrected, corrected)
    select prev.id, prev.area_id, prev.ref_id, 'undo', r.status, prev.status, prev.reviewer, prev.note, prev.appeal_photo_url,
           %(reviewer)s, r.note, %(event)s, prev.corrected, r.corrected
    from prev join r on r.id = prev.id
    returning id),
b as (update buildings t set review_status = r.status from r where r.item_type = 'building' and t.area_id = r.area_id and t.id = r.ref_id),
s as (update assets t set review_status = r.status from r where r.item_type = 'asset' and t.area_id = r.area_id and t.id = r.ref_id)
select a.slug, r.status, r.reviewer, r.note, r.appeal_photo_url, r.updated_at,
       a.id, a.updated_at, greatest((select max(updated_at) from review_items x where x.area_id = a.id), r.updated_at),
       (select count(*) from review_items x where x.area_id = a.id),
       (select id from e), r.corrected
from r join areas a on a.id = r.area_id
"""


def _apply(s, item_id, row):
    """Patch the cached area with one written item (no full reload) and return (bundle, queue item, event id)."""
    slug, item = row[0], {"id": item_id, "status": row[1], "reviewer": row[2], "note": row[3],
                          "appeal_photo_path": row[4], "updated_at": row[5].isoformat() if row[5] else None,
                          "corrected": row[11]}
    b = s.patch_review(slug, item, tuple(row[6:10]))
    if b is None:                                            # area not cached yet: load it once
        b, q = _find(s, item_id)
        return b, q, row[10]
    return b, next(q for q in b["review_queue"] if q["id"] == item_id), row[10]


@router.patch("/review/{item_id}")
def review_decide(item_id: int, request: Request, action: str = Form(..., description="approve | reject | appeal"),
                  reviewer: str = Form(..., max_length=120, description="who decided (asked once in the browser, no login)"),
                  note: Optional[str] = Form(None, max_length=2000, description="reject (optional) or appeal (required)"),
                  photo: Optional[UploadFile] = File(None, description="appeal only: jpeg/png/webp, ≤ 8 MB"),
                  corrected: Optional[str] = Form(None, max_length=1000, description='approve / reject: the reviewer\'s '
                                                  'value as JSON, e.g. {"floors": 2} or {"use": "commercial"} or {"name": "…"}'),
                  D: Data = Depends(get_data)):
    """Answer ONE item, saved with the reviewer's name: approve = "Yes" (the finding is right), reject = "No", appeal =
    send back with a note. "No" may carry an optional note; a photo belongs to an appeal only. `corrected` (D59) = the
    reviewer's own value (floors / use / sign name), saved with the decision, never over the AI's value or the register.
    The photo goes to the private Supabase bucket and is read back only through signed URLs. Returns the item and
    `event_id` (its history row), which is what Undo needs. One SQL statement; the cached area is patched in place."""
    if action not in ACTIONS:
        raise HTTPException(422, f"action must be one of {list(ACTIONS)} (to undo, POST /review/{{item_id}}/undo)")
    reviewer = (reviewer or "").strip()
    if not reviewer:
        raise HTTPException(422, "a reviewer name is needed")
    note = (note or "").strip() or None
    has_photo = photo is not None and bool(photo.filename)
    if action == "approve" and note:
        raise HTTPException(422, "a note is saved with a No (reject) or an appeal, not with a Yes")
    if action != "appeal" and has_photo:
        raise HTTPException(422, "a photo is saved only with an appeal")
    fixed = parse_corrected(corrected)
    if fixed and action == "appeal":
        raise HTTPException(422, "a corrected value is saved with Yes or No, not with an appeal")
    if action == "appeal" and not note:
        raise HTTPException(422, "an appeal needs a note")
    content = None
    if has_photo:                                     # checked before anything is uploaded or written
        if photo.content_type not in storage.ALLOWED:
            raise HTTPException(415, "the photo must be a JPEG, PNG or WebP image")
        content = photo.file.read(storage.MAX_BYTES + 1)
        if len(content) > storage.MAX_BYTES:
            raise HTTPException(413, f"the photo is larger than {storage.MAX_BYTES // (1024 * 1024)} MB")
    settings = request.app.state.settings

    def fn(s):
        path = None
        if content is not None:
            b, _ = _find(s, item_id)
            path = storage.upload_photo(settings, b["slug"], item_id, content, photo.content_type)
        with s.pool.connection() as c:
            row = c.execute(DECIDE_SQL, {"status": ACTIONS[action], "action": action, "reviewer": reviewer, "note": note,
                                         "path": path, "id": item_id, "corrected": Jsonb(fixed) if fixed else None}).fetchone()
        if not row:
            raise HTTPException(404, f"review item {item_id} not found")
        return _apply(s, item_id, row)

    b, item, event = D.write(fn)
    return {"offline": False, **views.review_row(b, item), "event_id": event}


class UndoIn(BaseModel):
    item_id: int = Field(description="the review item the toast names (must match the path)")
    event_id: int = Field(description="the decision to undo (event_id returned by the decision)")
    reviewer: Optional[str] = Field(None, max_length=120, description="who pressed Undo (recorded on the undo event)")


@router.post("/review/{item_id}/undo")
def review_undo(item_id: int, body: UndoIn, D: Data = Depends(get_data)):
    """Undo exactly one decision on exactly one item: the item goes back to what it was before that decision (status,
    reviewer, note, photo link, corrected value). Needs the item id twice (path + body) and the decision's event id; refused (409) when
    that decision is not the item's latest event. Nothing else is touched. The undo event records who pressed Undo."""
    if body.item_id != item_id:
        raise HTTPException(422, "item_id in the body must match the item in the path")
    who = (body.reviewer or "").strip() or None

    def fn(s):
        with s.pool.connection() as c:
            row = c.execute(UNDO_SQL, {"id": item_id, "event": body.event_id, "reviewer": who}).fetchone()
            if not row:
                ev = c.execute("select item_id, action from review_events where id = %s", (body.event_id,)).fetchone()
                if not ev or ev[0] != item_id or ev[1] == "undo":
                    raise HTTPException(422, f"event {body.event_id} is not a decision on review item {item_id}")
                raise HTTPException(409, "this decision was already undone, or a later decision on this item must be undone first")
        return _apply(s, item_id, row)

    b, item, event = D.write(fn)
    return {"offline": False, **views.review_row(b, item), "event_id": event}


EVENT_COLS = ("id", "action", "status", "previous_status", "reviewer", "previous_reviewer", "note", "previous_note", "undoes",
              "created_at", "corrected", "previous_corrected")


@router.get("/review/{item_id}/events")
def review_events(item_id: int, D: Data = Depends(get_data)):
    """The item's history (append-only), newest first: who, what, when, and whether it was undone later. `has_photo` = a
    photo was uploaded with this decision (open it with /review/{id}/events/{event_id}/photo, a signed URL)."""
    def fn(s):
        with s.pool.connection() as c:
            rows = c.execute(f"select {', '.join(EVENT_COLS)}, photo is not null from review_events where item_id = %s "
                             "order by id desc", (item_id,)).fetchall()
        out = [{**dict(zip(EVENT_COLS, r[:-1])), "has_photo": r[-1]} for r in rows]
        undone = {e["undoes"]: e["id"] for e in out if e["undoes"]}
        for e in out:
            e["created_at"] = e["created_at"].isoformat() if e["created_at"] else None
            e["undone_by"] = undone.get(e["id"])
        return out
    return {"offline": False, "events": D.write(fn)}


@router.get("/review/{item_id}/events/{event_id}/photo")
def review_event_photo(item_id: int, event_id: int, request: Request, D: Data = Depends(get_data)):
    """Short-lived signed URL (10 min) for the photo uploaded with one decision. The bucket is private."""
    def fn(s):
        with s.pool.connection() as c:
            return c.execute("select photo from review_events where id = %s and item_id = %s", (event_id, item_id)).fetchone()
    row = D.write(fn)
    if not row or not row[0]:
        raise HTTPException(404, "no photo for this decision")
    return {"offline": False, "url": storage.signed_url(request.app.state.settings, row[0]), "expires_in": 600}


@router.get("/review/{item_id}/photo")
def review_photo(item_id: int, request: Request, D: Data = Depends(get_data)):
    """Short-lived signed URL for the appeal photo (bucket is private)."""
    _, item = D.write(lambda s: _find(s, item_id))
    if not item.get("appeal_photo_path"):
        raise HTTPException(404, "no photo for this item")
    return {"offline": False, "url": storage.signed_url(request.app.state.settings, item["appeal_photo_path"]), "expires_in": 600}
