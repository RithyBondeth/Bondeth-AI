# Khmer TTS quality

The selected local setup prioritizes quality using the already installed
[OmniVoice model](https://huggingface.co/k2-fsa/OmniVoice). It generates 24 kHz audio,
keeps Khmer/English words in one speaker's voice, and preserves sentence context.
MMS remains the fast, smaller default for fresh installations; no additional model
was downloaded for this change.

## Local configuration

In `backend/.env`, then restart the backend:

```dotenv
BONDETH_TTS_ENGINE=omnivoice
BONDETH_TTS_OMNI_VOICE=female, young adult, moderate pitch
BONDETH_TTS_OMNI_KHMER_CHARS_PER_SECOND=12.0
BONDETH_CLONE_ENGINE=omnivoice
BONDETH_BILLING_ENABLED=false
```

Supported voice profiles are `female, young adult, moderate pitch`,
`male, young adult, moderate pitch`, `female, middle-aged, moderate pitch`,
and `male, middle-aged, low pitch`. These are the engine's attribute tags, not
free-form descriptions. There is no claim that changing a tag guarantees a
particular perceived identity or accent.

The first synthesis designs a **generic synthetic** Khmer house reference, with
no real-person recording, under `backend/data/tts_omnivoice/`. Following requests
reuse it to keep the speaker stable. Model revision, voice profile and reference
format determine its path. Thread/process locks and atomic writes protect it.
The first request includes design latency; preloading only loads the weights.
TTS and cloning share model weights and a generation lock within a process;
separate API/worker processes still require their own memory.

The default inferred Khmer timing dropped a final question during evaluation.
A conservative timing allowance now counts Khmer script characters, English
words and punctuation, with the request speed applied once. Pure English retains
the model's estimator. This is a heuristic, not a phoneme aligner: pronunciation,
number readings and occasional omissions still need human checking. Smaller
`CHARS_PER_SECOND` values give Khmer more time; start at 12 rather than assuming
that slower always sounds better.

Generation on Apple Silicon takes tens of seconds for short passages; long
paragraphs can take considerably longer. Duplicate requests/voice cloning serialize.
Allow sufficient HTTP/proxy timeouts for non-local use. Use
`BONDETH_TTS_ENGINE=mms` and restart for fast 16 kHz generation. Do not silently
fall back between engines without labelling the changed speaker. The bounded
short-Khmer fallback below is the only automatic exception.

Both MMS and OmniVoice **model weights are non-commercial**. OmniVoice's code
license does not grant commercial rights to its weights. Payments stay disabled.
Use a properly licensed, evaluated engine before charging users.

## Short Khmer phrases

The old timing minimum was `1.2 / speed` seconds. For short phrases such as
`សួស្តី` and `អរគុណ។`, real local generation could emit near-silence that the
model's silence removal trimmed to an empty array, causing an HTTP 500.
OmniVoice TTS now allows at least **3 seconds of generation**, including at fast
speeds. This is a generation budget, not padding the final clip to 3 seconds;
the model still trims unused silence. Very short clips therefore do not promise
an exact linear relationship between the speed slider and their duration.

If a short Khmer generation is empty, silent or invalid, it retries once with
a 4-second budget, keeping the same text,
reference speaker, model and decoding quality.
A second failure now tries **MMS Khmer**, but only for a single Khmer-only chunk
with at most 40 normalized letters, combining marks and digits (punctuation and
spaces do not count). Eligibility is independent of speed, so speeding up a long
passage cannot switch its voice. English, mixed scripts and long text never fall
back, nor do infrastructure/model-loading or unexpected programming errors.
Longer Khmer timing and English estimation are unchanged. Voice cloning is not retimed.
The OmniVoice house voice is preserved.

Fallback clips are explicitly labelled **“MMS fallback — different voice”** in
Recent, with a persistent explanation of why the speaker changed. The API returns
`X-TTS-Engine: mms`, `X-TTS-Fallback: short-khmer-omni-failed` and `X-Cache: BYPASS`.
These headers are exposed through CORS. MMS outputs native 16 kHz WAVs; OmniVoice
outputs 24 kHz and `X-TTS-Fallback: none`, including on cache hits. Fallback audio
is deliberately not cached: every new request tries OmniVoice first. The daily
allowance is charged once, not once per attempt. If neither engine produces valid
audio, the API returns an actionable 503, refunds the request and caches nothing.

**Model limitation:** timing and fallback improve availability, not the underlying
model's short-phrase reliability or guaranteed pronunciation. Real local tests
found empty output on both MPS and CPU. More decoding steps, sampling changes,
matching speaker attributes and an alternative attention path did not reliably
eliminate it, so those experimental changes are not shipped. MMS has a different
speaker and timbre; it is a labelled recovery option, not an OmniVoice quality or
speaker-similarity improvement. Voice cloning is unaffected.

With the local API running and OmniVoice TTS/caching enabled, repeat the real
API check from `backend/`:

```sh
.venv/bin/python -m scripts.check_short_khmer_tts
# Repeat just the fast short-word regression:
.venv/bin/python -m scripts.check_short_khmer_tts --cases thanks_fast --out tmp/short-khmer-tts-fast
```

It checks short greetings at 0.5×/1×/2×, a sentence, English, mixed text, valid
non-silent 24 kHz OmniVoice / 16 kHz labelled MMS WAVs and byte-identical main-voice
cache reuse when an OmniVoice clip succeeds. Synthetic audio and a
report are saved under ignored `backend/tmp/short-khmer-tts/`. This validates
the pipeline, not perceived naturalness or exact pronunciation.

Local verification (2026-10-16, Apple Silicon/MPS): all ten real API cases
returned usable WAVs. Two short greeting cases recovered through labelled MMS;
the other eight, including long Khmer, English and mixed text, stayed OmniVoice.
Repeating a successful main-voice case returned a byte-identical cache hit.
Results are in ignored `backend/tmp/short-khmer-tts-fallback/report.json`.
Stochastic future generations can differ; this is not a pronunciation benchmark.

## Pipeline and cache fixes

- NFC and invisible-character cleanup preserve zero-width Khmer word boundaries
  as spaces. Chunking avoids cutting a combining vowel or coeng-consonant cluster;
  this is cluster safety, not full Khmer word segmentation.
- OmniVoice keeps mixed text together instead of alternating two MMS voices.
- Short edge fades prevent discontinuities at joins. Bounded, whole-utterance
  mastering targets 0.1 RMS with a 0.9 peak ceiling and at most 3× gain, preserving
  phrase dynamics without boosting near-silence to full volume. It is not a LUFS
  compliance guarantee or studio mastering service.
- Cache identities include engine/model, style, timing and the generated reference
  fingerprint. The cache format was bumped so prior audio is not returned. The
  first generated reference is cached under its final identity, avoiding an extra
  miss on the next request.
- MMS noise/timing variation can be configured with `BONDETH_TTS_KM_NOISE_SCALE`
  and `BONDETH_TTS_KM_NOISE_SCALE_DURATION`. Model defaults (0.667, 0.8) were retained:
  reducing duration noise to 0.5 did not consistently improve the listening scripts.
  Comma-overfragmentation was tested and not retained.

## Listening comparisons and verification

From `backend/`:

```sh
.venv/bin/python -m scripts.eval_khmer_tts --engine mms --out tmp/tts-mms
.venv/bin/python -m scripts.eval_khmer_tts --engine omnivoice --out tmp/tts-quality --compare tmp/tts-mms/report.json
.venv/bin/python -m pytest -q -p no:cacheprovider
```

The script writes WAVs and reports for greetings, narration, clauses, numbers,
mixed language and English. It checks finite/non-silent samples, clipping and
edge discontinuities, with optional ASR round trips (`--skip-asr` disables them).
The ASR comparison normalizes number spellings to spoken forms. English names
transcribed phonetically in Khmer can still inflate disagreement.
**ASR agreement is not a naturalness/MOS score.** Listen for pronunciation,
missing words, pacing, expression and speaker consistency before choosing a voice.

Local original MMS samples are under `backend/tmp/tts-before/`; the selected
OmniVoice candidate and report are under `backend/tmp/tts-omnivoice-natural/`.
Other experimental variants are retained for diagnosis, not shipped with the app.
These ignored development artifacts are not repository fixtures.

The API reports the actual engine in `X-TTS-Engine`, cache status in `X-Cache`,
and duration in `X-Audio-Duration`; these headers are exposed to the frontend.

### Verified local run (2026-10-15)

Four fixed listening scripts were compared with original MMS output. ASR
disagreement improved on all four; the corrected-timing narration matched its
reference in the recognizer. This small diagnostic set is not a held-out TTS
benchmark or a human naturalness score. The mixed-language recognizer wrote
Facebook/YouTube phonetically in Khmer; dates/numbers still had mistakes.
Warm generation took 14.4–30.0 seconds for 2.5–6.9 seconds of output on this Mac.

After selecting OmniVoice locally and restarting, actual API checks passed for
Khmer narration, English, a faster Khmer request, one-chunk mixed-language preview,
24 kHz finite/unclipped WAV output, correct engine/CORS headers, and punctuation-only
input rejection. The repeated narration was a byte-identical Redis cache hit.
Evidence is in `backend/tmp/tts-omnivoice-natural/api-report.json` and the adjacent
`api_*.wav` files. The full backend suite passed **263 tests**, with five opt-in
model tests skipped; real model generation was verified separately as above.
