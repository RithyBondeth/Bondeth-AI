"""Shared singletons, exposed as FastAPI dependencies so tests can override them.

Models are process-wide singletons (expensive to load). Connections and the
clone queue belong to the running app and live on `app.state` (see main.py).
"""

from functools import lru_cache

from fastapi import Request

from app.config import get_settings
from app.services.clone_jobs import CloneJobQueue
from app.services.stt import SttService
from app.services.tts import TtsService
from app.services.voice_clone import VoiceCloneService


@lru_cache
def get_stt_service() -> SttService:
    return SttService(get_settings())


@lru_cache
def get_tts_service() -> TtsService:
    return TtsService(get_settings())


@lru_cache
def get_clone_service() -> VoiceCloneService:
    return VoiceCloneService(get_settings(), get_stt_service())


def get_clone_queue(request: Request) -> CloneJobQueue:
    return request.app.state.clone_queue
