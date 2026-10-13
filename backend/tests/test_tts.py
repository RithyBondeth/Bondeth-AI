import io
import os

import numpy as np
import pytest
import scipy.io.wavfile
from fastapi.testclient import TestClient

from app.config import get_settings
from app.deps import get_tts_service
from app.main import app
from app.services.tts import NothingToSpeak, TtsService, to_wav_bytes
from app.text.english_normalizer import normalize_english
from app.text.script_split import dominant_lang, split_runs, split_sentences

client = TestClient(app)


# --- Text processing -----------------------------------------------------------------

@pytest.mark.parametrize(
    "text, expected",
    [
        ("$25", "twenty-five dollars"),
        ("$1", "one dollar"),
        ("$25.50", "twenty-five dollars and fifty cents"),
        ("$1,200", "one thousand two hundred dollars"),
        ("20%", "twenty percent"),
        ("3.75", "three point seven five"),
        ("the 1st place", "the first place"),
        ("Room 789", "room seven hundred and eighty-nine"),
        ("4000៛", "four thousand riel"),
    ],
)
def test_normalize_english(text, expected):
    assert normalize_english(text) == expected


def test_dominant_lang():
    assert dominant_lang("សួស្តី hi") == "km"
    assert dominant_lang("hello world សួ") == "en"
    assert dominant_lang("123") == "km"


def test_split_runs_code_switching():
    runs = split_runs("ខ្ញុំប្រើ Facebook រាល់ថ្ងៃ", default="km")
    assert [(r.lang, r.text.strip()) for r in runs] == [
        ("km", "ខ្ញុំប្រើ"), ("en", "Facebook"), ("km", "រាល់ថ្ងៃ"),
    ]


def test_split_runs_skips_whitespace_only():
    assert split_runs("   ", default="km") == []


def test_split_sentences_khmer_and_english():
    assert split_sentences("សួស្តី។ សុខសប្បាយទេ? Fine.\nOk") == ["សួស្តី។", "សុខសប្បាយទេ?", "Fine.", "Ok"]


def test_prepare_routes_each_script_to_its_voice():
    tts = TtsService(get_settings())
    primary, chunks = tts.prepare("តម្លៃ $25 សម្រាប់ iPhone", "auto")
    assert primary == "km"
    assert chunks == [("km", "តម្លៃ ម្ភៃប្រាំដុល្លារ សម្រាប់"), ("en", "iphone")]


def test_prepare_english_primary_reads_numbers_in_english():
    tts = TtsService(get_settings())
    primary, chunks = tts.prepare("It costs $25", "en")
    assert primary == "en"
    assert chunks == [("en", "it costs twenty-five dollars")]


def test_wav_bytes_roundtrip():
    sr, data = scipy.io.wavfile.read(io.BytesIO(to_wav_bytes(np.zeros(1600, dtype=np.float32), 16000)))
    assert sr == 16000 and data.dtype == np.int16 and len(data) == 1600


# --- API (fake model) ----------------------------------------------------------------

class FakeTts(TtsService):
    def __init__(self):
        super().__init__(get_settings())
        self.calls = []

    def synthesize(self, text, lang="auto", speed=1.0):
        self.calls.append((text, lang, speed))
        if text == "!!!":
            raise NothingToSpeak("nothing")
        return np.zeros(8000, dtype=np.float32), 16000


@pytest.fixture
def fake_tts():
    fake = FakeTts()
    app.dependency_overrides[get_tts_service] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


def test_tts_returns_wav(fake_tts):
    res = client.post("/api/v1/tts", json={"text": "សួស្តី", "lang": "km", "speed": 1.2})
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    assert res.headers["x-audio-duration"] == "0.50"
    assert res.content[:4] == b"RIFF"
    assert fake_tts.calls == [("សួស្តី", "km", 1.2)]


def test_tts_validation(fake_tts):
    assert client.post("/api/v1/tts", json={"text": ""}).status_code == 422
    assert client.post("/api/v1/tts", json={"text": "hi", "lang": "fr"}).status_code == 422
    assert client.post("/api/v1/tts", json={"text": "hi", "speed": 5}).status_code == 422


def test_tts_too_long(fake_tts, monkeypatch):
    monkeypatch.setattr(get_settings(), "tts_max_chars", 10)
    assert client.post("/api/v1/tts", json={"text": "x" * 11}).status_code == 413


def test_tts_nothing_to_speak(fake_tts):
    assert client.post("/api/v1/tts", json={"text": "!!!"}).status_code == 422


def test_tts_preview(fake_tts):
    res = client.post("/api/v1/tts/preview", json={"text": "ខ្ញុំប្រើ Facebook"})
    assert res.json() == {
        "primary_lang": "km",
        "chunks": [{"lang": "km", "text": "ខ្ញុំប្រើ"}, {"lang": "en", "text": "facebook"}],
    }


# --- Real models (download ~300 MB on first run) -------------------------------------

@pytest.mark.skipif(not os.getenv("BONDETH_RUN_MODEL_TESTS"), reason="set BONDETH_RUN_MODEL_TESTS=1")
def test_real_tts_bilingual():
    res = client.post("/api/v1/tts", json={"text": "តម្លៃ $25 សម្រាប់ iPhone ថ្មី។"})
    assert res.status_code == 200, res.text
    sr, data = scipy.io.wavfile.read(io.BytesIO(res.content))
    assert sr == 16000
    assert len(data) / sr > 1.0
    assert np.abs(data).max() > 1000  # not silence
