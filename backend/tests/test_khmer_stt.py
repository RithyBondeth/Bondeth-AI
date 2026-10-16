"""Khmer preprocessing/decoding regressions without downloading model weights."""
from types import SimpleNamespace

import numpy as np
import pytest

from app.services.khmer_stt import KhmerWhisperEngine
from scripts.eval_khmer_stt import compare_reports, load_manifest


def test_mel_pads_waveform_with_silence_not_zero_log_features():
    from faster_whisper.feature_extractor import FeatureExtractor

    engine = KhmerWhisperEngine.__new__(KhmerWhisperEngine)
    engine._features = FeatureExtractor(feature_size=128)
    audio = np.sin(np.arange(8_000, dtype=np.float32) * 0.08) * 0.1
    expected = engine._features(np.pad(audio, (0, 480_000 - len(audio))), padding=0)
    actual = engine._mel(audio)
    assert actual.shape == (128, 3_000)
    assert actual.dtype == np.float32
    np.testing.assert_allclose(actual, expected, atol=1e-6)
    assert actual[:, -100:].max() < 0  # log-Mel silence is NOT zero


@pytest.mark.parametrize("seconds", [0, 0.01, 1, 29])
def test_silent_mel_is_fixed_size_and_finite(seconds):
    from faster_whisper.feature_extractor import FeatureExtractor

    engine = KhmerWhisperEngine.__new__(KhmerWhisperEngine)
    engine._features = FeatureExtractor(feature_size=128)
    mel = engine._mel(np.zeros(int(seconds * 16_000), dtype=np.float32))
    assert mel.shape == (128, 3_000)
    assert np.isfinite(mel).all()
    np.testing.assert_allclose(mel, -1.5, atol=1e-6)


@pytest.mark.parametrize("duration", [2, 10, 29])
def test_decoder_budget_survives_ct2_halving_and_keeps_custom_khmer_tokens(monkeypatch, duration):
    import faster_whisper.vad

    monkeypatch.setattr(faster_whisper.vad, "get_speech_timestamps",
                        lambda audio, options: [{"start": 0, "end": len(audio)}])
    engine = KhmerWhisperEngine.__new__(KhmerWhisperEngine)
    engine._prompt = [50258, 50323, 50360, 57907]
    engine._special_ids = {50257, 57907}
    engine._beam_size = 5
    engine._batch_size = 4
    engine._ct2 = SimpleNamespace(StorageView=SimpleNamespace(from_array=lambda x: x))
    engine._mel = lambda audio: np.zeros((128, 3000), dtype=np.float32)
    seen = []

    def generate(features, prompts, **kwargs):
        seen.append(kwargs)
        assert prompts == [engine._prompt]
        return [SimpleNamespace(sequences_ids=[[57907, 54000, 50257]])]

    def decode(ids):
        assert ids == [54000]  # Khmer wordpieces above stock Whisper's EOT are text
        return "ភាសា ខ្មែរ"

    engine._model = SimpleNamespace(generate=generate)
    engine._tokenizer = SimpleNamespace(decode=decode)
    streamed = []
    chunks = engine.transcribe(np.ones(duration * 16000, dtype=np.float32), streamed.append, beam_size=2)
    budget = min(444, 16 + 25 * duration)
    assert seen[0]["max_length"] // 2 == budget
    assert seen[0]["beam_size"] == 2
    assert chunks == streamed
    assert chunks[0].text == "ភាសាខ្មែរ"
    assert chunks[0].end == duration


def test_no_speech_does_not_decode(monkeypatch):
    import faster_whisper.vad

    monkeypatch.setattr(faster_whisper.vad, "get_speech_timestamps", lambda audio, options: [])
    engine = KhmerWhisperEngine.__new__(KhmerWhisperEngine)
    engine._batch_size = 4
    assert engine.transcribe(np.zeros(16000, dtype=np.float32)) == []


def test_mel_rejects_oversized_chunks_instead_of_silently_dropping_audio():
    engine = KhmerWhisperEngine.__new__(KhmerWhisperEngine)
    with pytest.raises(ValueError, match="30 seconds"):
        engine._mel(np.zeros(480_001, dtype=np.float32))


def test_eval_manifest_offsets(tmp_path):
    import json

    (tmp_path / "a.wav").write_bytes(b"first")
    (tmp_path / "b.wav").write_bytes(b"second")
    manifest = tmp_path / "meta.json"
    manifest.write_text(json.dumps([{"file": "a.wav", "transcription": "ក"},
                                    {"file": "b.wav", "transcription": "ខ"}]))
    assert load_manifest(manifest, 1, 1) == [(b"second", "ខ")]


def test_eval_comparison_requires_identical_complete_inputs():
    baseline = {"complete": True, "cer": 0.3, "results": [{"audio_sha256": "abc", "reference": "ខ្មែរ"}]}
    candidate = baseline | {"cer": 0.2}
    assert compare_reports(baseline, candidate)["relative_reduction"] == pytest.approx(1 / 3)
    with pytest.raises(ValueError, match="same audio"):
        compare_reports(baseline, candidate | {"results": [{"audio_sha256": "other", "reference": "ខ្មែរ"}]})
    with pytest.raises(ValueError, match="complete"):
        compare_reports(baseline, candidate | {"complete": False})
