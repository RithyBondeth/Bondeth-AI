"""Source retention is private, bounded and independent of transcript edits."""
import asyncio
import io
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.deps import get_stt_service
from app.main import app
from app.services.stt import Segment, Transcription
from app.services.transcript_audio import TranscriptAudioLibrary, _normalize, save_source_audio, source_audio_path
from tests.fakes import wav_bytes
from tests.test_transcript_editing import seed
from tests.test_stt_jobs import env as stt_env, submit, wait_done  # noqa: F401
from tests.test_live_stt import fake_stt, pcm16, tone, silence  # noqa: F401


@pytest.fixture
def timed(client):
    class Engine:
        def transcribe(self, *args):
            return Transcription('en', .99, 1, 'Hello', 'Hello', [Segment(0, 1, 'Hello')])
    app.dependency_overrides[get_stt_service] = lambda: Engine()


def upload(client, owner=None, keep=True):
    return client.post('/api/v1/stt', headers=owner, data={'keep_source_audio': str(keep).lower()},
                       files={'file': ('private-name.wav', wav_bytes(1), 'audio/wav')})


def test_saved_audio_private_range_playable_and_independently_removable(client, register, timed):
    owner, other = register(), register('other@example.com')
    result = upload(client, owner)
    assert result.status_code == 200, result.text
    url = f"/api/v1/transcriptions/{result.json()['transcription_id']}"
    original = client.get(url, headers=owner).json()
    assert original['source_audio_status'] == 'available'
    audio = client.get(url + '/source-audio', headers=owner)
    assert audio.status_code == 200 and audio.headers['cache-control'] == 'private, no-store'
    assert len(audio.content) == original['source_audio_bytes']
    with wave.open(io.BytesIO(audio.content)) as recording:
        assert (recording.getnchannels(), recording.getsampwidth(), recording.getframerate(), recording.getnframes()) == (1, 2, 16000, 16000)
    ranged = client.get(url + '/source-audio', headers={**owner, 'Range': 'bytes=0-43'})
    assert ranged.status_code == 206 and ranged.content == audio.content[:44]
    for headers, code in [(None, 401), (other, 404)]:
        assert client.get(url + '/source-audio', headers=headers).status_code == code
        assert client.delete(url + '/source-audio', headers=headers).status_code == code
    assert client.delete(url + '/source-audio', headers=owner).status_code == 204
    after = client.get(url, headers=owner).json()
    assert after['revision'] == original['revision'] and after['segments'] == original['segments']
    assert after['source_audio_status'] == 'removed' and after['source_audio_bytes'] is None
    assert client.get(url + '/source-audio', headers=owner).status_code == 404
    assert 'Hello' in client.get(url + '/export?format=srt', headers=owner).text
    assert not list(get_settings().data_dir.glob('transcript_audio/*/*.wav'))


def test_optout_legacy_and_anonymous_retention(client, register, timed):
    assert upload(client).status_code == 401
    owner = register()
    for tid in [upload(client, owner, False).json()['transcription_id'], seed(client, owner)]:
        url = f'/api/v1/transcriptions/{tid}'
        assert client.get(url, headers=owner).json()['source_audio_status'] == 'not_saved'
        assert client.get(url + '/source-audio', headers=owner).status_code == 404
    assert not list(get_settings().data_dir.glob('transcript_audio/*/*.wav'))


def archive(client, owner, tid, path, budget=100000):
    owner_id = uuid.UUID(client.get('/api/v1/auth/me', headers=owner).json()['id'])
    async def run():
        engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
        try:
            async with async_sessionmaker(engine)() as session:
                await save_source_audio(session, get_settings().data_dir, owner_id, uuid.UUID(tid), path, budget, budget)
        finally:
            await engine.dispose()
    asyncio.run(run())


def test_quota_serializes_concurrent_writers_and_removed_audio_is_not_resurrected(client, register, tmp_path):
    owner = register()
    tids = [seed(client, owner), seed(client, owner)]
    source = tmp_path / 'source.wav'; source.write_bytes(wav_bytes(1))
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda tid: archive(client, owner, tid, source, 40000), tids))
    statuses = [client.get(f'/api/v1/transcriptions/{tid}', headers=owner).json()['source_audio_status'] for tid in tids]
    assert sorted(statuses) == ['available', 'storage_full']
    stored, full = tids[statuses.index('available')], tids[statuses.index('storage_full')]
    assert client.delete(f'/api/v1/transcriptions/{stored}/source-audio', headers=owner).status_code == 204
    archive(client, owner, stored, source, 40000)
    assert client.get(f'/api/v1/transcriptions/{stored}', headers=owner).json()['source_audio_status'] == 'removed'
    archive(client, owner, full, source, 40000)
    assert client.get(f'/api/v1/transcriptions/{full}', headers=owner).json()['source_audio_status'] == 'available'
    assert client.delete(f'/api/v1/transcriptions/{full}', headers=owner).status_code == 204
    assert not list(get_settings().data_dir.glob('transcript_audio/*/*.wav'))


def test_storage_decode_and_size_failures_leave_text_usable(client, register, tmp_path):
    owner = register(); tid = seed(client, owner)
    source = tmp_path / 'broken.wav'; source.write_bytes(b'invalid')
    archive(client, owner, tid, source)
    url = f'/api/v1/transcriptions/{tid}'
    assert client.get(url, headers=owner).json()['source_audio_status'] == 'unavailable'
    source.write_bytes(wav_bytes(1))
    archive(client, owner, tid, source, 100)
    doc = client.get(url, headers=owner).json()
    assert doc['source_audio_status'] == 'storage_full' and doc['revision'] == 1
    assert client.get(url + '/export?format=vtt', headers=owner).status_code == 200
    assert not list((get_settings().data_dir / 'transcript_audio' / '.staging').iterdir())


