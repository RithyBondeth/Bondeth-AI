# Transcript editing and subtitles

Apply migrations with `cd backend && .venv/bin/alembic upgrade head` before
starting the API and workers. The additive migration stores segments, optional
model word boundaries, a revision counter, and the last edit time. Existing
transcripts keep their text; timestamps that were never stored cannot be recovered.

## Using the editor

Open a history entry (or its pencil action) to reach `/history/<id>`, then choose
**Edit**. New transcription results use the same editor in Speech to Text.
Correct timed transcripts one segment at a time; the original timestamps remain
unchanged. A **Text** view joins the current segments and **Timeline** shows their
timings. Model-provided **Words** formatting is available until its text is edited.
Older records without timings use one plain-text field and explain why subtitle
downloads are unavailable. Re-transcribing the original recording creates a new
transcript with timing; the app does not invent timestamps for old text.

Signed-in edits autosave after 700 ms without typing. Requests are serialized:
typing during a save keeps the newer draft and sends it with the next revision.
The status indicates unsaved changes, saving, saved, failure, or a conflicting edit.
Saved edits update history search and copies of the transcript.

Failed saves retain the draft and offer **Retry save**. Where browser storage is
available, pending drafts are also kept in sessionStorage, scoped to the account
and transcript, and restored on returning within the same tab. Successful saves
clear them. The editor attempts to flush on navigation and when hidden, and asks
the browser to confirm closing/reloading with unsaved edits. This cannot guarantee
delivery after a forced browser shutdown; downloads remain available from the draft.

If another editor changes the document, autosave stops without replacing either
version. **Load saved version** explicitly discards the local draft. **Save my
version** reads the latest revision and attempts to save the local draft against
it. Another concurrent change can still produce a new conflict.

Anonymous results can be edited and exported in the current session; they do not
create account history or autosave to the server.

## Downloads

TXT, SRT and VTT buttons export the current draft, including edits that have not
saved yet. SRT/VTT require non-empty timed cues. Blank cues remain editable but
are omitted from subtitle files and cue numbers are reassigned. Output uses UTF-8
and millisecond timestamps, including hour rollover. Text is escaped as literal
text, and blank lines within a cue are collapsed to preserve cue boundaries.
These are recognition segment timestamps, not word-level forced alignment.

Format references: [WebVTT](https://www.w3.org/TR/webvtt1/),
[SubRip/SRT](https://www.loc.gov/preservation/digital/formats/fdd/fdd000569.shtml).

## Authenticated API

- `GET /api/v1/transcriptions/{id}` returns the owned document, including
  `segments`, `segmented_text`, `revision`, and `updated_at`.
- `PATCH /api/v1/transcriptions/{id}` accepts `revision` and either `segments`
  (ordered `{start, end, text}` entries) or `text` for untimed records. Timed text
  must be edited through segments so subtitle alignment stays explicit. Timing
  must be finite, nonnegative, ordered, within the audio duration, and end after
  its start at millisecond precision. Overlapping cues are allowed. Empty cue
  text is allowed. Edits are limited to 500,000 characters and 20,000 cues, with
  at most 10,000 characters per cue and timing bounded to 1,000 hours.
- A stale revision returns 409 unless the identical draft is already saved
  (safe retry after a lost response). Changed documents increment their revision;
  unchanged saves do not. Another account receives 404.
- `GET /api/v1/transcriptions/{id}/export?format=txt|srt|vtt` downloads the saved
  version. Subtitle requests without usable timing return 422. Browser downloads
  use the current draft instead, avoiding exports that lag behind autosave.

Editing and exporting do not run a speech model or spend transcription quota.
Queued-job result replay keeps its original inference result; reopen the saved
document to retrieve the latest edits.

## Audio-synced editing

Signed-in users can leave **Keep source audio** checked before uploading or
starting live dictation. The API defaults to not retaining recordings unless
`keep_source_audio=true` is submitted with `/stt` or `/stt/jobs`, or the boolean
is included in a live session's start message. Anonymous retention is refused.
Existing transcripts have no recoverable source recording.

Saved recordings are normalized to mono 16 kHz PCM WAV for browser playback.
The complete decoded timeline, including silence, is retained so segment
positions stay aligned. The original upload file is still discarded. Queued
workers archive the recording before removing temporary input, even if the
browser has disconnected; embedded and standalone workers use the same storage.
Live capture streams to a bounded temporary file and is saved on successful
completion. Leaving a live session before completion discards its capture.

Use **Listen**, pause, the seek bar, five-second skip buttons, and playback speed
controls. Click text or timeline segments, or a timestamp in Edit, to start
listening there. The current segment highlights as playback moves; silence
between cues has no highlight. Playback never changes text, moves keyboard
focus, or interrupts autosave. Timings remain recognition segment boundaries,
so highlighting is at segment rather than individual-word level.

Recordings live under `BONDETH_DATA_DIR/transcript_audio/<owner>/<transcript>.wav`,
with private file permissions. Never expose this directory through static file
hosting. Back it up together with PostgreSQL and mount the same persistent data
volume in the API and workers. Only the owner can fetch or delete a recording:

- `GET /api/v1/transcriptions/{id}/source-audio` serves WAV with private/no-store
  caching and supports byte ranges. Browser playback fetches with the normal
  bearer header and uses a temporary blob URL; credentials never enter URLs.
- `DELETE /api/v1/transcriptions/{id}/source-audio` removes the recording while
  preserving transcript text, revisions, edits, and subtitle exports. Removed
  recordings cannot be resurrected by a worker retry.
- Deleting a transcript or account also removes its source recordings.

`BONDETH_SOURCE_AUDIO_STORAGE_MB` defaults to 1024 MiB per account and
`BONDETH_SOURCE_AUDIO_MAX_MB` to 128 MiB per decoded recording. Configure both
consistently on API and workers; Compose forwards them to both. Quota checks
serialize concurrent writes for each account. Deletion frees capacity. These
limits apply to the normalized WAV, independently of compressed upload limits.
The document exposes `source_audio_status` and `source_audio_bytes`. Storage,
decoding or size failures leave the text transcript usable and show an audio
availability message. No source is retained when no transcript text was produced.
Temporary archive files normally disappear immediately; after a process crash,
operators may remove old `.staging` files and `tmp/live-source-*` folders while
API and workers are stopped. Completed recordings persist until explicitly deleted.
