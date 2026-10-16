# Local voice checks

Run infrastructure with `docker compose up -d`, then start the backend from
`backend/` with `.venv/bin/uvicorn app.main:app --env-file ../.env --host 127.0.0.1 --port 8000`.
Run `npm run dev` from `frontend/` and open `http://localhost:3000`.

For the installed local engines, use these backend `.env` settings:

```dotenv
BONDETH_TTS_ENGINE=omnivoice
BONDETH_TTS_OMNI_VOICE=female, young adult, moderate pitch
BONDETH_TTS_OMNI_KHMER_CHARS_PER_SECOND=12.0
BONDETH_CLONE_ENGINE=omnivoice
BONDETH_BILLING_ENABLED=false
BONDETH_STT_PRELOAD=false
BONDETH_TTS_PRELOAD=false
BONDETH_CLONE_PRELOAD=false
BONDETH_STT_LIVE_PARTIALS=false
```

MMS produces 16 kHz WAV; OmniVoice produces 24 kHz WAV and uses MPS on Apple Silicon
when available. Models load on first use. The optional VoxCPM engine requires
`requirements-voxcpm.txt`; selecting it without installing its dependencies returns
an actionable 503 instead of an unexplained 500. Payments remain disabled.
The quality-first local TTS now uses OmniVoice with a generated generic speaker;
it is slower than MMS. Use `BONDETH_TTS_ENGINE=mms` and restart for the fast option.
See [Khmer TTS quality](khmer-tts.md) for configuration and listening comparisons.
For reference preparation, corrected transcripts and clone-specific checks, see
[Khmer voice cloning quality](khmer-voice-cloning.md).

On macOS, `app/__init__.py` defaults `HF_DEACTIVATE_ASYNC_LOAD=1` before model imports.
The installed Transformers/Safetensors combination deadlocked during parallel
OmniVoice tensor loading. Sequential loading resolved the observed lockup. This is
a macOS default; an explicitly supplied environment value is preserved.

## Repeat the real API smoke test

From `backend/`:

```sh
.venv/bin/python -m scripts.smoke_local
```

The script checks English, Khmer and mixed TTS, English/Khmer transcription,
queued STT segments and history, one-off English cloning, and saved-voice Khmer
cloning. Output WAV files and `report.json` are written to `backend/tmp/local-smoke/`.
It creates/deletes its own synthetic test account and voice. Verification uses a
local development token; it does not test external email delivery. The script
rejects remote backends and non-development settings. `--skip-clone` skips cloning.

The samples are generated speech, not recordings of a real person. A successful
run proves valid non-silent audio and working API flows, not speaker similarity or
natural-speech accuracy. The MMS-to-Khmer-STT round trip has transcription errors;
listen to the audio and use `scripts.eval_khmer_stt` for dataset-based accuracy.

## Khmer recognition accuracy

The Khmer engine now pads the **waveform** with silence before computing log-Mel
features, matching the model preprocessor. Padding the feature matrix with zeros
was not equivalent to silence and degraded short-utterance recognition.

