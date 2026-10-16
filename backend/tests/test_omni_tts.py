import io
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from app.config import get_settings
from app.deps import get_tts_service
from app.main import app
from app.services import voice_clone
from app.services.omni_tts import HOUSE_TEXT, OmniTts, house_path
from app.services.tts import NothingToSpeak, TtsService
from app.services.tts_cache import TtsCache


@pytest.fixture
def omni(monkeypatch, tmp_path):
    calls = []

    class FakeEngine:
        def __init__(self, *args):
            calls.append(("load", args))

        def design(self, text, instruction):
            calls.append(("design", text, instruction))
            return np.full(4 * 24000, 0.15, dtype=np.float32)

        def clone(self, text, lang, ref, transcript, speed, **kwargs):
            calls.append(("speak", text, lang, ref, transcript, speed))
            return np.full(24000, 0.15, dtype=np.float32)

    monkeypatch.setattr(voice_clone, "OmniVoiceEngine", FakeEngine)
    monkeypatch.setattr(voice_clone, "_omni_engines", {})
    settings = get_settings().model_copy(update={"tts_engine": "omnivoice", "data_dir": tmp_path})
    return settings, calls


def test_designs_generic_voice_once_and_reuses_shared_clone_engine(omni):
    s, calls = omni
    tts = TtsService(s)
    text = "សួស្តី។ ខ្ញុំប្រើ Facebook។"
    assert tts.prepare(text, "km") == ("km", [("km", text)])
    wave, sr = tts.synthesize(text, "km", 1.2)
    assert sr == 24000 and len(wave) == 24000
    assert wave[0] == wave[-1] == 0 and np.isfinite(wave).all()
    assert calls[-1][2] is None  # code switching must not force Khmer over English words
    assert calls[-1][4:] == (HOUSE_TEXT, 1.2)
    assert house_path(s).exists()
    TtsService(s).synthesize("អរគុណ។", "km")
    assert len([c for c in calls if c[0] == "design"]) == 1
    assert len([c for c in calls if c[0] == "load"]) == 1
    clone = voice_clone.VoiceCloneService(s, None)
    assert clone.load() is tts._omni().engine
    assert tts.loaded_languages() == ["omnivoice"]


def test_house_identity_and_cache_include_voice_style_and_reference(omni):
    s, _ = omni
    cache = TtsCache(None, s)
    chunks = [("km", "សួស្តី")]
    before = cache.key(chunks, 1)
    OmniTts(s).house_voice()
    after = cache.key(chunks, 1)
    assert before != after
    s.tts_omni_voice = "male, young adult, moderate pitch"
    assert cache.key(chunks, 1) != after


def test_empty_text_does_not_design_a_voice(omni):
    s, calls = omni
    with pytest.raises(NothingToSpeak):
        TtsService(s).synthesize("!!! ...", "km")
    assert calls == []


def test_preload_loads_model_but_does_not_generate_reference(omni):
    s, calls = omni
    TtsService(s).preload()
    assert [c[0] for c in calls] == ["load"]


def test_concurrent_wrappers_only_design_one_reference(omni):
    s, calls = omni
    with ThreadPoolExecutor(max_workers=3) as pool:
        paths = list(pool.map(lambda _: OmniTts(s).house_voice(), range(3)))
    assert len(set(paths)) == 1
    assert [c[0] for c in calls].count("design") == 1


def test_bad_house_audio_is_not_published(omni, monkeypatch):
    s, _ = omni
    voice = OmniTts(s)
    monkeypatch.setattr(voice.engine, "design", lambda *args: np.zeros(96000, dtype=np.float32))
    with pytest.raises(RuntimeError, match="silent"):
        voice.house_voice()
    assert not house_path(s).exists()


def test_real_engine_serializes_design_and_cloning():
    engine = voice_clone.OmniVoiceEngine.__new__(voice_clone.OmniVoiceEngine)
    engine._generation_lock = threading.Lock()
    active = maximum = 0

    def generate(**kwargs):
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        time.sleep(0.01)
        active -= 1
        return [np.zeros(240)]

    engine._model = SimpleNamespace(generate=generate)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda i: engine.design("test", "neutral") if i else engine.clone(
            "test", "km", "/tmp/generated.wav", "test", 1), [0, 1]))
    assert maximum == 1


def test_khmer_timing_budget_preserves_speed_and_does_not_override_english():
    from app.text.speech_duration import khmer_speech_duration

    text = "សួស្តី! ថ្ងៃនេះអាកាសធាតុល្អណាស់។ តើអ្នកសុខសប្បាយទេ?"
    normal = khmer_speech_duration(text)
    assert normal > 3.5  # the earlier inferred 2.5 s dropped the question
    assert khmer_speech_duration(text, 2) == normal / 2
    assert khmer_speech_duration(text * 2) > normal
    assert khmer_speech_duration("Welcome to Bondeth AI.") is None


def test_explicit_tts_duration_is_forwarded_without_changing_clone_default():
    engine = voice_clone.OmniVoiceEngine.__new__(voice_clone.OmniVoiceEngine)
    engine._generation_lock = threading.Lock()
    calls = []

    def generate(**kwargs):
        calls.append(kwargs)
        return [np.zeros(240)]

    engine._model = SimpleNamespace(generate=generate)
    engine.clone("test", "km", "/tmp/generated.wav", "test", 1)
    engine.clone("test", "km", "/tmp/generated.wav", "test", 1, duration=5)
    assert "duration" not in calls[0] and calls[1]["duration"] == 5


def test_omni_endpoint_caches_first_generated_reference(client, omni, monkeypatch):
    s, calls = omni
    original = get_settings()
    monkeypatch.setattr(original, "tts_engine", s.tts_engine)
    monkeypatch.setattr(original, "tts_omni_voice", s.tts_omni_voice)
    monkeypatch.setattr(original, "data_dir", s.data_dir)
    app.dependency_overrides[get_tts_service] = lambda: TtsService(s)
    try:
        first = client.post("/api/v1/tts", json={"text": "សួស្តី", "lang": "km"})
        again = client.post("/api/v1/tts", json={"text": "សួស្តី", "lang": "km"})
        assert first.status_code == 200 and first.content == again.content
        wave, sr = sf.read(io.BytesIO(first.content))
        assert sr == 24000 and wave.size
        assert again.headers["x-cache"] == "HIT"
    finally:
        app.dependency_overrides.pop(get_tts_service, None)
