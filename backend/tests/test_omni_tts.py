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
from app.services.errors import SpeechGenerationError
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


@pytest.mark.parametrize("text,speed", [("សួស្តី", 0.5), ("សួស្តី", 1), ("សួស្តី", 2),
                                       ("អរគុណ។", 2), ("Hi សួស្តី", 2)])
def test_short_khmer_has_absolute_generation_floor_even_at_fast_speeds(omni, monkeypatch, text, speed):
    s, _ = omni
    voice = OmniTts(s)
    calls = []

    def clone(*args, **options):
        calls.append((args, options))
        return np.full(24000, 0.15, dtype=np.float32)

    monkeypatch.setattr(voice.engine, "clone", clone)
    voice.speak(text, None, speed)
    assert len(calls) == 1
    assert calls[0][0] == (text, None, house_path(s), HOUSE_TEXT, speed)
    assert calls[0][1] == {"duration": 3.0}


def test_long_khmer_timing_and_english_estimation_are_unchanged(omni, monkeypatch):
    from app.text.speech_duration import khmer_speech_duration

    s, _ = omni
    voice = OmniTts(s)
    calls = []
    monkeypatch.setattr(voice.engine, "clone", lambda *args, **kw: calls.append(kw) or np.ones(24000))
    text = "យើងនឹងរៀនពីរបៀបប្រើប្រាស់បច្ចេកវិទ្យាសំឡេង ដើម្បីជួយសម្រួលដល់ការរស់នៅប្រចាំថ្ងៃ។"
    voice.speak(text, "km", 1.2)
    voice.speak("Welcome to Bondeth AI.", "en", 1.2)
    assert calls == [{"duration": khmer_speech_duration(text, 1.2)}, {"duration": None}]
    assert calls[0]["duration"] > 3


BAD_AUDIO = [np.array([]), np.zeros(24000), np.full(24000, np.nan),
             np.full(24000, np.inf), np.ones((2, 24000))]


@pytest.mark.parametrize("invalid", BAD_AUDIO, ids=["empty", "silent", "nan", "inf", "not-mono"])
def test_short_khmer_invalid_audio_retries_once_without_changing_text_or_voice(omni, monkeypatch, invalid):
    s, _ = omni
    voice = OmniTts(s)
    calls = []
    good = np.full(24000, 0.15, dtype=np.float32)

    def clone(*args, **options):
        calls.append((args, options))
        return invalid if len(calls) == 1 else good

    monkeypatch.setattr(voice.engine, "clone", clone)
    assert np.array_equal(voice.speak("អរគុណ។", "km", 2), good)
    assert calls[0][0] == calls[1][0] == ("អរគុណ។", "km", house_path(s), HOUSE_TEXT, 2)
    assert [c[1] for c in calls] == [{"duration": 3.0}, {"duration": 4.0}]


@pytest.mark.parametrize("text,attempts", [("សួស្តី", 2), (HOUSE_TEXT, 1), ("Hello", 1)])
def test_invalid_output_is_never_returned_and_retries_are_bounded(omni, monkeypatch, text, attempts):
    s, _ = omni
    voice = OmniTts(s)
    calls = []
    monkeypatch.setattr(voice.engine, "clone", lambda *args, **kw: calls.append(kw) or np.array([]))
    with pytest.raises(SpeechGenerationError, match="retry"):
        voice.speak(text, "km", 1)
    assert len(calls) == attempts


def test_short_timing_policy_invalidates_only_omnivoice_speech_cache(omni, monkeypatch):
    from app.services import omni_tts

    s, _ = omni
    chunks = [("km", "សួស្តី")]
    cache = TtsCache(None, s)
    before = cache.key(chunks, 1)
    reference = house_path(s)
    mms = TtsCache(None, s.model_copy(update={"tts_engine": "mms"}))
    mms_before = mms.key(chunks, 1)
    monkeypatch.setattr(omni_tts, "TTS_GENERATION_VERSION", omni_tts.TTS_GENERATION_VERSION + 1)
    assert cache.key(chunks, 1) != before
    assert mms.key(chunks, 1) == mms_before
    assert house_path(s) == reference  # do not redesign/change the speaker


def test_exhausted_short_tts_returns_503_refunds_and_does_not_cache(client, omni, monkeypatch):
    s, _ = omni
    settings = get_settings()
    for key in ("tts_engine", "tts_omni_voice", "data_dir"):
        monkeypatch.setattr(settings, key, getattr(s, key))
    tts = TtsService(s)
    failed = []
    monkeypatch.setattr(tts._omni().engine, "clone", lambda *a, **kw: failed.append(kw) or np.array([]))
    monkeypatch.setattr(tts, "load", lambda _: SimpleNamespace(speak=lambda *a: np.array([])))
    app.dependency_overrides[get_tts_service] = lambda: tts
    try:
        request = {"text": "សួស្តី", "lang": "km", "speed": 2}
        response = client.post("/api/v1/tts", json=request)
        assert response.status_code == 503 and "retry" in response.json()["detail"]
        assert len(failed) == 2
        assert client.get("/api/v1/usage").json()["quotas"]["tts_chars"]["used"] == 0
        monkeypatch.setattr(tts._omni().engine, "clone", lambda *a, **kw: np.full(24000, 0.15))
        first = client.post("/api/v1/tts", json=request)
        again = client.post("/api/v1/tts", json=request)
        assert first.status_code == again.status_code == 200
        assert (first.headers["x-cache"], again.headers["x-cache"]) == ("MISS", "HIT")
        assert first.content == again.content
    finally:
        app.dependency_overrides.pop(get_tts_service, None)


