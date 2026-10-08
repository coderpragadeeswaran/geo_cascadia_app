r"""D64: make the app's Ward 29 the re-run (ward29_v2), keeping the previous run as a HIDDEN backup (ward29_v1).

    backend\.venv\Scripts\python tools\switch_ward29.py            # switch
    backend\.venv\Scripts\python tools\switch_ward29.py --rollback # back to the previous run

Switch:   data/areas/ward29 -> ward29_v1 (+ hidden.json)   and   data/areas/ward29_v2 -> ward29 (hidden.json removed;
          meta.area "Ward 29, Coimbatore (v3)", shown as "Ward 29, Coimbatore"). In the database the two area rows are
          renamed the same way in one transaction, so each keeps its own review items and history (the previous run's
          decisions stay with ward29_v1); the re-run's job becomes visible in Jobs. Both areas are then reloaded.
Rollback: the reverse (the re-run goes back to ward29_v2, hidden; its job hidden again).
Code (git) and the server: commit and deploy after either.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "backend"), os.path.join(ROOT, "pipeline")]

from app.db import connect  # noqa: E402
from app.loader import HIDDEN_FILE, load_area  # noqa: E402

AREAS = os.path.join(ROOT, "data", "areas")
NEW_NAME = "Ward 29, Coimbatore (v3)"
RERUN_NAME = "Ward 29, Coimbatore (re-run, Oct 2026)"


def _name(folder, name):
    p = os.path.join(folder, "export.json")
    with open(p, encoding="utf-8") as f:
        exp = json.load(f)
    exp["meta"]["area"] = name
    with open(p, "w", encoding="utf-8") as f:
        json.dump(exp, f)


def _hide(folder, why):
    with open(os.path.join(folder, HIDDEN_FILE), "w", encoding="utf-8") as f:
        json.dump({"hidden": True, "why": why}, f)


def _unhide(folder):
    p = os.path.join(folder, HIDDEN_FILE)
    if os.path.isfile(p):
        os.remove(p)


def move(a, b, c):
    """rename slug a -> b and b's current -> c (files and database), c must be free"""
    pa, pb, pc = (os.path.join(AREAS, s) for s in (a, b, c))
    if os.path.exists(pc):
        raise SystemExit(f"{pc} exists: nothing changed")
    with connect() as conn:
        if conn.execute("select 1 from areas where slug = %s", (c,)).fetchone():
            raise SystemExit(f"{c} exists in the database: nothing changed")
        with conn.transaction():
            conn.execute("update areas set slug = %s where slug = %s", (c, b))
            conn.execute("update areas set slug = %s where slug = %s", (b, a))
    os.rename(pb, pc)
    os.rename(pa, pb)


def reload(*slugs):
    with connect() as conn:
        for s in slugs:
            r = load_area(conn, os.path.join(AREAS, s), slug=s)
            print(s, "reloaded, area_id", r["area_id"])


def job_hidden(slug, hidden):
    with connect() as conn:
        conn.execute("""update jobs set input = jsonb_set(input, '{hidden}', %s::jsonb)
                        where area_id = (select id from areas where slug = %s)""", (json.dumps(hidden), slug))


def main():
    if "--rollback" in sys.argv:
        # ward29 (re-run) -> ward29_v2 (hidden); ward29_v1 -> ward29
        move("ward29_v1", "ward29", "ward29_v2")
        _hide(os.path.join(AREAS, "ward29_v2"), "Ward 29 re-run (D64), rolled back")
        _name(os.path.join(AREAS, "ward29_v2"), RERUN_NAME)
        _unhide(os.path.join(AREAS, "ward29"))
        reload("ward29", "ward29_v2")
        job_hidden("ward29_v2", True)
    else:
        # ward29_v2 -> ward29; ward29 (previous run) -> ward29_v1 (hidden backup)
        move("ward29_v2", "ward29", "ward29_v1")
        _hide(os.path.join(AREAS, "ward29_v1"), "previous Ward 29 run (Sep 2026), kept as a backup after the D64 switch")
        _unhide(os.path.join(AREAS, "ward29"))
        _name(os.path.join(AREAS, "ward29"), NEW_NAME)
        reload("ward29", "ward29_v1")
        job_hidden("ward29", False)
    with connect() as conn:
        for s, h, n in conn.execute("""select slug, hidden, (select count(*) from review_items r where r.area_id = a.id
                                       and r.status <> 'pending') from areas a where slug like 'ward29%%' order by slug"""):
            print(f"{s}: hidden={h}, decided review items={n}")


if __name__ == "__main__":
    main()
