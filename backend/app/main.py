import logging
import shutil
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import clone, health, stt, text, tts
from app.config import get_settings
from app.deps import get_clone_queue, get_clone_service, get_stt_service, get_tts_service

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Clone jobs live in memory, so files from a previous run can never be fetched again.
    shutil.rmtree(get_settings().tmp_dir / "clone_jobs", ignore_errors=True)
    if get_settings().stt_preload:
        await run_in_threadpool(get_stt_service().load)
    if get_settings().tts_preload:
        for lang in ("km", "en"):
            await run_in_threadpool(get_tts_service().load, lang)
    if get_settings().clone_preload:
        await run_in_threadpool(get_clone_service().load)
    yield
    get_clone_queue().shutdown()
    get_clone_queue.cache_clear()  # a restarted app in this process gets a fresh queue


def create_app() -> FastAPI:
    settings = get_settings()
    settings.tmp_dir.mkdir(parents=True, exist_ok=True)

    app = FastAPI(title=settings.app_name, version=settings.version, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix="/api/v1")
    app.include_router(text.router, prefix="/api/v1")
    app.include_router(stt.router, prefix="/api/v1")
    app.include_router(tts.router, prefix="/api/v1")
    app.include_router(clone.router, prefix="/api/v1")
    return app


app = create_app()