def test_short_fallback_has_request_scoped_provenance_and_main_voice_is_retried(client, omni, monkeypatch):
    s, _ = omni
    for key in ("tts_engine", "tts_omni_voice", "data_dir"):
        monkeypatch.setattr(get_settings(), key, getattr(s, key))
    tts = TtsService(s)
    calls, mms_calls = [], []
    monkeypatch.setattr(tts._omni().engine, "clone", lambda *a, **kw: calls.append(kw) or np.array([]))
    monkeypatch.setattr(tts, "load", lambda lang: SimpleNamespace(
        speak=lambda text, speed: mms_calls.append((lang, text, speed)) or np.full(16000, 0.1)))
    app.dependency_overrides[get_tts_service] = lambda: tts
    request = {"text": "អរគុណ។", "lang": "km", "speed": 2}
    first = client.post("/api/v1/tts", json=request, headers={"Origin": "http://localhost:3000"})
    assert first.status_code == 200
    assert first.headers["x-tts-engine"] == "mms"
    assert first.headers["x-tts-fallback"] == "short-khmer-omni-failed"
    assert "X-TTS-Fallback" in first.headers["access-control-expose-headers"]
    assert first.headers["x-cache"] == "BYPASS"
    wave, sr = sf.read(io.BytesIO(first.content))
    assert sr == 16000 and wave.size and np.isfinite(wave).all()
    assert mms_calls == [("km", "អរគុណ។", 2)]
    again = client.post("/api/v1/tts", json=request)
    assert again.headers["x-cache"] == "BYPASS" and len(calls) == 4
    assert tts.engine == "omnivoice"  # no singleton state leaks across requests
    used = client.get("/api/v1/usage").json()["quotas"]["tts_chars"]["used"]
    assert used == 2 * len(request["text"])  # one charge per request, not per engine attempt
    monkeypatch.setattr(tts._omni().engine, "clone", lambda *a, **kw: np.full(24000, 0.15))
    recovered = client.post("/api/v1/tts", json=request)
    cached = client.post("/api/v1/tts", json=request)
    assert recovered.headers["x-cache"] == "MISS" and cached.headers["x-cache"] == "HIT"
    for response in (recovered, cached):
        assert response.headers["x-tts-engine"] == "omnivoice"
        assert response.headers["x-tts-fallback"] == "none"
    assert recovered.content == cached.content


@pytest.mark.parametrize("text,lang", [
    (HOUSE_TEXT, "km"), ("សួស្តី Facebook", "km"), ("Hello", "en"),
    ("សួស្តី 你好", "km"), ("សួស្តី", "en"), ("ក" * 41, "km"), ("!!!", "km"),
])
def test_fallback_never_changes_long_mixed_or_non_khmer_voice(omni, monkeypatch, text, lang):
    s, _ = omni
    tts = TtsService(s)
    def fail(*args):
        raise SpeechGenerationError("primary failed")
    monkeypatch.setattr(tts, "synthesize", fail)
    monkeypatch.setattr(tts, "load", lambda _: pytest.fail("Fallback must not load"))
    with pytest.raises(SpeechGenerationError, match="primary failed"):
        tts.synthesize_result(text, lang, 2)


@pytest.mark.parametrize("invalid", BAD_AUDIO + [None])
def test_invalid_mms_fallback_is_never_returned(omni, monkeypatch, invalid):
    s, _ = omni
    tts = TtsService(s)
    monkeypatch.setattr(tts._omni().engine, "clone", lambda *a, **kw: np.array([]))
    monkeypatch.setattr(tts, "load", lambda _: SimpleNamespace(speak=lambda *a: invalid))
    with pytest.raises(SpeechGenerationError, match="Neither voice"):
        tts.synthesize_result("សួស្តី", "auto")


def test_fallback_does_not_mask_engine_or_programming_errors(omni, monkeypatch):
    from app.services.errors import EngineUnavailable
    s, _ = omni
    tts = TtsService(s)
    monkeypatch.setattr(tts, "load", lambda _: pytest.fail("Fallback must not load"))
    for error in (EngineUnavailable("unavailable"), RuntimeError("bug")):
        def fail(*args):
            raise error
        monkeypatch.setattr(tts, "synthesize", fail)
        with pytest.raises(type(error)):
            tts.synthesize_result("សួស្តី", "km")


def test_unavailable_mms_fallback_returns_503_and_refunds(client, omni, monkeypatch):
    s, _ = omni
    tts = TtsService(s)
    monkeypatch.setattr(tts._omni().engine, "clone", lambda *a, **kw: np.array([]))
    def unavailable(*args):
        raise OSError("cached model missing")
    monkeypatch.setattr(tts, "load", unavailable)
    app.dependency_overrides[get_tts_service] = lambda: tts
    result = client.post("/api/v1/tts", json={"text": "សួស្តី", "lang": "km"})
    assert result.status_code == 503 and "fallback voice" in result.json()["detail"]
    assert client.get("/api/v1/usage").json()["quotas"]["tts_chars"]["used"] == 0


def test_concurrent_main_and_fallback_results_do_not_share_voice_metadata(omni, monkeypatch):
    s, _ = omni
    tts = TtsService(s)
    def primary(text, *args):
        if text == "សួស្តី":
            raise SpeechGenerationError("primary failed")
        return np.full(24000, 0.1), 24000
    monkeypatch.setattr(tts, "synthesize", primary)
    monkeypatch.setattr(tts, "load", lambda _: SimpleNamespace(speak=lambda *a: np.full(16000, 0.1)))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda text: tts.synthesize_result(text, "km"), ["សួស្តី", "អរគុណ។"] * 4))
    assert [(r.engine, r.sample_rate, r.fallback) for r in results] == [
        ("mms", 16000, "short-khmer-omni-failed"), ("omnivoice", 24000, "none")
    ] * 4
    assert tts.engine == "omnivoice"
