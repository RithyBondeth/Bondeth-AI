"""Private, bounded, browser-playable source recordings for saved transcripts."""
import asyncio
import logging
import os
import tempfile
import uuid
import wave
from pathlib import Path

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.db import Transcription, User

logger = logging.getLogger(__name__)


def source_audio_path(data_dir: Path, owner: uuid.UUID, transcript: uuid.UUID) -> Path:
    return data_dir / "transcript_audio" / str(owner) / f"{transcript}.wav"


class SourceAudioFull(Exception):
    pass


def _normalize(source: Path, target: Path, max_bytes: int) -> int:
    # Keep the complete decoded timeline, including silence; never trim or apply VAD.
    import av

    with av.open(str(source)) as container, wave.open(str(target), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        size = 44

        def write(frame):
            nonlocal size
            data = frame.to_ndarray().astype("<i2", copy=False).tobytes()
            size += len(data)
            if size > max_bytes:
                raise SourceAudioFull()
            output.writeframesraw(data)

        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                write(converted)
        for converted in resampler.resample(None):
            write(converted)
        if size == 44:
            raise ValueError("Source audio is empty")
    return target.stat().st_size


async def save_source_audio(session: AsyncSession, data_dir: Path, owner: uuid.UUID, transcript: uuid.UUID,
                            source: Path, storage_bytes: int, max_file_bytes: int) -> None:
    """Archive without sacrificing the transcript on quota, decode or disk errors.

    Lock the owner before the transcript, serializing capacity checks and account
    deletion. A removed source is never resurrected by a recovered worker.
    """
    temporary = None
    status, size = "available", 0
    try:
        try:
            staging = data_dir / "transcript_audio" / ".staging"
            staging.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(suffix=".wav", dir=staging)
            os.close(fd)
            temporary = Path(name)
            size = await run_in_threadpool(_normalize, source, temporary, min(storage_bytes, max_file_bytes))
        except SourceAudioFull:
            status = "storage_full"
        except Exception:
            logger.exception("Could not prepare source audio for transcript %s", transcript)
            status = "unavailable"
        owner_exists = await session.scalar(select(User.id).where(User.id == owner).with_for_update())
        if owner_exists is None:
            return
        row = await session.scalar(select(Transcription).where(Transcription.id == transcript,
                                   Transcription.user_id == owner).with_for_update())
        if row is None or row.source_audio_status in ("available", "removed"):
            return
        if status == "available":
            used = await session.scalar(select(func.coalesce(func.sum(Transcription.source_audio_bytes), 0))
                                        .where(Transcription.user_id == owner))
            if used + size > storage_bytes:
                status = "storage_full"
            else:
                destination = source_audio_path(data_dir, owner, transcript)
                try:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    await run_in_threadpool(temporary.replace, destination)
                except OSError:
                    logger.exception("Could not store source audio for transcript %s", transcript)
                    status = "unavailable"
        row.source_audio_status = status
        row.source_audio_bytes = size if status == "available" else None
        try:
            await session.commit()
        except BaseException:
            await session.rollback()
            if status == "available":
                await run_in_threadpool(source_audio_path(data_dir, owner, transcript).unlink, missing_ok=True)
            raise
    except Exception:
        await session.rollback()
        logger.exception("Could not archive source audio for transcript %s", transcript)
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                logger.exception("Could not clean up source audio staging file")


class TranscriptAudioLibrary:
    def __init__(self, database_url: str, data_dir: Path, storage_mb: int, max_file_mb: int):
        self.database_url, self.data_dir = database_url, data_dir
        self.storage_bytes, self.max_file_bytes = storage_mb * 1024**2, max_file_mb * 1024**2

    def save(self, job):
        if job.keep_source_audio and job.user_id and job.transcription_id:
            try:
                asyncio.run(self._save(job))
            except Exception:
                logger.exception("Could not archive source audio for job %s", job.id)

    async def _save(self, job):
        engine = create_async_engine(self.database_url, poolclass=NullPool)
        try:
            async with async_sessionmaker(engine)() as session:
                await save_source_audio(session, self.data_dir, uuid.UUID(job.user_id), uuid.UUID(job.transcription_id),
                                        job.audio_path, self.storage_bytes, self.max_file_bytes)
        finally:
            await engine.dispose()
