"""Database connections from backend/.env (DATABASE_URL). Never prints or logs the URL (it holds the password).

Supabase: session pooler URI (IPv4); PostGIS is in the `extensions` schema, so every connection sets
search_path=public,extensions (docs/DECISIONS.md D6).
"""
import queue
import re
from contextlib import contextmanager

import psycopg

from .settings import Settings


def libpq_url(url):
    if not url:
        raise RuntimeError("DATABASE_URL is not set in backend/.env")
    return re.sub(r"^postgresql\+psycopg://", "postgresql://", url)  # SQLAlchemy-style prefix -> libpq


def database_url():
    return libpq_url(Settings().database_url)


def _configure(conn):
    conn.execute("set search_path = public, extensions")
    conn.execute("set extra_float_digits = 3")   # exact round-trip floats (coordinates must equal the JSON values)
    conn.commit()


def connect(**kw):
    """Single connection (CLI tools). Errors keep only the error class: libpq messages can echo host/user."""
    try:
        conn = psycopg.connect(database_url(), connect_timeout=15, **kw)
    except psycopg.Error as e:
        raise RuntimeError(f"database connection failed ({type(e).__name__})") from None
    _configure(conn)
    return conn


class Pool:
    """Tiny connection pool. A failed connect raises straight away (no waiting for a pool timeout), so the API
    can switch to offline data mode quickly when Supabase is paused or unreachable."""

    def __init__(self, url, size=4, connect_timeout=6):
        self.url, self.connect_timeout = libpq_url(url), connect_timeout
        self.idle = queue.LifoQueue(maxsize=size)

    def _new(self):
        try:
            conn = psycopg.connect(self.url, connect_timeout=self.connect_timeout)
        except psycopg.Error as e:
            raise DbUnavailable(type(e).__name__, reason(e, "connect")) from None
        _configure(conn)
        return conn

    @contextmanager
    def connection(self):
        reused = True
        try:
            conn = self.idle.get_nowait()
            if conn.closed or conn.broken:
                conn, reused = self._new(), False
        except queue.Empty:
            conn, reused = self._new(), False
        ok = False
        try:
            yield conn
            conn.commit()
            ok = True
        except psycopg.OperationalError as e:
            conn.close()
            raise DbUnavailable(type(e).__name__, reason(e, "reused" if reused else "query"), stale=reused) from None
        finally:
            if not ok and not conn.closed:
                conn.rollback()
            if not conn.closed:
                try:
                    self.idle.put_nowait(conn)
                except queue.Full:
                    conn.close()

    def close(self):
        """Close every idle connection (also used to drop stale ones after the pooler cut an idle connection)."""
        while not self.idle.empty():
            try:
                self.idle.get_nowait().close()
            except Exception:
                pass


def reason(err, phase):
    """A short, secret-free cause for the log (libpq messages can echo host / user, so only keywords are kept)."""
    m = str(err).lower()
    if "timeout" in m or "timed out" in m:
        cause = "network timeout"
    elif "could not translate host" in m or "name or service not known" in m or "getaddrinfo" in m:
        cause = "DNS lookup failed (no network?)"
    elif "refused" in m or "unreachable" in m or "no route" in m:
        cause = "network refused / unreachable"
    elif "max client" in m or "too many" in m or "remaining connection slots" in m:
        cause = "Supabase pooler connection limit"
    elif "ssl" in m or "closed" in m or "terminat" in m or "eof" in m or "reset" in m:
        cause = "the server closed the connection (Supabase pooler idle timeout)" if phase == "reused" \
            else "the server closed the connection"
    else:
        cause = "unreachable"
    where = {"connect": "while connecting", "reused": "on a reused idle connection", "query": "during a query"}[phase]
    return f"{type(err).__name__} {where}: {cause}"


class DbUnavailable(RuntimeError):
    """The database cannot be reached (paused, offline, bad URL). Message = error class only, never the URL.
    `reason` = secret-free cause for the log; `stale` = it failed on a reused idle connection (worth one quiet retry)."""

    def __init__(self, msg, reason_text=None, stale=False):
        super().__init__(msg)
        self.reason, self.stale = reason_text or msg, stale
