"""Database connection from backend/.env (DATABASE_URL). Never prints or logs the URL (it holds the password).

Supabase: session pooler URI (IPv4); PostGIS is in the `extensions` schema, so every connection sets
search_path=public,extensions (docs/DECISIONS.md D6).
"""
import os
import re

import psycopg
from dotenv import load_dotenv

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BACKEND, ".env"))


def database_url():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is not set in backend/.env")
    return re.sub(r"^postgresql\+psycopg://", "postgresql://", url)  # SQLAlchemy-style prefix -> libpq


def connect(**kw):
    try:
        conn = psycopg.connect(database_url(), connect_timeout=15, **kw)
    except psycopg.Error as e:  # libpq messages can echo the host/user; keep only the error class
        raise RuntimeError(f"database connection failed ({type(e).__name__})") from None
    conn.execute("set search_path = public, extensions")
    return conn
