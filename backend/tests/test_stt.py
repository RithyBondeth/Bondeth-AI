import os
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.deps import get_stt_service
from app.main import app
from app.services.stt import Segment, Transcription
from app.text.khmer_segmenter import segment_khmer, segment_words


class FakeStt:
    def __init__(self):
        self.calls = []

    def transcribe(self, path: Path, language=None):
        assert path.exists(), "upload should be on disk during transcription"
        self.calls.append((path, language))
        return Transcription(
            language="km",
            language_probability=0.98,
            duration=1.5,
            text="ខ្ញុំស្រលាញ់ភាសាខ្មែរ",
            segmented_text="ខ្ញុំ ស្រលាញ់ ភាសា ខ្មែរ",
            segments=[Segment(0.0, 1.5, "ខ្ញុំស្រលាញ់ភាសាខ្មែរ")],
        )


@pytest.fixture
def fake_stt():
    fake = FakeStt()
    app.dependency_overrides[get_stt_service] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


client = TestClient(app)


def test_segment_khmer_drops_whitespace_tokens():
    assert segment_words("សួស្តី ពិភពលោក") == ["សួស្តី", "ពិភពលោក"]
    assert segment_khmer("ខ្ញុំស្រលាញ់ភាសាខ្មែរ") == "ខ្ញុំ ស្រលាញ់ ភាសា ខ្មែរ"


def test_stt_success_and_temp_file_cleanup(fake_stt):
    res = client.post("/api/v1/stt", files={"file": ("clip.wav", b"RIFF....", "audio/wav")})
    assert res.status_code == 200
    body = res.json()
    assert body["detected_language"] == "km"
    assert body["segmented_text"] == "ខ្ញុំ ស្រលាញ់ ភាសា ខ្មែរ"
    path, language = fake_stt.calls[0]
    assert language is None  # "auto" -> let Whisper detect
    assert not path.exists()


def test_stt_forced_language(fake_stt):
    client.post("/api/v1/stt", files={"file": ("a.mp3", b"x", "audio/mpeg")}, data={"language": "en"})
    assert fake_stt.calls[0][1] == "en"


def test_stt_rejects_unknown_language(fake_stt):
    res = client.post("/api/v1/stt", files={"file": ("a.wav", b"x")}, data={"language": "fr"})
    assert res.status_code == 422


def test_stt_rejects_bad_extension(fake_stt):
    res = client.post("/api/v1/stt", files={"file": ("notes.txt", b"hello")})
    assert res.status_code == 415
    assert not fake_stt.calls


def test_stt_rejects_empty_file(fake_stt):
    res = client.post("/api/v1/stt", files={"file": ("a.wav", b"")})
    assert res.status_code == 400


def test_stt_rejects_oversized_file(fake_stt, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    res = client.post("/api/v1/stt", files={"file": ("a.wav", b"0" * (1024 * 1024 + 1))})
    assert res.status_code == 413
    assert not fake_stt.calls


# --- Real model test (downloads ~1.6 GB on first run) ---------------------------------

@pytest.mark.skipif(not os.getenv("BONDETH_RUN_MODEL_TESTS"), reason="set BONDETH_RUN_MODEL_TESTS=1")
@pytest.mark.skipif(shutil.which("say") is None, reason="needs macOS `say` to synthesize audio")
def test_real_whisper_english(tmp_path):
    wav = tmp_path / "hello.wav"
    subprocess.run(["say", "-o", str(wav), "--data-format=LEI16@16000",
                    "Hello, this is a test of Bondeth AI."], check=True)
    with wav.open("rb") as f:
        res = client.post("/api/v1/stt", files={"file": ("hello.wav", f, "audio/wav")})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["detected_language"] == "en"
    assert "test" in body["text"].lower()