def test_normalization_preserves_silence_and_complete_timeline(tmp_path):
    source, target = tmp_path / 'stereo.wav', tmp_path / 'play.wav'
    with wave.open(str(source), 'wb') as output:
        output.setparams((2, 2, 48000, 0, 'NONE', 'not compressed'))
        output.writeframes(b'\0' * (48000 * 2 * 2 * 2))
    assert _normalize(source, target, 100000) == 64044
    with wave.open(str(target)) as recording:
        assert recording.getnframes() == 32000 and recording.getframerate() == 16000


def test_worker_archives_before_removing_temporary_input(client, register, stt_env):
    owner = register(); cfg = get_settings()
    stt_env['queue']._library = TranscriptAudioLibrary(cfg.database_url, cfg.data_dir, 10, 10)
    job = submit(client, owner, keep_source_audio='true').json()
    done = wait_done(client, job['job_id'], owner)
    assert done['status'] == 'done'
    tid = done['result']['transcription_id']
    assert client.get(f'/api/v1/transcriptions/{tid}', headers=owner).json()['source_audio_status'] == 'available'
    assert client.get(f'/api/v1/transcriptions/{tid}/source-audio', headers=owner).status_code == 200
    assert not stt_env['stt'].calls[0][0].exists()


def test_live_capture_includes_silence_and_is_private(client, register, fake_stt):
    owner = register(); token = owner['Authorization'].split()[1]
    pieces = [silence(.5), tone(1), silence(.8)]
    with client.websocket_connect('/api/v1/stt/live') as ws:
        ws.send_json({'type': 'start', 'language': 'km', 'token': token, 'keep_source_audio': True})
        assert ws.receive_json() == {'type': 'ready'}
        for piece in pieces: ws.send_bytes(pcm16(piece))
        ws.send_json({'type': 'stop'})
        while (done := ws.receive_json())['type'] != 'done':
            assert done['type'] != 'error', done
    url = f"/api/v1/transcriptions/{done['transcription_id']}"
    assert client.get(url, headers=owner).json()['source_audio_status'] == 'available'
    with wave.open(io.BytesIO(client.get(url + '/source-audio', headers=owner).content)) as recording:
        assert recording.getnframes() == int(2.3 * 16000)
    assert client.get(url + '/source-audio').status_code == 401


@pytest.mark.parametrize('flag,reason', [(True, 'auth'), ('true', 'protocol')])
def test_live_retention_requires_auth_and_boolean_flag(client, fake_stt, flag, reason):
    with client.websocket_connect('/api/v1/stt/live') as ws:
        ws.send_json({'type': 'start', 'keep_source_audio': flag})
        error = ws.receive_json()
        assert error['type'] == 'error' and error['reason'] == reason


def test_account_deletion_cleans_recording_and_late_archive_cannot_recreate_it(client, register, timed, tmp_path):
    owner = register()
    tid = upload(client, owner).json()['transcription_id']
    owner_id = uuid.UUID(client.get('/api/v1/auth/me', headers=owner).json()['id'])
    path = source_audio_path(get_settings().data_dir, owner_id, uuid.UUID(tid))
    assert path.is_file()
    assert client.request('DELETE', '/api/v1/auth/me', headers=owner,
                          json={'password': 'correct-horse-battery'}).status_code == 204
    assert not path.parent.exists()
    source = tmp_path / 'late.wav'; source.write_bytes(wav_bytes(1))
    async def late():
        engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
        try:
            async with async_sessionmaker(engine)() as session:
                await save_source_audio(session, get_settings().data_dir, owner_id, uuid.UUID(tid), source, 100000, 100000)
        finally:
            await engine.dispose()
    asyncio.run(late())
    assert not path.parent.exists()


def test_worker_recovery_preserves_edits_and_source_deletion(client, register, stt_env):
    owner = register(); cfg = get_settings(); queue = stt_env['queue']
    queue._library = TranscriptAudioLibrary(cfg.database_url, cfg.data_dir, 10, 10)
    job_id = submit(client, owner, keep_source_audio='true').json()['job_id']
    done = wait_done(client, job_id, owner)
    tid = done['result']['transcription_id']; url = f'/api/v1/transcriptions/{tid}'
    doc = client.get(url, headers=owner).json()
    edited = [{**s, 'text': 'Corrected after recognition'} for s in doc['segments']]
    assert client.patch(url, headers=owner, json={'revision': 1, 'segments': edited}).status_code == 200
    assert client.delete(url + '/source-audio', headers=owner).status_code == 204
    # Replay the durable job after a simulated crash before its terminal record.
    job = queue.get(job_id)
    job.audio_path.parent.mkdir(parents=True, exist_ok=True)
    job.audio_path.write_bytes(wav_bytes(4))
    queue._process(job_id)
    recovered = client.get(url, headers=owner).json()
    assert recovered['revision'] == 2 and recovered['segments'] == edited
    assert recovered['source_audio_status'] == 'removed'
    assert client.get(url + '/source-audio', headers=owner).status_code == 404
    assert not job.audio_path.exists()


def test_disk_failure_does_not_fail_transcription(client, register, timed, monkeypatch):
    owner = register()
    from app.services import transcript_audio
    def full(*args): raise OSError('disk full')
    monkeypatch.setattr(transcript_audio.tempfile, 'mkstemp', full)
    result = upload(client, owner)
    assert result.status_code == 200, result.text
    url = f"/api/v1/transcriptions/{result.json()['transcription_id']}"
    doc = client.get(url, headers=owner).json()
    assert doc['source_audio_status'] == 'unavailable' and doc['transcribed_text'] == 'Hello'
