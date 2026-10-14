import pytest

from app.deps import get_stt_service
from app.main import app
from tests.fakes import FakeStt, wav_bytes


@pytest.fixture
def fake_stt(client):
    app.dependency_overrides[get_stt_service] = lambda: FakeStt()


def transcribe(client, headers=None):
    return client.post("/api/v1/stt", headers=headers or {},
                       files={"file": ("clip.wav", wav_bytes(1.0), "audio/wav")})


def test_anonymous_stt_is_not_saved(client, fake_stt, register):
    res = transcribe(client)
    assert res.status_code == 200
    assert res.json()["transcription_id"] is None
    assert client.get("/api/v1/transcriptions", headers=register()).json()["total"] == 0


def test_signed_in_stt_is_saved_to_history(client, fake_stt, register):
    headers = register()
    saved = transcribe(client, headers).json()
    assert saved["transcription_id"]

    page = client.get("/api/v1/transcriptions", headers=headers).json()
    assert page["total"] == 1
    item = page["items"][0]
    assert item["id"] == saved["transcription_id"]
    assert item["transcribed_text"] == "ខ្ញុំស្រលាញ់ភាសាខ្មែរ"
    assert item["language_code"] == "km" and item["audio_duration_seconds"] == 5.0


def test_bad_token_is_rejected_not_treated_as_anonymous(client, fake_stt):
    assert transcribe(client, {"Authorization": "Bearer garbage"}).status_code == 401


def test_history_pagination_newest_first(client, fake_stt, register):
    headers = register()
    ids = [transcribe(client, headers).json()["transcription_id"] for _ in range(3)]
    page = client.get("/api/v1/transcriptions?limit=2", headers=headers).json()
    assert page["total"] == 3
    assert [i["id"] for i in page["items"]] == ids[::-1][:2]
    rest = client.get("/api/v1/transcriptions?limit=2&offset=2", headers=headers).json()
    assert [i["id"] for i in rest["items"]] == [ids[0]]


def test_history_is_private_and_deletable(client, fake_stt, register):
    alice, bob = register("alice@example.com"), register("bob@example.com")
    tid = transcribe(client, alice).json()["transcription_id"]

    assert client.get("/api/v1/transcriptions", headers=bob).json()["total"] == 0
    assert client.delete(f"/api/v1/transcriptions/{tid}", headers=bob).status_code == 404
    assert client.delete(f"/api/v1/transcriptions/{tid}", headers=alice).status_code == 204
    assert client.get("/api/v1/transcriptions", headers=alice).json()["total"] == 0
    assert client.delete(f"/api/v1/transcriptions/{tid}", headers=alice).status_code == 404


def test_history_requires_login(client):
    assert client.get("/api/v1/transcriptions").status_code == 401
