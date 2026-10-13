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
            "stt": get_stt_service().loaded_engines(),
            "tts": get_tts_service().loaded_languages(),
        },
    }
