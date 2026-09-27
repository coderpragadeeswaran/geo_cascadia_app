"""reset_review_history.py — ONE-TIME clean start for human review (docs/DECISIONS.md D30). Owner-requested, 27 Sep 2026.

What it does, in one database transaction:
  1. disables the append-only trigger on review_events, deletes EVERY row, and re-enables the trigger in the same
     transaction (so history continues normally from the next decision; the trigger is never left off);
  2. sets every review item back to waiting: status 'pending', reviewer / note / appeal photo cleared;
  3. sets buildings.review_status / assets.review_status back to 'pending' for every object in the queue.
Then it deletes every file in the private appeal-photos bucket (Supabase Storage, service key, server side).

Prints counts only (no ids, paths, names or secrets). Refuses to run without --yes.

    backend\\.venv\\Scripts\\python tools\\reset_review_history.py --yes

Afterwards restart the API (or wait ~20 s: its cache re-reads review_items when their updated_at changes).
"""
import argparse
import os
import sys

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
from app.db import connect  # noqa: E402
from app.settings import Settings  # noqa: E402

TRIGGER = "review_events_no_change"


def db_reset():
    with connect() as c:
        with c.transaction():
            events = c.execute("select count(*) from review_events").fetchone()[0]
            c.execute(f"alter table review_events disable trigger {TRIGGER}")
            c.execute("delete from review_events")
            c.execute(f"alter table review_events enable trigger {TRIGGER}")
            items = c.execute("""update review_items set status = 'pending', reviewer = null, note = null, appeal_photo_url = null,
                                 updated_at = now()
                                 where status <> 'pending' or reviewer is not null or note is not null or appeal_photo_url is not null""").rowcount
            objs = 0
            for table, kind in (("buildings", "building"), ("assets", "asset")):
                objs += c.execute(f"""update {table} t set review_status = 'pending' from review_items r
                                      where r.area_id = t.area_id and r.item_type = %s and r.ref_id = t.id
                                      and t.review_status is distinct from 'pending'""", (kind,)).rowcount
        enabled = c.execute("select tgenabled from pg_trigger where tgname = %s", (TRIGGER,)).fetchone()
        total, waiting = c.execute("select count(*), count(*) filter (where status = 'pending' and reviewer is null "
                                   "and note is null and appeal_photo_url is null) from review_items").fetchone()
        left = c.execute("select count(*) from review_events").fetchone()[0]
    return {"events_deleted": events, "items_reset": items, "objects_reset": objs, "events_left": left,
            "trigger_enabled": bool(enabled and enabled[0] == "O"), "items_total": total, "items_waiting_clean": waiting}


def storage_reset(s):
    if not (s.supabase_url and s.supabase_service_key):
        return {"photos_deleted": 0, "note": "storage not configured"}
    h = {"Authorization": f"Bearer {s.supabase_service_key}", "apikey": s.supabase_service_key}
    base = f"{s.supabase_url}/storage/v1/object"

    def ls(prefix):
        out, offset = [], 0
        while True:
            r = httpx.post(f"{base}/list/{s.supabase_bucket}", headers=h, timeout=30,
                           json={"prefix": prefix, "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}})
            if r.status_code >= 300:
                raise SystemExit(f"could not list the bucket (HTTP {r.status_code})")
            page = r.json()
            for o in page:
                path = f"{prefix}/{o['name']}" if prefix else o["name"]
                if o.get("id") is None:          # a folder
                    out += ls(path)
                else:
                    out.append(path)
            if len(page) < 1000:
                return out
            offset += 1000

    files = ls("")
    deleted = 0
    for i in range(0, len(files), 100):
        chunk = files[i:i + 100]
        r = httpx.request("DELETE", f"{base}/{s.supabase_bucket}", headers=h, json={"prefixes": chunk}, timeout=60)
        if r.status_code >= 300:
            raise SystemExit(f"could not delete photos (HTTP {r.status_code})")
        deleted += len(r.json())
    return {"photos_found": len(files), "photos_deleted": deleted, "photos_left": len(ls(""))}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="really reset (irreversible)")
    if not ap.parse_args().yes:
        raise SystemExit("refusing to run without --yes (this deletes all review history and appeal photos)")
    d = db_reset()
    st = storage_reset(Settings())
    for k, v in {**d, **st}.items():
        print(f"{k}: {v}")
    ok = d["trigger_enabled"] and d["events_left"] == 0 and d["items_waiting_clean"] == d["items_total"] and st.get("photos_left", 0) == 0
    print("OK: every review item is waiting, history is empty, trigger is on" if ok else "CHECK FAILED")
    sys.exit(0 if ok else 1)
