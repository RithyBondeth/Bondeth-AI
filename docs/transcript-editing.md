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
