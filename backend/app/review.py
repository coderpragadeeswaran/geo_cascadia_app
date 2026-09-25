"""Review queue: list (works offline, read-only), decisions (DB only), appeal photos (Supabase Storage, private)."""
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from . import storage, views
from .store import Data

router = APIRouter(tags=["review"])
ACTIONS = {"approve": "approved", "reject": "rejected", "appeal": "appealed"}


def get_data(request: Request) -> Data:
    return request.app.state.data


@router.get("/review")
def review_list(area: Optional[str] = None, status: Optional[str] = None,
                item_type: Optional[str] = None, street: Optional[str] = None, priority: Optional[int] = None,
                page: int = 1, page_size: int = 100, D: Data = Depends(get_data)):
    """Review items ordered by priority (1 = most urgent). Offline mode lists the export's queue (ids are null)."""
    def fn(s):
        slugs = [area] if area else s.slugs()
        rows = []
        for slug in slugs:
            b = s.bundle(slug)
            if b is None:
                raise HTTPException(404, f"area {slug!r} not found")
            rows += [views.review_row(b, q) for q in b["review_queue"]
                     if (not status or q["status"] == status) and (not item_type or q["item_type"] == item_type)
                     and (not street or q["street"] == street) and (priority is None or q["priority"] == priority)]
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


@router.patch("/review/{item_id}")
def review_decide(item_id: int, request: Request, action: str = Form(..., description="approve | reject | appeal"),
                  note: Optional[str] = Form(None, max_length=2000), reviewer: Optional[str] = Form(None, max_length=120),
                  photo: Optional[UploadFile] = File(None, description="appeal photo (jpeg/png/webp, ≤ 8 MB)"),
                  D: Data = Depends(get_data)):
    """Approve / reject / appeal. Appeals need a note; an optional photo goes to the private Supabase bucket."""
    if action not in ACTIONS:
        raise HTTPException(422, f"action must be one of {list(ACTIONS)}")
    note = (note or "").strip() or None
    if action == "appeal" and not note:
        raise HTTPException(422, "an appeal needs a note")
    settings = request.app.state.settings

    def fn(s):
        b, item = _find(s, item_id)
        path = None
        if photo is not None and photo.filename:
            content = photo.file.read(storage.MAX_BYTES + 1)
            path = storage.upload_photo(settings, b["slug"], item_id, content, photo.content_type)
        status = ACTIONS[action]
        with s.pool.connection() as c:
            c.execute("""update review_items set status = %s, reviewer = coalesce(%s, reviewer), note = coalesce(%s, note),
                                appeal_photo_url = coalesce(%s, appeal_photo_url), updated_at = now() where id = %s""",
                      (status, reviewer, note, path, item_id))
            table = "buildings" if item["item_type"] == "building" else "assets"
            c.execute(f"update {table} t set review_status = %s from areas a where a.id = t.area_id and a.slug = %s "
                      f"and t.id = %s", (status, b["slug"], item["ref_id"]))
        s.invalidate(b["slug"])
        return _find(s, item_id)

    b, item = D.write(fn)
    return {"offline": False, **views.review_row(b, item)}


@router.get("/review/{item_id}/photo")
def review_photo(item_id: int, request: Request, D: Data = Depends(get_data)):
    """Short-lived signed URL for the appeal photo (bucket is private)."""
    _, item = D.write(lambda s: _find(s, item_id))
    if not item.get("appeal_photo_path"):
        raise HTTPException(404, "no photo for this item")
    return {"offline": False, "url": storage.signed_url(request.app.state.settings, item["appeal_photo_path"]), "expires_in": 600}

