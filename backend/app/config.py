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

    # Speech-to-text. English (and language detection) uses stock faster-whisper.
    stt_model: str = "large-v3-turbo"
    stt_device: str = "cpu"  # "cuda" on a GPU server
    stt_compute_type: str = "int8"  # "float16" on GPU
    stt_beam_size: int = 5
    stt_max_concurrency: int = 1  # CPU inference is heavy; queue extra requests
    stt_preload: bool = False  # load the models at startup instead of first request
    stt_en_threshold: float = 0.6  # auto mode: English only if detection is this confident

    # Khmer STT: Khmer fine-tuned Whisper (MIT), CTranslate2 int8. Pinned for reproducibility.
    stt_km_model: str = "kavatana/whisper-turbo-khmer-v9-ct2-int8"
    stt_km_model_revision: str = "d164d0b854f4262d82470caec80f040c6189ea37"
    stt_km_compute_type: str = "int8"
    stt_km_batch_size: int = 4  # speech chunks decoded together

    # Text-to-speech (Meta MMS-TTS). NOTE: these weights are CC-BY-NC 4.0 (non-commercial).
    tts_model_km: str = "facebook/mms-tts-khm"
    tts_model_en: str = "facebook/mms-tts-eng"
    tts_max_chars: int = 2000
    tts_preload: bool = False

    # Voice cloning (OmniVoice). NOTE: model weights are CC-BY-NC (non-commercial);
    # swap the engine (e.g. VoxCPM2, Apache-2.0, needs a GPU) before charging for it.
    clone_model: str = "k2-fsa/OmniVoice"
    clone_model_revision: str = "c5fdb5ccb189668d56333f77ba2629f4cd7535f4"
    clone_device: str = "auto"  # auto -> cuda, then mps (Apple Silicon), then cpu
    clone_max_chars: int = 500
    clone_ref_min_s: float = 3.0
    clone_ref_max_s: float = 30.0
    clone_max_queue: int = 10  # pending jobs before new requests get 503
    clone_result_ttl_s: int = 3600  # finished jobs and their audio are deleted after this
    clone_preload: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
