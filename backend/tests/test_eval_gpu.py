"""The GPU evaluation script's own logic (the models it measures are faked)."""

import numpy as np

from scripts import eval_gpu
from tests.test_live_stt import FakeStt, silence, tone


def test_dictation_simulation_reports_phrase_lag():
    speech = np.concatenate([tone(1.0), silence(0.8), tone(1.0), silence(0.8)])
    result = eval_gpu.simulate_dictation(FakeStt(), speech)
    assert result["phrases"] == 2
    assert 0 <= result["final_lag_median_s"] < 1.5  # the fake model is instant
    assert result["first_partial_s"] is not None
    assert eval_gpu.simulate_dictation(FakeStt(), speech, partials=False)["first_partial_s"] is None


def test_cer_ignores_spacing_and_handles_empty_hypotheses():
    assert eval_gpu.cer(["ខ្ញុំ ស្រលាញ់"], ["ខ្ញុំស្រលាញ់"]) == 0.0
    assert eval_gpu.cer(["abc"], [""]) == 1.0


def test_report_marks_targets_and_skipped_engines():
    report = eval_gpu.Report(environment={"torch": "2", "gpu": "Tesla T4", "vram_gb": 15.6, "peak_vram_gb": 9.1})
    report.add("dictation", {"with previews": {"phrases": 5, "final_lag_median_s": 0.8, "final_lag_p90_s": 1.4,
                                               "first_partial_s": 0.9}})
    report.add("tts:voxcpm", {"engine": "voxcpm", "rtf_median": 0.3, "khmer_round_trip_cer": 0.12, "first_audio_s": 0.6})
    report.add("clone:omnivoice", {"engine": "omnivoice", "skipped": "not installed (omnivoice)"})
    md = eval_gpu.markdown(report)
    assert "Tesla T4" in md and "peak GPU memory 9.1 GB" in md
    assert "| with previews | 5 | 0.8 s | 1.4 s | 0.9 s | ✅ |" in md
    assert "| voxcpm | 0.3 ✅ | 12.0% | 0.6 s ✅ |" in md
    assert "skipped: not installed (omnivoice)" in md
