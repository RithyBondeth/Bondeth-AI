# Khmer voice cloning quality

The local cloning engine remains the already-installed OmniVoice model. No new
model, paid service or training was added. Only clone generation uses the new
quality settings; ordinary TTS retains its own settings and synthetic house voice.

## Get a better match

1. Use **5-10 seconds** of one speaker speaking natural Khmer, in a quiet room,
   with no music, echo or overlapping voices. The accepted range remains 3-30 s.
   Short clean references are preferable to long noisy recordings; see the
   [model author's reference guidance](https://github.com/k2-fsa/OmniVoice#tips).
2. Upload the original recording when possible. Converting an old 16 kHz saved
   sample to 24 kHz cannot restore detail already lost; re-upload the original.
3. Fill **Reference transcript (optional)** with exactly what the sample says,
   including English names, not the new sentence you want to generate. Leaving
   it empty runs our existing Khmer-capable STT. Check/correct saved transcripts
   in Manage voices before reusing them. Recognition errors can hurt alignment.
4. Start with speed **1.0** and Khmer selected for Khmer-only output. Listen for
   accent, timbre, cadence, missing words and name pronunciation, not only volume.
   Replacing a recording clears its previous transcript and consent.

The cloning recorder requests no echo cancellation, noise suppression or automatic
gain control, plus a 192 kbps recording target. Browsers may ignore these requests
and still use compressed audio. This is not a lossless recording guarantee; use
headphones and a quiet room. STT recording retains its existing defaults.

## Pipeline changes

- Decode with PyAV floating-point audio into 24 kHz mono, rather than passing the
  reference through the 16-bit/16 kHz STT decoder. Save prepared references as
  24-bit PCM so detail above 8 kHz can survive when present in the source.
- Remove DC offset and trim quiet edges with 150 ms guards. Preserve internal
  pauses, pitch and phrasing. No denoising, pitch correction or speech-content
  cropping is applied. Stereo references are downmixed to mono.
- Reject empty, non-finite, silent/near-silent, heavily clipped or too-short
  usable references, even when a transcript is supplied. These are basic signal
  checks, not speaker diarization, speech validation or a measured SNR threshold.
- Revalidate saved references into a temporary, job-local prepared file. Never
  rewrite their stored original. Remove the prepared copy on success or failure.
- Use 48 OmniVoice generation steps instead of 32 and disable its extra prompt
  silence removal, since reference edges are already prepared. Preserve the
  reference-derived duration estimate and requested speed; do not inject generic
  house-voice, pitch or design instructions into a person's clone.
- Fail jobs when generation returns empty, non-finite or effectively silent audio.
  Existing job/refund handling remains in place.

Configure the backend, then restart it:

```dotenv
BONDETH_CLONE_ENGINE=omnivoice
BONDETH_CLONE_OMNI_STEPS=48
BONDETH_BILLING_ENABLED=false
```

Steps are validated in the range 16-64. The default is 48; 32 trades quality for
latency. More steps do not guarantee a closer identity match. See the upstream
[generation parameters](https://github.com/k2-fsa/OmniVoice/blob/main/docs/generation-parameters.md).
Model weights remain [non-commercial](https://huggingface.co/k2-fsa/OmniVoice);
the code license does not change those rights. Payments remain disabled.

## Repeatable checks

From `backend/`, with the local API running and its generic OmniVoice TTS house
reference already generated:

```sh
.venv/bin/python -m scripts.eval_clone_quality --out tmp/clone-quality
.venv/bin/python -m scripts.smoke_clone
.venv/bin/python -m pytest -q -p no:cacheprovider
```

The evaluator uses a generic, generated speaker, never a dataset speaker or a
user's voice. It records reference hashes, fixed seed, model revision, output
WAVs and optional ASR round trips. `--skip-asr` skips transcription;
`--compare tmp/clone-quality-before/report.json` checks a matching earlier run.
Before/after reports require the same original reference and target sentences.

The API smoke test is restricted to loopback development with log email. It
creates its own disposable verified account and synthetic saved voice, tests
uploaded and saved references, silent-reference rejection/refund, 24 kHz output,
temporary cleanup and original-file preservation, then deletes its own account.
It does not read or clone the user's saved voices.

### Observed local results

A fixed synthetic-reference comparison is retained in the ignored development
directories `backend/tmp/clone-quality-before/` and
`backend/tmp/clone-quality-after/`. For one Khmer sentence, normalized ASR
character disagreement fell from 30.6% to 4.8%, recovering the sentence ending.
Generation increased from 19.4 s to 27.7 s on this Mac. A mixed Khmer/English
sentence still had high ASR disagreement (48.6% to 45.7%); English names were
rendered phonetically in Khmer by the recognizer. These two scripts are diagnostic,
not a held-out benchmark, perceptual naturalness score or speaker-similarity score.

The real API checks produced finite, non-silent 24 kHz audio for both uploaded
and saved references in approximately 25 seconds per short sentence. Their report
and WAVs are under `backend/tmp/clone-quality-api/`; the disposable account was
removed. Backend regression checks passed 275 tests (five opt-in model tests
skipped); separate real-model checks above did run. The browser suite passed
16 tests, including transcript submission/reset, capture cleanup and reference
player layout at 320/768/1024/1440 px. Lint, TypeScript and production build passed.

Human listening against a consenting speaker's real reference is still required
to judge identity, Khmer accent and expression. No percentage identity-match claim
is made, and noisy/multi-speaker recordings are not automatically repaired.

## Faster cloning without a cheaper quality preset

The speed changes preserve 48 steps, model revision, precision, 24 kHz references,
transcripts, reference pauses, guidance and output post-processing. There is no
quantization, downsampling, shorter reference or faster speaking-rate trick.

Two independent kinds of reuse apply to OmniVoice clone jobs:

- **Encoded reference reuse:** a small in-memory cache holds the model's exact
  reference tokens, transcript and reference RMS. A new sentence for the same
  owner/reference can skip reference encoding, but still runs all 48 generation
  steps. This follows the model's supported `voice_clone_prompt` interface, not
  an experimental transformer KV-cache patch. The current adapter bounds it to
  16 entries / 1 MiB of token/text payload / 300 seconds.
- **Exact output reuse:** identical requests from the same account can reuse the
  exact successful WAV bytes. This avoids generation entirely, not the quality
  of generation. The next job still gets its own output and normal quota charge;
  worker queueing and browser polling remain. Failed or silent outputs are never
  cached, and concurrent identical misses are serialized to avoid duplicate work.

Every job still validates the current reference before considering reuse. Output
keys cover owner, saved-voice identity, prepared audio content, transcript,
normalized target, resolved language, exact speed, engine revision/device and
quality settings. Prompt keys cover owner, audio content, transcript and reference
preprocessing; they live on one specific model instance. Changing a reference at
the same path or correcting its transcript does not serve the earlier identity.
No cached authorization decision is used; the API's owner/consent checks remain.

The caches are process-local, not shared across users or worker processes, and
write no new persistent voice data to Redis/disk. Idle expired objects can remain
in memory until the next cache operation or process shutdown; TTL is a lookup
limit, not an immediate memory-erasure guarantee. Entry and payload bounds apply
regardless. Existing saved-reference and job-result retention is unchanged.

```dotenv
BONDETH_CLONE_CACHE_ENABLED=true
BONDETH_CLONE_CACHE_TTL_S=300
BONDETH_CLONE_CACHE_MAX_ENTRIES=16
BONDETH_CLONE_CACHE_MAX_BYTES=16777216
```

These configurable bounds apply to the output cache. Disabling reuse disables
both lookup paths for subsequent jobs. Restart to release all cached objects.
Set multipart `reuse_cached=false` on `POST /api/v1/clone` for a new random take
at unchanged quality; the encoded reference can still be reused. Job responses
report `cache_hit` for exact output reuse, not reference reuse. A fresh successful
take replaces the reusable output. A cache miss or expiry always falls back to
the full quality path, never to a cheaper engine.

### Profiling and quality guard

Stop the API while running this command on a memory-constrained Mac, then restart
it afterward so two model instances do not compete for unified memory:

```sh
.venv/bin/python -m scripts.profile_clone_speed --out tmp/clone-speed-profile --runs 3
```

This compares raw vs pre-encoded reference inputs using the same model, reference,
seed and all 48 generation steps, alternating order over three repetitions per
sentence after warm-up. Stage timing synchronizes the accelerator. On the local
MPS/float32 setup, median Khmer generation fell from **27.93 to 25.26 seconds**
(9.6%); mixed Khmer/English fell from **22.96 to 19.10 seconds** (16.8%). The raw
and reused-prompt waveforms were **sample-for-sample identical in all twelve
measurements**. These are two synthetic listening scripts on this Mac, not an
all-speaker latency/similarity guarantee. Cold-start loading is excluded, and
an entirely new reference does not get this warm-reference benefit.

The stage profile places most remaining time in iterative generation. No
unmeasured attention rewrites, compilation, lower precision or step reductions
were retained. Exact repeat speed is checked separately by `scripts.smoke_clone`,
which now verifies uploaded and saved reference repeats against their original
WAV bytes. Its current report is in `backend/tmp/clone-speed-api/`; historical
quality-only reports remain under `backend/tmp/clone-quality-api/`.

The real API run took 25.35 s for an uploaded-reference first request and 0.25 s
for its exact repeat; saved-reference requests took 22.33 s and 0.12 s respectively.
Both repeats were byte-identical 24 kHz WAVs. These wall times include submission,
polling and download but exclude browser UI polling; a repeat can still wait behind
other queued jobs. The synthetic test voice/account were removed afterward.
The updated backend suite passed **297 tests**, with five opt-in tests skipped.
Fresh-take failure injection explicitly bypasses output reuse, so refund tests
continue to exercise actual model failures rather than successful cached playback.

For daily use, save the voice with a corrected transcript once and reuse it for
new sentences. Keep one warmed clone worker rather than multiple competing model
copies on a small Mac. `BONDETH_CLONE_PRELOAD=true` moves weight loading to startup;
it does not speed the generation loop itself. Changing sentences still costs
tens of seconds at this quality level on the measured hardware.
