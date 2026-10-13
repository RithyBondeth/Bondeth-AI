import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import HTTPException, UploadFile

AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".webm", ".ogg", ".flac", ".aac", ".mp4"}
_CHUNK = 1024 * 1024


@asynccontextmanager
async def saved_upload(file: UploadFile, tmp_dir: Path, max_mb: int) -> AsyncIterator[Path]:
    """Stream an uploaded audio file to disk and always delete it afterwards."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise HTTPException(415, f"Unsupported audio format '{suffix or 'none'}'. "
                                 f"Allowed: {', '.join(sorted(AUDIO_EXTENSIONS))}")

    # Never trust the client filename for the path; only keep its extension.
    path = tmp_dir / f"upload_{uuid.uuid4().hex}{suffix}"
    max_bytes = max_mb * 1024 * 1024
    written = 0
    try:
        with path.open("wb") as out:
            while chunk := await file.read(_CHUNK):
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(413, f"File exceeds the {max_mb} MB limit")
                out.write(chunk)
        if written == 0:
            raise HTTPException(400, "Uploaded file is empty")
        yield path
    finally:
        path.unlink(missing_ok=True)
