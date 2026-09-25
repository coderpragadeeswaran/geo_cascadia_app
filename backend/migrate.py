"""Apply backend/migrations/*.sql in order, once each (tracked in schema_migrations).

Usage (from the repo root):  backend/.venv/Scripts/python backend/migrate.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.db import connect  # noqa: E402

MIGRATIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations")


def main():
    with connect() as conn:
        conn.execute("create table if not exists schema_migrations "
                     "(name text primary key, applied_at timestamptz not null default now())")
        conn.execute("alter table schema_migrations enable row level security")
        done = {r[0] for r in conn.execute("select name from schema_migrations")}
        for name in sorted(f for f in os.listdir(MIGRATIONS) if f.endswith(".sql")):
            if name in done:
                print(f"skip   {name} (already applied)")
                continue
            with open(os.path.join(MIGRATIONS, name), encoding="utf-8") as f:
                sql = f.read()
            with conn.transaction():
                conn.execute(sql)
                conn.execute("insert into schema_migrations (name) values (%s)", (name,))
            print(f"apply  {name}")


if __name__ == "__main__":
    main()
