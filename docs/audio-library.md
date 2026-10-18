# History search and persistent audio

Apply migrations before starting the new API and worker:

```sh
cd backend
.venv/bin/alembic upgrade head
```

## Transcript history

`GET /api/v1/transcriptions` accepts `q` (up to 500 characters), `language=km|en`,
`limit` (1–100, default 20), and `offset`. Searches are case-insensitive literal
substrings; `%`, `_`, and backslashes do not act as search wildcards. Whitespace at
the edges of a query is ignored. Filtering happens in PostgreSQL across all of the
caller's transcripts before pagination; `total` counts the filtered results.

The history screen debounces searches, resets pagination when filters change, and
discards canceled responses. Failed loads show a retry action.

## Audio library

New signed-in TTS requests, including cache hits, automatically save their output
and original text, language setting, speed, engine, voice label, duration and date.
Fallback speech retains its different-speaker notice. Each request gets a separate
library entry and still spends the usual quota. Anonymous output remains available
only in the browser session. Existing session-only clips are not imported.

Cloning workers save the same metadata and a copy of successful output before
marking a job complete. The saved voice label is captured at submission. Closing
the browser does not prevent archiving; open **Audio library** (`/audio`) later to
find completed clips. Recovered jobs reuse already-archived output by their job ID.
Generation or storage failures do not create a successful library entry and follow
the existing quota-refund behavior.

The authenticated endpoints are:

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/audio` | List newest first; supports `q`, `kind=tts|clone`, `limit`, `offset`; returns `{items, total}` |
| `GET /api/v1/audio/{id}/file` | Download/play the owner's WAV, with private/no-store caching and range requests |
| `DELETE /api/v1/audio/{id}` | Delete the owner's saved clip and WAV |

Other accounts receive 404 for a clip ID. JWT sessions and developer API keys
authenticate with the same ownership rules as the other personal libraries.
TTS returns the saved ID in `X-Audio-Id` (exposed through CORS); completed clone
status includes `audio_id`. The library screen loads WAVs on demand, searches by
source text, filters by tool, and confirms deletion.

Metadata lives in `generated_audio`; WAVs live under
`BONDETH_DATA_DIR/audio_library/<user-id>/<clip-id>.wav`. API replicas and workers
must share this data volume, just as for saved voices. Back up metadata and files
together. Library files are independent of Redis cache and job-result expiry, and
stay until the user deletes the clip or account. Deleting a saved voice does not
delete speech already generated from it. Account deletion removes library rows
and the owner's library directory, and late workers cannot archive new files for
the deleted account.
