import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import ValidationError
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.api.v1.transcriptions import TranscriptSegment
from app.config import get_settings
from app.db import Transcription
from app.deps import get_stt_service
from app.main import app
from app.services.stt import Segment, Transcription as SttTranscription
from app.services.subtitles import subtitle_text, timestamp
from tests.fakes import wav_bytes
from tests.test_stt_jobs import env as stt_env, submit, wait_done, read_events  # noqa: F401

SEGMENTS = [{"start": 0.125, "end": 1.999, "text": "សួស្តី"},
            {"start": 2.0, "end": 4.2, "text": "Hello world"}]


def seed(client, owner, segments=SEGMENTS, text="សួស្តី Hello world"):
    user_id = uuid.UUID(client.get("/api/v1/auth/me", headers=owner).json()["id"])
    async def create():
        engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
        try:
            async with engine.begin() as conn:
                return str(await conn.scalar(insert(Transcription).values(
                    user_id=user_id, language_code="km", transcribed_text=text,
                    audio_duration_seconds=4.2, segments=segments, segmented_text="សួស្តី Hello world",
                ).returning(Transcription.id)))
        finally:
            await engine.dispose()
    return asyncio.run(create())


def test_read_edit_export_and_search_share_the_saved_revision(client, register):
    owner = register()
    tid = seed(client, owner)
    url = f"/api/v1/transcriptions/{tid}"
    original = client.get(url, headers=owner).json()
    assert original["segments"] == SEGMENTS and original["revision"] == 1 and original["updated_at"] is None
    segments = [{**SEGMENTS[0], "text": "សួស្តី បណ្ឌិត"}, SEGMENTS[1]]
    result = client.patch(url, headers=owner, json={"revision": 1, "segments": segments})
    assert result.status_code == 200, result.text
    edited = result.json()
    assert edited["transcribed_text"] == "សួស្តី បណ្ឌិត Hello world"
    assert edited["segments"] == segments and edited["revision"] == 2 and edited["updated_at"]
    assert edited["segmented_text"] is None
    assert client.get(url, headers=owner).json() == edited
    assert client.get("/api/v1/transcriptions?q=បណ្ឌិត", headers=owner).json()["total"] == 1
    exported = client.get(url + "/export?format=srt", headers=owner)
    assert exported.status_code == 200
    assert exported.text == "1\n00:00:00,125 --> 00:00:01,999\nសួស្តី បណ្ឌិត\n\n2\n00:00:02,000 --> 00:00:04,200\nHello world\n"
    assert exported.headers["cache-control"] == "private, no-store"
    assert ".srt" in exported.headers["content-disposition"]
    vtt = client.get(url + "/export?format=vtt", headers=owner)
    assert vtt.text == "WEBVTT\n\n" + exported.text.replace(",125", ".125").replace(",999", ".999").replace(",000", ".000").replace(",200", ".200")
    assert vtt.headers["content-type"].startswith("text/vtt")


def test_revision_prevents_lost_updates_and_repeated_identical_saves_are_idempotent(client, register):
    owner = register()
    url = f"/api/v1/transcriptions/{seed(client, owner)}"
    first = {"revision": 1, "segments": [{**SEGMENTS[0], "text": "First editor"}, SEGMENTS[1]]}
    assert client.patch(url, headers=owner, json=first).json()["revision"] == 2
    assert client.patch(url, headers=owner, json=first).json()["revision"] == 2
    stale = {**first, "segments": [{**SEGMENTS[0], "text": "Stale editor"}, SEGMENTS[1]]}
    assert client.patch(url, headers=owner, json=stale).status_code == 409
    assert client.get(url, headers=owner).json()["segments"][0]["text"] == "First editor"
    assert client.patch(url, headers=owner, json={**stale, "revision": 2}).json()["revision"] == 3


def test_concurrent_writers_cannot_both_replace_the_same_revision(client, register):
    owner = register()
    url = f"/api/v1/transcriptions/{seed(client, owner)}"
    def write(text):
        return client.patch(url, headers=owner, json={"revision": 1,
                            "segments": [{**SEGMENTS[0], "text": text}, SEGMENTS[1]]})
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(write, ["Editor A", "Editor B"]))
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert client.get(url, headers=owner).json()["revision"] == 2


def test_documents_edits_and_exports_are_private(client, register):
    owner, other = register(), register("other@example.com")
    url = f"/api/v1/transcriptions/{seed(client, owner)}"
    for headers, status in [(None, 401), (other, 404)]:
        assert client.get(url, headers=headers).status_code == status
        assert client.patch(url, headers=headers, json={"revision": 1, "segments": SEGMENTS}).status_code == status
        assert client.get(url + "/export?format=vtt", headers=headers).status_code == status


