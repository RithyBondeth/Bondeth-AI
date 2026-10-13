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
from app.services.khmer_stt import clean_khmer_output
from app.services.stt import SttService


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


def test_clean_khmer_output():
    text, segmented = clean_khmer_output("ការ ដើម ឡើយ ; នៅ ភាគ ខាងកើត")
    assert text == "ការដើមឡើយ នៅភាគខាងកើត"
    assert segmented == "ការ ដើម ឡើយ នៅ ភាគ ខាងកើត"


def test_clean_khmer_output_keeps_spaces_around_latin_and_drops_empty_groups():
    text, segmented = clean_khmer_output(" ; ភ្នំ vinson massif ; 4892 ; ម៉ែត្រ ;")
    assert text == "ភ្នំ vinson massif 4892 ម៉ែត្រ"
    assert segmented == "ភ្នំ vinson massif 4892 ម៉ែត្រ"


class _FakeWhisper:
    def __init__(self, probs):
        self.probs = probs

    def detect_language(self, audio):
        return None, None, self.probs


@pytest.mark.parametrize(
    "probs, expected",
    [
        ([("en", 0.99), ("es", 0.01)], ("en", 0.99)),
        ([("vi", 0.28), ("th", 0.10), ("en", 0.05)], ("km", 0.95)),  # how stock Whisper "hears" Khmer
        ([("en", 0.36), ("vi", 0.33)], ("km", 0.64)),  # low-confidence English is still Khmer
        ([("th", 0.9)], ("km", 1.0)),
    ],
)
def test_auto_language_detection(probs, expected):
    stt = SttService(get_settings())
    stt._whisper = _FakeWhisper(probs)
    lang, p = stt._detect(None)
    assert (lang, round(p, 2)) == expected


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


# --- Real model tests (download ~1.6 GB + ~0.8 GB on first run) -----------------------

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


@pytest.mark.skipif(not os.getenv("BONDETH_RUN_MODEL_TESTS"), reason="set BONDETH_RUN_MODEL_TESTS=1")
def test_real_khmer_via_tts_roundtrip():
    """Khmer speech must be detected as Khmer and transcribed in Khmer script.

    Exact words are not asserted: the MMS Khmer voice is not very clear, so this
    round trip is noisy. Accuracy is measured on real speech by scripts/eval_khmer_stt.py.
    """
    speech = client.post("/api/v1/tts", json={"text": "ខ្ញុំស្រលាញ់ភាសាខ្មែរ។", "lang": "km"})
    assert speech.status_code == 200, speech.text
    res = client.post("/api/v1/stt", files={"file": ("km.wav", speech.content, "audio/wav")})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["detected_language"] == "km"
    letters = [ch for ch in body["text"] if not ch.isspace()]
    assert letters and sum("\u1780" <= ch <= "\u17FF" for ch in letters) / len(letters) > 0.9
