import json
import os
import sys

import pytest
from fastapi.testclient import TestClient

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.main import create_app  # noqa: E402
from app.settings import ROOT, Settings  # noqa: E402

# Unroutable on purpose: simulates Supabase paused/unreachable (port 1 refuses immediately).
BAD_DB_URL = "postgresql://offline_test:not-a-password@127.0.0.1:1/none"
AREAS = ["ward29", "trichy_bharathidasan_salai", "tiruppur_uthukuli_road"]


def raw_export(slug):
    with open(os.path.join(ROOT, "data", "areas", slug, "export.json"), encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def ward29():
    return raw_export("ward29")


@pytest.fixture(scope="session")
def online():
    app = create_app(Settings())
    with TestClient(app) as c:
        if not app.state.data.probe():
            pytest.skip(f"database unreachable ({app.state.data.last_error}) — online tests skipped")
        yield c


@pytest.fixture(scope="session")
def offline():
    with TestClient(create_app(Settings(database_url=BAD_DB_URL))) as c:
        yield c


@pytest.fixture(params=["online", "offline"])
def client(request):
    """Runs a test against the DB and against the JSON fallback: both must give the same answer."""
    return request.getfixturevalue(request.param)


# Review decisions in tests never touch real items (P5): they go to a dedicated test area, a copy of the Tiruppur run
# loaded under its own slug, removed at the end of the session (its review_items go with it; the append-only
# review_events rows stay, all written with reviewer='test').
TEST_AREA = "pytest_review_items"
TEST_REVIEWER = "test"


@pytest.fixture(scope="session")
def review_area(online):
    from app import loader
    D = online.app.state.data
    with D.pool.connection() as c:
        loader.load_area(c, os.path.join(ROOT, "data", "areas", "tiruppur_uthukuli_road"), slug=TEST_AREA)
    D.db.invalidate(TEST_AREA)
    yield TEST_AREA
    with D.pool.connection() as c:
        c.execute("delete from areas where slug = %s", (TEST_AREA,))
    D.db.invalidate()


def real_claimable(c):
    """real (non-test) jobs a worker asking without an id would claim: queued, waiting for keys, or interrupted.
    Tests must never claim those: resetting one loses its start time and stage (it happened to a real Colab job)."""
    return c.execute("""select count(*) from jobs where not is_test and not cancel_requested and (status in ('queued', 'expired_token')
                        or (status = 'running' and (heartbeat_at is null or heartbeat_at < now() - interval '2 minutes')))""").fetchone()[0]
