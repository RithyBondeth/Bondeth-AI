import asyncio
from datetime import datetime

import pytest
import redis.asyncio

from app.config import get_settings
from app.deps import get_stt_service, get_tts_service
from app.limits import Caller, Limits, QuotaExceeded
from app.main import app
from app.services.tts import NothingToSpeak
from tests.fakes import FakeStt, wav_bytes


class FakeTts:
    engine = "mms"
    def synthesize(self, text, lang="auto", speed=1.0):
        import numpy as np
        if text == "!!!":
            raise NothingToSpeak("nothing")
        return np.zeros(1600, dtype=np.float32), 16000

    def prepare(self, text, lang):
        return "km", [("km", text)]


@pytest.fixture
def fakes(client):
    stt, tts = FakeStt(), FakeTts()
    app.dependency_overrides[get_stt_service] = lambda: stt
    app.dependency_overrides[get_tts_service] = lambda: tts
    return {"stt": stt, "tts": tts}


@pytest.fixture
def settings(monkeypatch):
    s = get_settings()
    return lambda **values: [monkeypatch.setattr(s, k, v) for k, v in values.items()]


def tts(client, text="សួស្តី", headers=None):
    return client.post("/api/v1/tts", json={"text": text}, headers=headers)


def stt(client, audio=b"RIFF....", headers=None):
    return client.post("/api/v1/stt", files={"file": ("a.wav", audio, "audio/wav")}, headers=headers)


def usage(client, headers=None):
    return client.get("/api/v1/usage", headers=headers).json()


# --- Rate limits ---------------------------------------------------------------------

def test_rate_limit_per_endpoint_group(client, fakes, settings):
    settings(rate_limit_anon=2)
    assert [tts(client).status_code for _ in range(2)] == [200, 200]
    res = tts(client)
    assert res.status_code == 429
    assert res.json()["reason"] == "rate_limit"
    assert 1 <= int(res.headers["retry-after"]) <= 60
    assert stt(client).status_code == 200  # other groups have their own budget


def test_signed_in_users_get_their_own_higher_limit(client, fakes, settings, register):
    settings(rate_limit_anon=1, rate_limit_user=3)
    assert tts(client).status_code == 200
    assert tts(client).status_code == 429
    headers = register()
    assert [tts(client, headers=headers).status_code for _ in range(4)] == [200, 200, 200, 429]


def test_preview_uses_the_cheap_limit(client, fakes, settings):
    settings(rate_limit_anon=1, rate_limit_cheap=5)
    codes = [client.post("/api/v1/tts/preview", json={"text": "hi"}).status_code for _ in range(6)]
    assert codes == [200] * 5 + [429]


def test_clone_rate_limit_needs_login_first(client):
    assert client.post("/api/v1/clone", data={"text": "hi"}).status_code == 401


# --- Quotas --------------------------------------------------------------------------

def test_tts_quota_counts_characters(client, fakes, settings):
    settings(quota_tts_chars_anon=10)
    assert tts(client, "x" * 6).status_code == 200
    res = tts(client, "x" * 5)
    assert res.status_code == 429
    assert res.json()["reason"] == "quota"
    assert "only 4 characters" in res.json()["detail"]
    assert "Sign in" in res.json()["detail"]
    assert tts(client, "x" * 4).status_code == 200
    assert usage(client)["quotas"]["tts_chars"] == {"used": 10, "limit": 10, "remaining": 0}


def test_failed_tts_is_refunded(client, fakes):
    assert tts(client, "!!!").status_code == 422
    assert usage(client)["quotas"]["tts_chars"]["used"] == 0


