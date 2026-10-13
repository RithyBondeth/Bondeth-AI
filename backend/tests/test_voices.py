import pytest

from app.config import get_settings
from app.deps import get_stt_service
from app.main import app
from tests.fakes import FakeStt, wav_bytes


@pytest.fixture
def stt(client):
    fake = FakeStt()
    app.dependency_overrides[get_stt_service] = lambda: fake
    return fake


def create_voice(client, headers, seconds=5.0, **data):
    form = {"voice_alias": "My voice", "consent": "true", **data}
    return client.post("/api/v1/voices", headers=headers, data=form,
                       files={"reference_audio": ("me.wav", wav_bytes(seconds), "audio/wav")})


def voice_files():
    root = get_settings().data_dir / "voices"
    return sorted(root.rglob("*.wav")) if root.exists() else []


def test_create_voice_transcribes_automatically(client, stt, register):
    res = create_voice(client, register())
    assert res.status_code == 201, res.text
    voice = res.json()
    assert voice["voice_alias"] == "My voice"
    assert voice["reference_text"] == "ខ្ញុំស្រលាញ់ភាសាខ្មែរ"
    assert voice["reference_duration_seconds"] == 5.0
    assert voice["consent_confirmed_at"]
    assert "reference_audio_path" not in voice  # server paths are never exposed
    assert len(stt.calls) == 1 and len(voice_files()) == 1


def test_create_voice_with_provided_transcript_skips_stt(client, stt, register):
    voice = create_voice(client, register(), reference_text="  hello there ").json()
    assert voice["reference_text"] == "hello there"
    assert stt.calls == []


def test_create_voice_requires_login_and_consent(client, stt, register):
    assert create_voice(client, {}).status_code == 401
    assert create_voice(client, register(), consent="false").status_code == 403
    assert voice_files() == []


@pytest.mark.parametrize("seconds", [1.0, 31.0])
def test_create_voice_length_limits(client, stt, register, seconds):
    assert create_voice(client, register(), seconds=seconds).status_code == 422
    assert voice_files() == []


def test_create_voice_without_speech_is_rejected_and_cleaned_up(client, stt, register):
    stt.text = ""
    res = create_voice(client, register())
    assert res.status_code == 422 and "No speech" in res.json()["detail"]
    assert voice_files() == []


def test_voice_limit(client, stt, register, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_voices_per_user", 1)
    headers = register()
    assert create_voice(client, headers).status_code == 201
    assert create_voice(client, headers).status_code == 409


def test_list_get_update_audio_delete(client, stt, register):
    headers = register()
    first = create_voice(client, headers, voice_alias="First").json()
    second = create_voice(client, headers, voice_alias="Second").json()

    listed = client.get("/api/v1/voices", headers=headers).json()
    assert [v["id"] for v in listed] == [second["id"], first["id"]]  # newest first

    url = f"/api/v1/voices/{first['id']}"
    assert client.get(url, headers=headers).json()["voice_alias"] == "First"

    updated = client.patch(url, headers=headers, json={"voice_alias": "Renamed", "reference_text": "fixed"}).json()
    assert (updated["voice_alias"], updated["reference_text"]) == ("Renamed", "fixed")
    assert client.patch(url, headers=headers, json={"voice_alias": ""}).status_code == 422

    audio = client.get(f"{url}/audio", headers=headers)
    assert audio.status_code == 200 and audio.content[:4] == b"RIFF"

    assert client.delete(url, headers=headers).status_code == 204
    assert client.get(url, headers=headers).status_code == 404
    assert len(voice_files()) == 1  # the deleted voice's audio is gone, the other remains


def test_voices_are_private(client, stt, register):
    alice, bob = register("alice@example.com"), register("bob@example.com")
    voice_id = create_voice(client, alice).json()["id"]
    assert client.get("/api/v1/voices", headers=bob).json() == []
    for method, suffix in (("get", ""), ("get", "/audio"), ("delete", ""), ("patch", "")):
        kwargs = {"json": {"voice_alias": "x"}} if method == "patch" else {}
        res = getattr(client, method)(f"/api/v1/voices/{voice_id}{suffix}", headers=bob, **kwargs)
        assert res.status_code == 404, (method, suffix)
    assert client.get(f"/api/v1/voices/{voice_id}", headers=alice).status_code == 200
