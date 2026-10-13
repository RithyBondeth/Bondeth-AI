from fastapi import APIRouter

from app.config import get_settings
from app.deps import get_stt_service, get_tts_service

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "version": settings.version,
        "env": settings.env,
        "models": {
            "stt": "loaded" if get_stt_service().is_loaded else "not_loaded",
            "tts": get_tts_service().loaded_languages(),
        },
    }