It also accounts for [CTranslate2 4.8.3's internal `max_length // 2` limit](https://github.com/OpenNMT/CTranslate2/blob/v4.8.3/src/models/whisper.cc#L275).
Previously, the duration-based token allowance was halved again inside the decoder,
cutting off sentence endings and occasionally leaving an incomplete Unicode character.
The corrected allowance still keeps prompt plus generated tokens within Whisper's
448-position context. CTranslate2 is pinned: recheck this behavior before upgrading.
Custom Khmer wordpieces are retained even when their IDs exceed stock Whisper's
end-of-text ID. There is no dictionary replacement or LLM rewriting of the transcript.

Measure natural speech separately from generated TTS. From `backend/`:

```sh
.venv/bin/python -m scripts.eval_khmer_stt --mode km --split validation --clips 30 --report tmp/khmer-validation.json
.venv/bin/python -m scripts.eval_khmer_stt --mode auto --split test --clips 30 --report tmp/khmer-test.json
```

For offline repetitions, `--manifest path/to/meta.json` accepts a JSON array of
`{"file": "clip.wav", "transcription": "correct Khmer text"}` entries; audio paths
are relative to that manifest. `--offset` reserves separate diagnostic/evaluation
clips. `--compare tmp/baseline.json` only compares complete reports containing the
same audio hashes and references in the same order. Reports include per-clip
substitutions/deletions/insertions, model revision, runtime version and inference time.
CER ignores whitespace, the listed punctuation, letter case and Khmer-vs-ASCII digit
style; a lower number means fewer character errors, not a word-accuracy percentage.

Choose **Khmer** explicitly when testing Khmer-only speech to avoid language-routing
confounds. Mixed names, numbers, dialects, background noise and clipped microphones
can still cause mistakes. CPU processing may take longer now that complete sentence
endings are decoded; live previews remain disabled locally. Do not infer real-world
accuracy or latency guarantees from a small FLEURS sample.

### Local before/after check — 2026-10-15

Using unchanged pinned int8 weights, forced Khmer, and beam size 5, the first six
cached FLEURS `km_kh` validation clips were used for diagnosis. The remaining
24 clips (zero-based rows 6–29, 350.64 seconds) were reserved for comparison:
normalized character error rate fell from **23.40% to 14.53%**, an 8.88 percentage
point / 37.9% relative reduction. Deletions fell from 520 to 223; substitutions rose
from 147 to 166; insertions stayed at 66. Seventeen clips improved, four regressed,
and three were unchanged. Most of the gain is recovered sentence endings, not a
claim that all word substitutions have been solved.

This is a small reserved subset of the **validation** split, not the full FLEURS test
split, an independently trained-model holdout, or a guarantee for conversational
Khmer. No training or reference-specific text replacement was performed. Baseline
and candidate jobs overlapped on the local CPU, so their RTF values are not a
controlled speed comparison. Reproduce the comparison with the same manifest:

```sh
.venv/bin/python -m scripts.eval_khmer_stt --mode km --manifest tmp/fleurs/meta.json --offset 6 --clips 24 --report tmp/stt-candidate-validation.json --compare tmp/stt-baseline-validation.json
```

Local evidence is in `backend/tmp/stt-length-dev.json`,
`backend/tmp/stt-baseline-validation.json` and `backend/tmp/stt-candidate-validation.json`.
These are ignored development artifacts, not files shipped with the repository.

After restarting the local backend with these fixes, real API checks passed for
forced Khmer and auto-detected Khmer uploads (matching the evaluation transcript),
English auto detection, empty output for silence, and queued Khmer SSE segment/done
events. Their output is in `backend/tmp/stt-api-verification.json`. The backend suite
passed 241 tests; five opt-in model tests were skipped, independently of the real
model evaluation and API checks above.

Live dictation was also exercised against the real WebSocket with generated 16 kHz
PCM. On CPU, final words appear after a pause/stop; partials are disabled locally to
avoid repeated expensive preview inference. Browser tests run the real AudioWorklet
with a synthetic input stream and check microphone/context cleanup on setup failure.

## Browser and regression checks

```sh
# backend/
.venv/bin/python -m pytest -q -p no:cacheprovider

# frontend/, with the dev server already running
PLAYWRIGHT_BASE_URL=http://localhost:3000 PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
npm run lint
npm run build
npx tsc --noEmit
```

Without `PLAYWRIGHT_BASE_URL`, browser tests start the production build on port 3100.
CI uses bundled Chromium; `PLAYWRIGHT_CHANNEL=chrome` selects installed Chrome locally.
Browser fixtures avoid capturing the user's microphone. To test your own recording,
open `/stt`, choose Khmer/English, and explicitly allow microphone access when asked.
For voice cloning, sign in and confirm your email using the link in the backend's
local email log; save or upload a 3-30 second reference you have permission to use.
