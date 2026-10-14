import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import HTTPException, UploadFile

AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".webm", ".ogg", ".flac", ".aac", ".mp4"}
_CHUNK = 1024 * 1024


def audio_duration(path: Path) -> float | None:
    """Audio length in seconds, or None if the file can't be read as audio.

    Uses the container header when it has a duration; browser-recorded WebM
    doesn't, so then the packets are scanned (demuxed, not decoded: fast).
    """
    try:
        import av

        with av.open(str(path)) as container:
            if container.duration:
                return container.duration / av.time_base
            stream = container.streams.audio[0]
            end = 0.0
            for packet in container.demux(stream):
                if packet.pts is not None and packet.time_base is not None:
                    end = max(end, float((packet.pts + (packet.duration or 0)) * packet.time_base))
            return end or None
    except Exception:
        return None


async def store_upload(file: UploadFile, dest_dir: Path, max_mb: int) -> Path:
    """Stream an uploaded audio file into dest_dir and return its path. The caller owns the file."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise HTTPException(415, f"Unsupported audio format '{suffix or 'none'}'. "
                                 f"Allowed: {', '.join(sorted(AUDIO_EXTENSIONS))}")

    # Never trust the client filename for the path; only keep its extension.
    path = dest_dir / f"upload_{uuid.uuid4().hex}{suffix}"
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
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path


@asynccontextmanager
async def saved_upload(file: UploadFile, tmp_dir: Path, max_mb: int) -> AsyncIterator[Path]:
    """Stream an uploaded audio file to disk and always delete it afterwards."""
    path = await store_upload(file, tmp_dir, max_mb)
    try:
        yield path
    finally:
        path.unlink(missing_ok=True)
