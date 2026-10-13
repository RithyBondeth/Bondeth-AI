"""Shared singletons, exposed as FastAPI dependencies so tests can override them."""

from functools import lru_cache

from app.config import get_settings
from app.services.stt import SttService
from app.services.tts import TtsService


@lru_cache
def get_stt_service() -> SttService:
    return SttService(get_settings())


@lru_cache
def get_tts_service() -> TtsService:
    return TtsService(get_settings())
