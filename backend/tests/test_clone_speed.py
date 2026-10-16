import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from app.config import get_settings
from app.services import clone_cache
from app.services.clone_cache import CloneMemoryCache
from app.services.clone_jobs import CloneJob
from app.services.voice_clone import InvalidReference, OmniVoiceEngine, VoiceCloneService
from tests.fakes import FakeEngine, FakeStt


def test_cache_is_byte_and_entry_bounded_lru():
    cache = CloneMemoryCache(2, 5, 30)
    cache.put("a", b"aa", 2)
    cache.put("b", b"bb", 2)
    assert cache.get("a") == b"aa"
    cache.put("c", b"cc", 2)
    assert cache.get("b") is None
    cache.put("d", b"dddd", 4)
    assert cache.get("a") is None and cache.get("c") is None
    assert cache.get("d") == b"dddd"
    cache.put("oversize", b"123456", 6)
    assert cache.get("oversize") is None


def test_cache_expiry_does_not_refresh_on_reads(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(clone_cache.time, "monotonic", lambda: clock[0])
    cache = CloneMemoryCache(2, 100, 10)
    cache.put("a", b"voice", 5)
    clock[0] = 9
    assert cache.get("a") == b"voice"
    clock[0] = 10
    assert cache.get("a") is None and cache._bytes == 0


def test_cache_disabled_and_replacement_accounting():
    cache = CloneMemoryCache(0, 100, 10)
    cache.put("a", 1, 10)
    assert cache.get("a") is None
    cache = CloneMemoryCache(2, 100, 10)
    cache.put("a", 1, 10)
    cache.put("a", 2, 20)
    assert cache._bytes == 20 and cache.get("a") == 2


@pytest.fixture
def clones(tmp_path):
    settings = get_settings().model_copy(update={"clone_engine": "omnivoice", "clone_cache_enabled": True})
    service = VoiceCloneService(settings, FakeStt())
    engine = FakeEngine()
    service._engine = engine
    reference = tmp_path / "saved.wav"
    sr = 24000
    wave = (0.2 * np.sin(np.arange(4 * sr) * 2 * np.pi * 220 / sr)).astype(np.float32)
    sf.write(reference, wave, sr)

    def run(**overrides):
        options = dict(user_id="owner", text="សួស្តី", lang="km", speed=1,
                       reference_path=reference, ref_text="original Khmer words", delete_reference=False)
        options.update(overrides)
        job = CloneJob(work_dir=tmp_path, **options)
        job.work_dir = tmp_path / job.id
        job.work_dir.mkdir()
        service.run(job)
        assert not (job.work_dir / "prepared_reference.wav").exists()
        return job
    return service, engine, reference, run


def test_identical_request_reuses_exact_wav_without_generation(clones):
    _, engine, _, run = clones
    first, second = run(), run()
    assert not first.cache_hit and second.cache_hit
    assert len(engine.calls) == 1 and first.output_path.read_bytes() == second.output_path.read_bytes()
    assert first.duration == second.duration


@pytest.mark.parametrize("change", [
    {"user_id": "other-owner"}, {"voice_id": "different-voice"}, {"ref_text": "corrected transcript"},
    {"text": "different sentence"}, {"lang": "en"}, {"speed": 1.001},
])
def test_identity_inputs_never_share_output(clones, change):
    _, engine, _, run = clones
    run()
    assert not run(**change).cache_hit and len(engine.calls) == 2


@pytest.mark.parametrize("setting,value", [("clone_model_revision", "new-revision"), ("clone_omni_steps", 64),
                                         ("clone_device", "cpu"), ("clone_model", "different-model")])
def test_model_and_quality_settings_invalidate_output(clones, setting, value):
    service, engine, _, run = clones
    run()
    setattr(service._settings, setting, value)
    assert not run().cache_hit and len(engine.calls) == 2


def test_reference_replacement_at_same_path_invalidates_output(clones):
    _, engine, reference, run = clones
    run()
    wave, sr = sf.read(reference)
    sf.write(reference, wave * 0.5, sr)
    assert not run().cache_hit and len(engine.calls) == 2


def test_hit_still_checks_missing_and_silent_references(clones):
    _, _, reference, run = clones
    run()
    wave, sr = sf.read(reference)
    sf.write(reference, np.zeros_like(wave), sr)
    with pytest.raises(InvalidReference, match="silent"):
        run()
    reference.unlink()
    with pytest.raises(InvalidReference, match="no longer available"):
        run()


def test_fresh_take_bypasses_output_reuse_without_reducing_steps(clones):
    service, engine, _, run = clones
    calls = []
    original = engine.clone
    engine.clone = lambda *a, **kw: calls.append(kw) or original(*a, **kw)
    run()
    assert not run(reuse_cached=False).cache_hit
    assert run().cache_hit and len(engine.calls) == 2
    assert all(c == {"num_step": 48, "preprocess_prompt": False} for c in calls)
    service._settings.clone_cache_enabled = False
    assert not run().cache_hit and len(engine.calls) == 3


def test_identical_concurrent_jobs_coalesce_generation(clones):
    _, engine, _, run = clones
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = list(pool.map(lambda _: run(), range(3)))
    assert len(engine.calls) == 1 and sum(j.cache_hit for j in jobs) == 2


def test_failed_generation_is_not_cached(clones):
    _, engine, _, run = clones
    engine.fail = True
    with pytest.raises(RuntimeError):
        run()
    engine.fail = False
    assert not run().cache_hit


def test_prompt_reuse_scopes_content_and_transcript_without_autograd(tmp_path):
    import torch

    reference = tmp_path / "prepared.wav"
    reference.write_bytes(b"original file bytes")
    calls, generated = [], []
    engine = OmniVoiceEngine.__new__(OmniVoiceEngine)
    engine._generation_lock = threading.Lock()
    engine._prompts = CloneMemoryCache(16, 1024 * 1024, 300)

    def create(path, text, **options):
        assert torch.is_inference_mode_enabled()
        calls.append((path, text, options))
        return SimpleNamespace(ref_audio_tokens=torch.zeros((8, 10), dtype=torch.long), ref_text=text)
    def generate(**options):
        generated.append(options)
        return [np.ones(10)]
    engine._model = SimpleNamespace(generate=generate, create_voice_clone_prompt=create)

    def clone(owner="alice", text="original transcript", preprocess=False):
        return engine.clone("target", "km", reference, text, 1, num_step=48,
                            preprocess_prompt=preprocess, cache_scope=owner)
    clone()
    clone()
    assert len(calls) == 1
    assert generated[0]["voice_clone_prompt"] is generated[1]["voice_clone_prompt"]
    assert "ref_audio" not in generated[0] and "ref_text" not in generated[0]
    clone(owner="bob")
    clone(text="corrected transcript")
    clone(preprocess=True)
    reference.write_bytes(b"replacement file bytes")
    clone()
    assert len(calls) == 5
    assert all(g["num_step"] == 48 for g in generated)


def test_legacy_jobs_default_to_reuse_and_serialize_cache_status(tmp_path):
    job = CloneJob(user_id="owner", text="test", lang="km", speed=1, work_dir=tmp_path,
                   reference_path=tmp_path / "reference.wav")
    old = job.to_redis()
    old.pop("reuse_cached")
    old.pop("cache_hit")
    assert CloneJob.from_redis(old).reuse_cached
    assert not CloneJob.from_redis(old).cache_hit
    job.reuse_cached, job.cache_hit = False, True
    restored = CloneJob.from_redis(job.to_redis())
    assert not restored.reuse_cached and restored.cache_hit
