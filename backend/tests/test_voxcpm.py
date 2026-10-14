"""VoxCPM2 engine wiring, with a fake model (the real one is 5 GB and wants a GPU)."""

import io
import os
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from app.config import get_settings
from app.deps import get_tts_service
from app.main import app
from app.services import voxcpm
from app.services.tts import NothingToSpeak, TtsService
from app.services.tts_cache import TtsCache
from app.services.voice_clone import VoiceCloneService, VoxCpmCloneEngine
from tests.fakes import FakeStt


class FakeVoxCpmModel:
    def __init__(self):
        self.tts_model = SimpleNamespace(sample_rate=48_000)
        self.calls = []

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return np.full(4_800, 0.1, dtype=np.float32)  # 0.1 s


@pytest.fixture
def fake_model(monkeypatch):
    model = FakeVoxCpmModel()
    monkeypatch.setattr(voxcpm, "load_model", lambda settings: model)
    monkeypatch.setattr(voxcpm, "is_loaded", lambda: True)
    (get_settings().data_dir / "voxcpm" / "house_voice.wav").unlink(missing_ok=True)
    return model


@pytest.fixture
def voxcpm_engines(monkeypatch):
    monkeypatch.setattr(get_settings(), "tts_engine", "voxcpm")
    monkeypatch.setattr(get_settings(), "clone_engine", "voxcpm")


@pytest.mark.parametrize("speed, style", [
    (1.0, ""), (1.2, "(slightly faster pace)"), (1.6, "(fast pace)"), (0.8, "(slightly slower pace)"),
    (0.5, "(slow, unhurried pace)"),
])
def test_speed_becomes_a_style_hint(speed, style):
    assert voxcpm.style_for_speed(speed) == style


def test_clone_uses_reference_and_transcript(fake_model, tmp_path):
    vox = voxcpm.VoxCpm(get_settings())
    ref = tmp_path / "ref.wav"
    vox.clone("សួស្តី", ref, "hello there", speed=1.2)
    vox.clone("hi", ref, None)
    full, ref_only = fake_model.calls
    assert full["text"] == "(slightly faster pace)សួស្តី"
    assert full["reference_wav_path"] == full["prompt_wav_path"] == str(ref)
    assert full["prompt_text"] == "hello there"
    assert full["inference_timesteps"] == get_settings().voxcpm_inference_timesteps
    assert "prompt_wav_path" not in ref_only and ref_only["reference_wav_path"] == str(ref)


def test_house_voice_is_designed_once(fake_model):
    vox = voxcpm.VoxCpm(get_settings())
    path, transcript = vox.house_voice()
    assert path.exists() and transcript == voxcpm.HOUSE_VOICE_SCRIPT
    assert fake_model.calls[0]["text"] == f"({get_settings().voxcpm_house_voice}){voxcpm.HOUSE_VOICE_SCRIPT}"
    assert sf.info(path).samplerate == 48_000
    assert voxcpm.VoxCpm(get_settings()).house_voice()[0] == path
    assert len(fake_model.calls) == 1


def test_tts_keeps_mixed_scripts_together_and_speaks_in_the_house_voice(fake_model, voxcpm_engines):
    tts = TtsService(get_settings())
    primary, chunks = tts.prepare("តម្លៃ $25 សម្រាប់ iPhone។ It's great.", "km")
    assert primary == "km"
    assert chunks == [("km", "តម្លៃ ម្ភៃប្រាំដុល្លារ សម្រាប់ iPhone។"), ("km", "It's great.")]  # casing kept

    wave, sr = tts.synthesize("សួស្តី។ Hello.", "auto", 1.0)
    assert sr == 48_000
    assert len(wave) == 2 * 4_800 + int(0.25 * 48_000)  # two sentences and a pause
    design, *spoken = fake_model.calls
    assert [c["text"] for c in spoken] == ["សួស្តី។", "Hello."]
    house = str(get_settings().data_dir / "voxcpm" / "house_voice.wav")
    assert all(c["reference_wav_path"] == house and c["prompt_text"] == voxcpm.HOUSE_VOICE_SCRIPT for c in spoken)
    assert tts.loaded_languages() == ["voxcpm"]


def test_tts_nothing_to_speak(fake_model, voxcpm_engines):
    with pytest.raises(NothingToSpeak):
        TtsService(get_settings()).synthesize("!!! ...", "auto")
    assert fake_model.calls == []


def test_clone_service_picks_the_voxcpm_engine(fake_model, voxcpm_engines, tmp_path):
    service = VoiceCloneService(get_settings(), FakeStt())
    engine = service.load()
    assert isinstance(engine, VoxCpmCloneEngine) and engine.sample_rate == 48_000
    out = engine.clone("hi", None, tmp_path / "ref.wav", "ref text", 1.0)
    assert len(out) == 4_800 and fake_model.calls[-1]["prompt_text"] == "ref text"


def test_cache_keys_differ_per_engine(monkeypatch):
    cache = TtsCache(None, get_settings())
    chunks = [("km", "សួស្តី")]
    mms = cache.key(chunks, 1.0)
    monkeypatch.setattr(get_settings(), "tts_engine", "voxcpm")
    vox = cache.key(chunks, 1.0)
    monkeypatch.setattr(get_settings(), "voxcpm_house_voice", "A deep male voice")
    assert len({mms, vox, cache.key(chunks, 1.0)}) == 3


def test_tts_endpoint_with_voxcpm(client, fake_model, voxcpm_engines):
    app.dependency_overrides[get_tts_service] = lambda: TtsService(get_settings())
    res = client.post("/api/v1/tts", json={"text": "សួស្តី Bondeth"})
    assert res.status_code == 200
    data, sr = sf.read(io.BytesIO(res.content))
    assert sr == 48_000 and len(data) == 4_800


# --- Real model (downloads ~5 GB; best on a CUDA GPU) ---------------------------------

@pytest.mark.skipif(not os.getenv("BONDETH_RUN_VOXCPM_TESTS"), reason="set BONDETH_RUN_VOXCPM_TESTS=1")
def test_real_voxcpm_khmer(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "data_dir", tmp_path)
    vox = voxcpm.VoxCpm(get_settings())
    ref, ref_text = vox.house_voice()
    wave = vox.clone("សួស្តី ខ្ញុំស្រលាញ់ភាសាខ្មែរ។", ref, ref_text)
    assert vox.sample_rate == 48_000
    assert len(wave) / vox.sample_rate > 1.0 and np.abs(wave).max() > 0.05
