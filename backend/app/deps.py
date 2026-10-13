"""Shared singletons, exposed as FastAPI dependencies so tests can override them."""

from functools import lru_cache

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


@lru_cache
def get_clone_queue() -> CloneJobQueue:
    s = get_settings()
    return CloneJobQueue(get_clone_service().run, max_pending=s.clone_max_queue, ttl_s=s.clone_result_ttl_s)
