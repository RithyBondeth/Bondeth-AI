from fastapi import APIRouter

from app.config import get_settings
from app.deps import get_clone_queue, get_clone_service, get_stt_service, get_tts_service

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "version": settings.version,
        "env": settings.env,
        "models": {
            "stt": get_stt_service().loaded_engines(),
            "tts": get_tts_service().loaded_languages(),
            "clone": get_clone_service().is_loaded,
        },
        "clone_queue": get_clone_queue().pending_count(),
    }