def test_stt_quota_settles_to_transcribed_duration(client, fakes, settings):
    settings(quota_stt_seconds_anon=8)
    assert stt(client).status_code == 200  # no readable header: reserves 0, then bills 5 s
    assert usage(client)["quotas"]["stt_seconds"]["used"] == 5
    assert stt(client).status_code == 200  # 5 + 5 = 10 > 8: the last request may overshoot...
    res = stt(client)  # ...but nothing more is accepted once it's used up
    assert res.status_code == 429
    assert "used today's speech-to-text allowance (8 s)" in res.json()["detail"]
    assert len(fakes["stt"].calls) == 2


def test_stt_rejects_audio_longer_than_whats_left_before_transcribing(client, fakes, settings):
    settings(quota_stt_seconds_anon=4)
    res = stt(client, wav_bytes(5.0))
    assert res.status_code == 429
    assert "needs 5 s" in res.json()["detail"]
    assert fakes["stt"].calls == []
    assert usage(client)["quotas"]["stt_seconds"]["used"] == 0


def test_failed_stt_is_refunded(client, fakes, monkeypatch):
    monkeypatch.setattr(fakes["stt"], "transcribe", lambda path, language=None: 1 / 0)
    assert stt(client, wav_bytes(2.0)).status_code == 422
    assert usage(client)["quotas"]["stt_seconds"]["used"] == 0


def test_quotas_are_per_caller(client, fakes, settings, register):
    settings(quota_tts_chars_anon=3, quota_tts_chars_user=100)
    assert tts(client, "abc").status_code == 200
    assert tts(client, "a").status_code == 429
    headers = register()
    assert tts(client, "abcdef", headers=headers).status_code == 200
    assert usage(client, headers)["quotas"]["tts_chars"]["used"] == 6


def test_disabled_limits_still_count_usage(client, fakes, settings):
    settings(limits_enabled=False, rate_limit_anon=1, quota_tts_chars_anon=1)
    assert [tts(client, "abc").status_code for _ in range(3)] == [200, 200, 200]
    assert usage(client)["quotas"]["tts_chars"] == {"used": 9, "limit": None, "remaining": None}


# --- /usage --------------------------------------------------------------------------

def test_usage_anonymous_and_signed_in(client, register):
    anon = usage(client)
    assert anon["signed_in"] is False
    assert set(anon["quotas"]) == {"stt_seconds", "tts_chars"}  # cloning needs an account
    assert anon["quotas"]["tts_chars"]["limit"] == get_settings().quota_tts_chars_anon
    assert datetime.fromisoformat(anon["resets_at"]).utcoffset().total_seconds() == 7 * 3600

    me = usage(client, register())
    assert me["signed_in"] is True
    assert me["quotas"]["clone_jobs"] == {"used": 0, "limit": get_settings().quota_clone_jobs_user,
                                          "remaining": get_settings().quota_clone_jobs_user}


def test_usage_rejects_a_bad_token(client):
    assert client.get("/api/v1/usage", headers={"Authorization": "Bearer nope"}).status_code == 401


# --- Limits (unit) -------------------------------------------------------------------

def test_day_rolls_over_at_local_midnight(infra):
    caller = Caller("ip:unit-test", False)
    before = datetime.fromisoformat("2026-10-14T16:59:59+00:00").timestamp()  # 23:59:59 in Phnom Penh

    async def run():
        r = redis.asyncio.Redis.from_url(get_settings().redis_url, decode_responses=True)
        try:
            await r.flushdb()
            late = Limits(r, get_settings(), clock=lambda: before)
            assert late.resets_at().isoformat() == "2026-10-15T00:00:00+07:00"
            async with late.spend("tts_chars", caller, get_settings().quota_tts_chars_anon):
                pass
            with pytest.raises(QuotaExceeded) as exc:
                async with late.spend("tts_chars", caller, 1):
                    pass
            assert exc.value.retry_after == 1

            next_day = Limits(r, get_settings(), clock=lambda: before + 1)
            assert await next_day.used("tts_chars", caller) == 0
            async with next_day.spend("tts_chars", caller, 1):
                pass
        finally:
            await r.flushdb()
            await r.aclose()

    asyncio.run(run())