def test_legacy_transcripts_can_be_edited_without_inventing_timestamps(client, register):
    owner = register()
    url = f"/api/v1/transcriptions/{seed(client, owner, segments=None)}"
    edited = client.patch(url, headers=owner, json={"revision": 1, "text": "Updated legacy ខ្មែរ"}).json()
    assert edited["transcribed_text"] == "Updated legacy ខ្មែរ" and edited["segments"] is None
    assert client.get(url + "/export?format=txt", headers=owner).text == "Updated legacy ខ្មែរ"
    assert client.get(url + "/export?format=srt", headers=owner).status_code == 422
    assert client.get(url + "/export?format=vtt", headers=owner).status_code == 422
    assert client.get(url + "/export?format=pdf", headers=owner).status_code == 422


@pytest.mark.parametrize("edit", [
    {"text": "Cannot detach timed text"}, {"segments": []}, {"segments": [{"start": -1, "end": 1, "text": "a"}]},
    {"segments": [{"start": 1, "end": 1, "text": "a"}]}, {"segments": [{"start": 1, "end": 1.0001, "text": "a"}]},
    {"segments": [{"start": 0, "end": 5, "text": "beyond duration"}]},
    {"segments": SEGMENTS[::-1]}, {"segments": [{"start": "Infinity", "end": 2, "text": "a"}]},
    {"segments": [{"start": 0, "end": 2, "text": "bad\x00text"}]}, {"text": "a", "segments": SEGMENTS},
    {"segments": [{**SEGMENTS[0], "text": "a" * 10001}]}, {}, {"text": None}, {"revision": 0, "segments": SEGMENTS},
])
def test_invalid_edits_do_not_change_the_saved_document(client, register, edit):
    owner = register()
    url = f"/api/v1/transcriptions/{seed(client, owner)}"
    result = client.patch(url, headers=owner, json={"revision": 1, **edit})
    assert result.status_code == 422, result.text
    assert client.get(url, headers=owner).json()["revision"] == 1


def test_empty_cues_are_retained_for_editing_but_not_exported(client, register):
    owner = register()
    url = f"/api/v1/transcriptions/{seed(client, owner)}"
    blank_first = [{**SEGMENTS[0], "text": ""}, SEGMENTS[1]]
    result = client.patch(url, headers=owner, json={"revision": 1, "segments": blank_first}).json()
    assert result["transcribed_text"] == "Hello world" and result["segments"] == blank_first
    assert client.get(url + "/export?format=srt", headers=owner).text == "1\n00:00:02,000 --> 00:00:04,200\nHello world\n"
    blank = [{**s, "text": ""} for s in SEGMENTS]
    assert client.patch(url, headers=owner, json={"revision": 2, "segments": blank}).json()["transcribed_text"] == ""
    assert client.get(url + "/export?format=vtt", headers=owner).status_code == 422


def test_sync_stt_persists_timing_and_word_boundaries(client, register):
    class TimedStt:
        def transcribe(self, *args):
            return SttTranscription("km", 0.99, 4.2, "សួស្តី Hello world", "សួស្តី Hello world", [Segment(**s) for s in SEGMENTS])
    app.dependency_overrides[get_stt_service] = lambda: TimedStt()
    owner = register()
    result = client.post("/api/v1/stt", headers=owner, files={"file": ("voice.wav", wav_bytes(1), "audio/wav")}).json()
    detail = client.get(f"/api/v1/transcriptions/{result['transcription_id']}", headers=owner).json()
    assert detail["segments"] == SEGMENTS and detail["segmented_text"] == "សួស្តី Hello world"


def test_queued_history_keeps_segments_and_replays_do_not_overwrite_edits(client, register, stt_env):
    owner = register()
    job = submit(client, owner).json()
    done = wait_done(client, job["job_id"], owner)
    url = f"/api/v1/transcriptions/{done['result']['transcription_id']}"
    detail = client.get(url, headers=owner).json()
    assert detail["segments"] == done["result"]["segments"]
    corrected = [{**s, "text": "Corrected"} for s in detail["segments"]]
    assert client.patch(url, headers=owner, json={"revision": 1, "segments": corrected}).status_code == 200
    read_events(client, job["events_url"], owner)
    wait_done(client, job["job_id"], owner)
    assert client.get(url, headers=owner).json()["segments"] == corrected


def test_subtitle_serialization_rounds_with_carry_and_escapes_literal_text():
    assert timestamp(59.9996, ",") == "00:01:00,000"
    assert timestamp(3599.9996) == "01:00:00.000"
    segments = [{"start": 3600.001, "end": 3602.25, "text": "ខ្មែរ & <b>literal</b> -->\r\n\r\nnext line"}]
    expected = "1\n01:00:00.001 --> 01:00:02.250\nខ្មែរ &amp; &lt;b&gt;literal&lt;/b&gt; --&gt;\nnext line\n"
    assert subtitle_text(segments, "vtt") == "WEBVTT\n\n" + expected
    assert subtitle_text(segments, "srt") == expected.replace("00.001", "00,001").replace("02.250", "02,250")
    for invalid in (float("inf"), float("nan")):
        with pytest.raises(ValidationError):
            TranscriptSegment(start=invalid, end=2, text="bad")
