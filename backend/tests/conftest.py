"""Shared fixtures.

Tests that need PostgreSQL/Redis use the separate `bondeth_test` database and
Redis DB 15 (never development data), wiped before each test. Start them with
`docker compose up -d` from the repo root.
"""

import asyncio
import os
import re
import shutil
import tempfile
from pathlib import Path

# Must be set before the app (and its cached settings) is imported.
os.environ["BONDETH_ENV"] = "test"
os.environ["BONDETH_DATABASE_URL"] = os.environ.get(
    "BONDETH_TEST_DATABASE_URL", "postgresql+asyncpg://bondeth:bondeth@localhost:5432/bondeth_test")
os.environ["BONDETH_REDIS_URL"] = os.environ.get("BONDETH_TEST_REDIS_URL", "redis://localhost:6379/15")
os.environ["BONDETH_DATA_DIR"] = tempfile.mkdtemp(prefix="bondeth-test-data-")
os.environ["BONDETH_CLONE_WORKER_ENABLED"] = "false"  # tests run their own workers with fake engines
os.environ["BONDETH_STT_WORKER_ENABLED"] = "false"

import pytest  # noqa: E402
import redis  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services.email import get_email_sender  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent.parent


async def _run_sql(sql: str) -> None:
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(sql))
    finally:
        await engine.dispose()


async def count_rows(table: str) -> int:
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            return (await conn.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()
    finally:
        await engine.dispose()


def sync_redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True)


@pytest.fixture(scope="session")
def infra():
    """Check PostgreSQL/Redis are up and migrate the test database to the latest schema."""
    try:
        asyncio.run(_run_sql("SELECT 1"))
        sync_redis().ping()
    except Exception as exc:
        pytest.fail(f"PostgreSQL/Redis not reachable ({exc}). Run `docker compose up -d` in the repo root.")

    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", get_settings().database_url)
    command.upgrade(cfg, "head")


@pytest.fixture
def client(infra):
    """A client with the full app lifespan (DB, Redis, queue) on empty test data."""
    asyncio.run(_run_sql("TRUNCATE users, transcriptions, cloned_voices CASCADE"))
    sync_redis().flushdb()
    data_dir = get_settings().data_dir
    shutil.rmtree(data_dir, ignore_errors=True)
    data_dir.mkdir(parents=True)
    outbox = Outbox()
    app.dependency_overrides[get_email_sender] = lambda: outbox
    with TestClient(app) as c:
        c.outbox = outbox
        yield c
    app.dependency_overrides.clear()


class Outbox:
    """Captures emails instead of sending them."""

    def __init__(self):
        self.sent = []

    def send(self, email):
        self.sent.append(email)

    def link_token(self, to: str, path: str) -> str:
        """The token from the latest email to `to` linking to `path` (e.g. "/verify-email")."""
        for email in reversed(self.sent):
            if email.to == to and (m := re.search(rf"{re.escape(path)}\?token=(\S+)", email.body)):
                return m.group(1)
        raise AssertionError(f"no {path} email to {to}")


@pytest.fixture
def register(client):
    """Create an account and return its auth headers: register("a@b.com") -> {"Authorization": ...}.

    The email is verified too (as most tests need the account allowance); pass verify=False to skip.
    """
    def _register(email: str = "user@example.com", password: str = "correct-horse-battery",
                  verify: bool = True) -> dict:
        res = client.post("/api/v1/auth/register", json={"email": email, "password": password})
        assert res.status_code == 201, res.text
        if verify:
            token = client.outbox.link_token(email, "/verify-email")
            assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 200
        return {"Authorization": f"Bearer {res.json()['access_token']}"}
    return _register
