from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import get_settings
from app.deps import get_clone_service, get_stt_service, get_tts_service

router = APIRouter(tags=["health"])


async def _check_database(request: Request) -> str:
    try:
        async with request.app.state.sessionmaker() as session:
            await session.execute(text("SELECT 1"))
        return "ok"
    except Exception:
        return "unavailable"


async def _check_redis(request: Request) -> str:
    try:
        await request.app.state.redis.ping()
        return "ok"
    except Exception:
        return "unavailable"


@router.get("/health")
async def health(request: Request) -> JSONResponse:
    settings = get_settings()
    database, redis_status = await _check_database(request), await _check_redis(request)
    queue = getattr(request.app.state, "clone_queue", None)
    body = {
        "status": "ok" if database == redis_status == "ok" else "degraded",
        "version": settings.version,
        "env": settings.env,
        "database": database,
        "redis": redis_status,
        "models": {
            "stt": get_stt_service().loaded_engines(),
            "tts": get_tts_service().loaded_languages(),
            "clone": get_clone_service().is_loaded,
        },
        "clone_queue": await run_in_threadpool(queue.pending_count) if queue and redis_status == "ok" else None,
    }
    return JSONResponse(body, status_code=200 if body["status"] == "ok" else 503)
