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
fall back between engines: that would change the speaker and quality unexpectedly.

Both MMS and OmniVoice **model weights are non-commercial**. OmniVoice's code
license does not grant commercial rights to its weights. Payments stay disabled.
Use a properly licensed, evaluated engine before charging users.

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
