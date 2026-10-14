"""Queued jobs settle their charge when the worker finishes: refunds on failure, corrections for STT."""

import pytest

from app.config import get_settings
from app.deps import get_tts_service
from app.main import app
from tests.test_clone import env, post_clone, wait_for  # noqa: F401  (clone fixture)
from tests.test_limits import FakeTts
from tests.test_stt_jobs import submit, wait_done
from tests.test_stt_jobs import env as stt_env  # noqa: F401


def api_key(client, headers):
    res = client.post("/api/v1/api-keys", headers=headers, json={"name": "bot"})
    assert res.status_code == 201, res.text
    return res.json()


def key_usage(client, headers, key_id):
    days = client.get(f"/api/v1/api-keys/{key_id}/usage", headers=headers).json()
    return days[0] if days else None


def used(client, headers, quota):
    return client.get("/api/v1/usage", headers=headers).json()["quotas"][quota]["used"]


def test_failed_clone_job_is_refunded(client, env, register):
    env["engine"].fail = True
    headers = register()
    job = post_clone(client, headers, reference_text="hi").json()
    assert wait_for(client, headers, job["job_id"])["status"] == "failed"
    assert used(client, headers, "clone_jobs") == 0


def test_failed_clone_job_is_refunded_in_per_key_metering(client, env, register):
    headers = register()
    key = api_key(client, headers)
    as_key = {"X-API-Key": key["key"]}
    ok = post_clone(client, as_key, reference_text="hi").json()
    assert wait_for(client, as_key, ok["job_id"])["status"] == "done"
    env["engine"].fail = True
    bad = post_clone(client, as_key, reference_text="hi").json()
    assert wait_for(client, as_key, bad["job_id"])["status"] == "failed"

    usage = key_usage(client, headers, key["id"])
    assert usage["clone_jobs"] == 1 and usage["requests"] == 2  # both were requests; one job counts
    assert used(client, headers, "clone_jobs") == 1


def test_stt_job_metering_is_settled_to_the_decoded_length(client, stt_env, register):
    headers = register()
    key = api_key(client, headers)
    job = submit(client, {"X-API-Key": key["key"]}, seconds=8.0).json()  # reserves 8 s
    wait_done(client, job["job_id"], headers)
    assert key_usage(client, headers, key["id"])["stt_seconds"] == 5  # the fake decodes 4.2 s
    assert used(client, headers, "stt_seconds") == 5


def test_failed_stt_job_is_refunded_in_per_key_metering(client, stt_env, register):
    stt_env["stt"].fail = True
    headers = register()
    key = api_key(client, headers)
    job = submit(client, {"X-API-Key": key["key"]}).json()
    assert wait_done(client, job["job_id"], headers)["status"] == "failed"
    usage = key_usage(client, headers, key["id"])
    assert usage["stt_seconds"] == 0 and usage["requests"] == 1
    assert used(client, headers, "stt_seconds") == 0


@pytest.fixture
def fake_tts(client):
    app.dependency_overrides[get_tts_service] = lambda: FakeTts()


def test_failed_request_with_a_key_is_not_metered(client, register, fake_tts):
    headers = register()
    key = api_key(client, headers)
    assert client.post("/api/v1/tts", headers={"X-API-Key": key["key"]}, json={"text": "!!!"}).status_code == 422
    usage = key_usage(client, headers, key["id"])
    assert usage is None or (usage["tts_chars"] == 0 and usage["requests"] == 0)


def test_refund_never_resurrects_an_expired_counter(client):
    from app.services.job_billing import JobBilling, JobCharge
    from tests.conftest import sync_redis
    charge = JobCharge(quota="clone_jobs", quota_key="quota:clone_jobs:user:x:2000-01-01", amount=1)
    JobBilling(sync_redis(), get_settings().database_url).settle(charge, 0)
    assert not sync_redis().exists(charge.quota_key) and charge.amount == 0
