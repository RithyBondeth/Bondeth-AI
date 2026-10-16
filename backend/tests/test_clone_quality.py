import threading
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from app.config import get_settings
from app.services.clone_jobs import CloneJob
from app.services.voice_clone import InvalidReference, OmniVoiceEngine, VoiceCloneService, load_reference
from tests.fakes import FakeEngine, FakeStt


def write_wave(path, wave, sr=24000):
    sf.write(path, wave, sr, subtype="FLOAT")


def tone(seconds=4, sr=24000):
    t = np.arange(int(seconds * sr)) / sr
    return (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def test_reference_keeps_native_24khz_detail(tmp_path):
    src, dest = tmp_path / "source.wav", tmp_path / "prepared.wav"
    t = np.arange(4 * 24000) / 24000
    # 10 kHz detail cannot survive the previous compulsory 16 kHz conversion.
    write_wave(src, tone() + 0.05 * np.sin(2 * np.pi * 10000 * t))
    load_reference(src, dest, 3, 30)
    wave, sr = sf.read(dest)
    assert sr == 24000
    spectrum = np.abs(np.fft.rfft(wave))
    freq = np.fft.rfftfreq(len(wave), 1 / sr)
    assert spectrum[(freq > 9900) & (freq < 10100)].max() > 100


def test_trim_only_edges_keeps_internal_pauses(tmp_path):
    src, dest = tmp_path / "source.wav", tmp_path / "prepared.wav"
    wave = np.concatenate([np.zeros(24000), tone(2), np.zeros(12000), tone(2), np.zeros(24000)])
    write_wave(src, wave)
    duration = load_reference(src, dest, 3, 30)
    actual, sr = sf.read(dest)
    assert 4.5 <= duration <= 4.9
    # The 0.5s pause remains: do not squeeze out the reference speaker's cadence.
    assert np.count_nonzero(np.abs(actual[int(2.15 * sr):int(2.45 * sr)]) > 1e-5) == 0


@pytest.mark.parametrize("kind", ["silence", "dc", "clipped"])
def test_unusable_reference_is_rejected_even_with_a_supplied_transcript(tmp_path, kind):
    src, dest = tmp_path / "source.wav", tmp_path / "prepared.wav"
    wave = np.zeros(96000) if kind == "silence" else np.full(96000, 0.2)
    if kind == "clipped":
        wave = np.clip(10 * tone(), -1, 1)
    write_wave(src, wave)
    with pytest.raises(InvalidReference):
        load_reference(src, dest, 3, 30)
    assert not dest.exists()


def test_short_usable_content_is_not_hidden_by_silence(tmp_path):
    src, dest = tmp_path / "source.wav", tmp_path / "prepared.wav"
    write_wave(src, np.concatenate([np.zeros(24000), tone(1), np.zeros(24000)]))
    with pytest.raises(InvalidReference, match="usable"):
        load_reference(src, dest, 3, 30)


def test_generation_uses_identity_focused_settings_without_a_designed_voice(tmp_path):
    s = get_settings()
    src = tmp_path / "original.wav"
    write_wave(src, tone())
    original = src.read_bytes()
    calls = []

    class Engine(FakeEngine):
        def clone(self, text, language, ref_audio, ref_text, speed, **options):
            calls.append((ref_audio, sf.info(ref_audio).samplerate, ref_text, options))
            return tone(1)

    service = VoiceCloneService(s, FakeStt())
    service._engine = Engine()
    job = CloneJob(user_id="test", text="សួស្តី", lang="km", speed=1, work_dir=tmp_path,
                   reference_path=src, ref_text="សួស្តី ខ្មែរ", delete_reference=False)
    service.run(job)
    path, sr, transcript, options = calls[0]
    assert sr == 24000 and transcript == "សួស្តី ខ្មែរ"
    assert options["num_step"] == s.clone_omni_steps
    assert options["preprocess_prompt"] is False
    assert "instruct" not in options and "duration" not in options  # retain reference speaker/style/rhythm
    assert src.read_bytes() == original
    assert not path.exists()  # prepared job-local audio is removed, not the saved voice


def test_engine_forwards_reference_fidelity_options():
    engine = OmniVoiceEngine.__new__(OmniVoiceEngine)
    engine._generation_lock = threading.Lock()
    calls = []
    engine._model = SimpleNamespace(generate=lambda **kw: calls.append(kw) or [tone(1)])
    engine.clone("សួស្តី", "km", "/tmp/ref.wav", "original words", 1,
                 num_step=48, preprocess_prompt=False)
    assert calls[0]["num_step"] == 48 and calls[0]["preprocess_prompt"] is False
    assert calls[0]["ref_text"] == "original words" and "instruct" not in calls[0]


@pytest.mark.parametrize("result", [np.zeros(0), np.zeros(24000), np.full(24000, np.nan)])
def test_bad_generated_audio_fails_and_removes_only_prepared_copy(tmp_path, result):
    src = tmp_path / "saved.wav"
    write_wave(src, tone())
    original = src.read_bytes()
    service = VoiceCloneService(get_settings(), FakeStt())
    service._engine = SimpleNamespace(sample_rate=24000, clone=lambda *a, **kw: result)
    job = CloneJob(user_id="test", text="សួស្តី", lang="km", speed=1, work_dir=tmp_path,
                   reference_path=src, ref_text="សួស្តី", delete_reference=False)
    with pytest.raises(RuntimeError, match="invalid audio"):
        service.run(job)
    assert src.read_bytes() == original and not (tmp_path / "prepared_reference.wav").exists()


def test_stereo_high_rate_flac_is_decoded_without_changing_duration(tmp_path):
    src, dest = tmp_path / "stereo.flac", tmp_path / "prepared.wav"
    wave = tone(4, 48000)
    sf.write(src, np.column_stack([wave, wave]), 48000, subtype="PCM_24")
    assert load_reference(src, dest, 3, 30) == pytest.approx(4)
    assert sf.info(dest).channels == 1 and sf.info(dest).samplerate == 24000
