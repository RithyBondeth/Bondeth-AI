import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import health, stt, text, tts
from app.config import get_settings
from app.deps import get_stt_service, get_tts_service

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if get_settings().stt_preload:
        await run_in_threadpool(get_stt_service().load)
    if get_settings().tts_preload:
        for lang in ("km", "en"):
            await run_in_threadpool(get_tts_service().load, lang)
    yield


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
    return app


app = create_app()
