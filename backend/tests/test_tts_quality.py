"""Audio/Khmer phrase regressions: no model downloads required."""
import unicodedata
from types import SimpleNamespace

import numpy as np
import pytest

from app.config import Settings, get_settings
from app.services.tts import TtsService, _limit_length
from app.services.tts_cache import TtsCache


@pytest.mark.parametrize("prefix", range(5))
def test_long_khmer_chunks_do_not_cut_coeng_or_combining_marks(prefix):
    text = "ក" * prefix + "ខ្មែរ" * 150
    chunks = _limit_length(text)
    assert "".join(chunks) == text
    assert all(len(c) <= 400 for c in chunks)
    for left, right in zip(chunks, chunks[1:]):
        assert not left.endswith("្")
        assert not unicodedata.category(right[0]).startswith("M")


def test_normalizes_invisible_word_boundaries_without_fusing_khmer_words():
    tts = TtsService(get_settings())
    assert tts.prepare("\ufeffសួស្តី\u200bខ្មែរ\u200d។", "km")[1] == [("km", "សួស្តី ខ្មែរ។")]


def test_khmer_commas_keep_context_instead_of_overfragmenting_speech():
    assert TtsService(get_settings()).prepare("សូមស្តាប់, បន្ទាប់មកអាន។", "km")[1] == [
        ("km", "សូមស្តាប់, បន្ទាប់មកអាន។")]


class FakeVoice:
    def speak(self, text, speed):
        # Constant, nonzero edges make discontinuities obvious without needing a model.
        return np.full(1600, 0.2, dtype=np.float32)


def service():
    tts = TtsService(get_settings())
    tts.load = lambda lang: FakeVoice()
    return tts


def test_phrase_joins_fade_to_zero():
    tts = service()
    comma, sr = tts.synthesize("សូមស្តាប់, បន្ទាប់មកអាន។", "km")
    sentence, _ = tts.synthesize("សូមស្តាប់។ បន្ទាប់មកអាន។", "km")
    assert len(comma) < len(sentence)
    assert comma[0] == 0 and comma[-1] == 0
    assert sentence[1599] == 0  # no abrupt jump from the first phrase to the pause
    assert np.isfinite(comma).all() and np.max(np.abs(comma)) < 1


def test_quiet_audio_is_not_boosted_to_full_volume():
    tts = service()
    tts.load = lambda lang: SimpleNamespace(speak=lambda text, speed: np.full(1600, 1e-5, dtype=np.float32))
    wave, _ = tts.synthesize("សួស្តី", "km")
    assert np.max(np.abs(wave)) <= 3.01e-5


def test_noise_settings_are_validated_and_invalidate_cache():
    s = get_settings().model_copy()
    cache = TtsCache(None, s)
    key = cache.key([("km", "សួស្តី")], 1)
    s.tts_km_noise_scale_duration = 0.5
    assert cache.key([("km", "សួស្តី")], 1) != key
    with pytest.raises(ValueError):
        Settings(tts_km_noise_scale=-1)


def test_extreme_combining_sequence_is_rejected_instead_of_cut():
    from app.services.tts import NothingToSpeak

    with pytest.raises(NothingToSpeak, match="combining-character"):
        _limit_length("ក" + "ា" * 500)


def test_speed_scales_pause_lengths_as_well_as_the_voice():
    tts = service()
    normal, _ = tts.synthesize("សួស្តី។ អរគុណ។", "km", 1)
    fast, _ = tts.synthesize("សួស្តី។ អរគុណ។", "km", 2)
    assert len(normal) - 3200 == 2 * (len(fast) - 3200)
