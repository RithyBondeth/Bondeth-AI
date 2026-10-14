import logging
from contextlib import asynccontextmanager

import redis
import redis.asyncio
from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import api_keys, auth, clone, health, stt, text, transcriptions, tts, usage, voices
from app.config import get_settings
from app.db import create_engine, create_sessionmaker
from app.deps import get_clone_service, get_stt_service, get_tts_service
from app.limits import LimitExceeded, limit_exceeded_handler
from app.services.clone_jobs import CloneJobQueue
from app.services.stt_jobs import SttJobQueue

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    engine = create_engine(settings.database_url)
    app.state.sessionmaker = create_sessionmaker(engine)
    app.state.redis = redis.asyncio.Redis.from_url(settings.redis_url, decode_responses=True)
    app.state.redis_bytes = redis.asyncio.Redis.from_url(settings.redis_url)  # binary values (TTS cache)
    # The clone worker is a plain thread, so it gets its own synchronous client.
    sync_redis = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    app.state.clone_queue = CloneJobQueue(
        sync_redis, get_clone_service().run, settings.data_dir / "clone_jobs",
        max_pending=settings.clone_max_queue, ttl_s=settings.clone_result_ttl_s,
    )
    app.state.stt_queue = SttJobQueue(
        sync_redis, get_stt_service(), settings.data_dir / "stt_jobs",
        max_pending=settings.stt_job_max_queue, ttl_s=settings.stt_job_result_ttl_s,
    )

    if settings.stt_preload:
        await run_in_threadpool(get_stt_service().load)
    if settings.tts_preload:
        for lang in ("km", "en"):
            await run_in_threadpool(get_tts_service().load, lang)
    if settings.clone_preload:
        await run_in_threadpool(get_clone_service().load)
    if settings.clone_worker_enabled:
        app.state.clone_queue.start_worker()
    if settings.stt_worker_enabled:
        app.state.stt_queue.start_worker()

    yield

    app.state.clone_queue.stop_worker()
    app.state.stt_queue.stop_worker()
    sync_redis.close()
    await app.state.redis.aclose()
    await app.state.redis_bytes.aclose()
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    app = FastAPI(title=settings.app_name, version=settings.version, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Retry-After", "X-Cache"],
    )
    app.add_exception_handler(LimitExceeded, limit_exceeded_handler)

    for router in (health, auth, api_keys, text, stt, transcriptions, tts, voices, clone, usage):
        app.include_router(router.router, prefix="/api/v1")
    return app


app = create_app()
