from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BONDETH_", env_file=".env", extra="ignore")

    app_name: str = "Bondeth AI API"
    version: str = "0.1.0"
    env: str = "development"

    # Explicit origins only: wildcard + credentials is rejected by browsers anyway.
    cors_origins: list[str] = ["http://localhost:3000"]

    model_dir: Path = Path("./models")
    tmp_dir: Path = Path("./tmp")
    max_upload_mb: int = 25

    # Speech-to-text (faster-whisper)
    stt_model: str = "large-v3-turbo"
    stt_device: str = "cpu"  # "cuda" on a GPU server
    stt_compute_type: str = "int8"  # "float16" on GPU
    stt_beam_size: int = 5
    stt_max_concurrency: int = 1  # CPU inference is heavy; queue extra requests
    stt_preload: bool = False  # load the model at startup instead of first request

    # Text-to-speech (Meta MMS-TTS). NOTE: these weights are CC-BY-NC 4.0 (non-commercial).
    tts_model_km: str = "facebook/mms-tts-khm"
    tts_model_en: str = "facebook/mms-tts-eng"
    tts_max_chars: int = 2000
    tts_preload: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
