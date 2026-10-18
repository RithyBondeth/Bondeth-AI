"""Durable output storage shared by API requests and the standalone clone worker."""
import asyncio
import shutil
import uuid
from pathlib import Path

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.db import GeneratedAudio, User

FALLBACK_NOTICE = (
    "OmniVoice could not speak this short Khmer phrase. This clip uses MMS, a different speaker. "
    "Try again to retry OmniVoice."
)


def audio_path(data_dir: Path, user_id: uuid.UUID, audio_id: uuid.UUID) -> Path:
    return data_dir / "audio_library" / str(user_id) / f"{audio_id}.wav"


def _write_audio(path: Path, audio: bytes | Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        if isinstance(audio, Path):
            shutil.copyfile(audio, temporary)
        else:
            temporary.write_bytes(audio)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


async def save_audio(session: AsyncSession, data_dir: Path, user_id: uuid.UUID,
                     audio_id: uuid.UUID, audio: bytes | Path, **metadata) -> uuid.UUID | None:
    # Serialize saves with account deletion; never recreate files for a deleted owner.
    owner = await session.scalar(select(User.id).where(User.id == user_id).with_for_update())
    if owner is None:
        return None
    if await session.get(GeneratedAudio, audio_id) is not None:
        return audio_id  # a recovered clone job already archived this output
    path = audio_path(data_dir, user_id, audio_id)
    try:
        await run_in_threadpool(_write_audio, path, audio)
        session.add(GeneratedAudio(id=audio_id, user_id=user_id, **metadata))
        await session.commit()
    except BaseException:
        await session.rollback()
        await run_in_threadpool(path.unlink, missing_ok=True)
        raise
    return audio_id


class CloneAudioLibrary:
    def __init__(self, database_url: str, data_dir: Path, engine: str):
        self._database_url, self._data_dir, self._engine = database_url, data_dir, engine

    def save(self, job) -> str | None:
        return asyncio.run(self._save(job))

    def restore(self, job) -> bool:
        return asyncio.run(self._restore(job))

    async def _restore(self, job) -> bool:
        engine = create_async_engine(self._database_url, poolclass=NullPool)
        try:
            async with async_sessionmaker(engine)() as session:
                row = await session.scalar(select(GeneratedAudio).where(
                    GeneratedAudio.id == uuid.UUID(job.id), GeneratedAudio.user_id == uuid.UUID(job.user_id)))
                if row is None:
                    return False
                path = audio_path(self._data_dir, row.user_id, row.id)
                await run_in_threadpool(shutil.copyfile, path, job.output_path)
                job.audio_id, job.duration = str(row.id), row.duration
                return True
        finally:
            await engine.dispose()

    async def _save(self, job) -> str | None:
        engine = create_async_engine(self._database_url, poolclass=NullPool)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                audio_id = await save_audio(
                    session, self._data_dir, uuid.UUID(job.user_id), uuid.UUID(job.id), job.output_path,
                    kind="clone", text=job.text, voice=job.voice_label, language=job.lang,
                    speed=job.speed, duration=job.duration, engine=self._engine,
                )
                return str(audio_id) if audio_id else None
        finally:
            await engine.dispose()
