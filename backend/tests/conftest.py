"""Shared fixtures.

Tests that need PostgreSQL/Redis use the separate `bondeth_test` database and
Redis DB 15 (never development data), wiped before each test. Start them with
`docker compose up -d` from the repo root.
"""

import asyncio
import os
import shutil
import tempfile
from pathlib import Path

# Must be set before the app (and its cached settings) is imported.
os.environ["BONDETH_ENV"] = "test"
os.environ["BONDETH_DATABASE_URL"] = os.environ.get(
    "BONDETH_TEST_DATABASE_URL", "postgresql+asyncpg://bondeth:bondeth@localhost:5432/bondeth_test")
os.environ["BONDETH_REDIS_URL"] = os.environ.get("BONDETH_TEST_REDIS_URL", "redis://localhost:6379/15")
os.environ["BONDETH_DATA_DIR"] = tempfile.mkdtemp(prefix="bondeth-test-data-")
os.environ["BONDETH_CLONE_WORKER_ENABLED"] = "false"  # tests run their own worker with a fake engine

import pytest  # noqa: E402
import redis  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent.parent


async def _run_sql(sql: str) -> None:
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(sql))
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
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def register(client):
    """Create an account and return its auth headers: register("a@b.com") -> {"Authorization": ...}."""
    def _register(email: str = "user@example.com", password: str = "correct-horse-battery") -> dict:
        res = client.post("/api/v1/auth/register", json={"email": email, "password": password})
        assert res.status_code == 201, res.text
        return {"Authorization": f"Bearer {res.json()['access_token']}"}
    return _register
