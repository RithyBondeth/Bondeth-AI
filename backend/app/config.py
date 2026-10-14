from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-insecure-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BONDETH_", env_file=".env", extra="ignore")

    app_name: str = "Bondeth AI API"
    version: str = "0.1.0"
    env: str = "development"  # development | test | production

    # Explicit origins only: wildcard + credentials is rejected by browsers anyway.
    cors_origins: list[str] = ["http://localhost:3000"]

    model_dir: Path = Path("./models")
    tmp_dir: Path = Path("./tmp")
    data_dir: Path = Path("./data")  # persistent files: saved voices, clone job audio
    max_upload_mb: int = 25

    # Infrastructure (see docker-compose.yml)
    database_url: str = "postgresql+asyncpg://bondeth:bondeth@localhost:5432/bondeth"
    redis_url: str = "redis://localhost:6379/0"

    # Auth. Access tokens are short-lived; refresh tokens are single-use and revocable.
    jwt_secret: str = DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    login_max_attempts: int = 10  # per email + IP, within the window below
    login_window_s: int = 900
    register_max_per_ip: int = 5  # new accounts per client IP, within the window below
    register_window_s: int = 3600
    email_verify_token_hours: int = 48
    password_reset_token_minutes: int = 60
    auth_email_max_per_hour: int = 5  # verification resends / reset requests, per user or IP

    # Where users open the app; links in emails point here.
    public_app_url: str = "http://localhost:3000"
    # Outgoing email. "log" writes emails to the server log (development); "smtp" sends them.
    email_backend: Literal["log", "smtp"] = "log"
    email_from: str = "Bondeth AI <no-reply@localhost>"
    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True

    # Speech-to-text. English (and language detection) uses stock faster-whisper.
    stt_model: str = "large-v3-turbo"
    stt_device: str = "cpu"  # "cuda" on a GPU server
    stt_compute_type: str = "int8"  # "float16" on GPU
    stt_beam_size: int = 5
    stt_max_concurrency: int = 1  # CPU inference is heavy; queue extra requests
    stt_preload: bool = False  # load the models at startup instead of first request
    stt_en_threshold: float = 0.6  # auto mode: English only if detection is this confident
    # Transcription jobs (POST /stt/jobs): long recordings, segments streamed as they're decoded.
    stt_job_max_upload_mb: int = 200
    stt_job_max_queue: int = 20
    stt_job_result_ttl_s: int = 3600
    stt_worker_enabled: bool = True

    # Khmer STT: Khmer fine-tuned Whisper (MIT), CTranslate2 int8. Pinned for reproducibility.
    stt_km_model: str = "kavatana/whisper-turbo-khmer-v9-ct2-int8"
    stt_km_model_revision: str = "d164d0b854f4262d82470caec80f040c6189ea37"
    stt_km_compute_type: str = "int8"
    stt_km_batch_size: int = 4  # speech chunks decoded together

    # Text-to-speech. "mms" = Meta MMS-TTS, whose weights are CC-BY-NC 4.0 (non-commercial);
    # "voxcpm" = VoxCPM2 (Apache-2.0, see below).
    tts_engine: Literal["mms", "voxcpm"] = "mms"
    tts_model_km: str = "facebook/mms-tts-khm"
    tts_model_en: str = "facebook/mms-tts-eng"
    tts_max_chars: int = 2000
    tts_preload: bool = False
    tts_cache_enabled: bool = True  # reuse audio for text that was already spoken (same speed)
    tts_cache_ttl_s: int = 7 * 86_400
    tts_cache_max_bytes: int = 2_000_000  # ~1 min at 16 kHz (MMS), ~20 s at 48 kHz (VoxCPM2)

    # Voice cloning. "omnivoice" weights are CC-BY-NC (non-commercial); "voxcpm" is
    # VoxCPM2 (Apache-2.0), the engine to use before charging for it.
    clone_engine: Literal["omnivoice", "voxcpm"] = "omnivoice"
    clone_model: str = "k2-fsa/OmniVoice"
    clone_model_revision: str = "c5fdb5ccb189668d56333f77ba2629f4cd7535f4"
    clone_device: str = "auto"  # auto -> cuda, then mps (Apple Silicon), then cpu
    clone_max_chars: int = 500
    clone_ref_min_s: float = 3.0
    clone_ref_max_s: float = 30.0
    clone_max_queue: int = 10  # pending jobs before new requests get 503
    clone_result_ttl_s: int = 3600  # finished jobs and their audio are deleted after this
    clone_preload: bool = False
    clone_worker_enabled: bool = True  # disable on API-only replicas that shouldn't load the model
    max_voices_per_user: int = 10

    # VoxCPM2 (Apache-2.0, commercial use OK): 2B params, ~8 GB VRAM on CUDA, 48 kHz output.
    # Needs `pip install -r requirements-voxcpm.txt`. Shared by TTS and cloning when selected.
    voxcpm_model: str = "openbmb/VoxCPM2"
    voxcpm_model_revision: str = "32279effe8c19989596f05d353d1447f51d9e915"
    voxcpm_device: str = "auto"  # auto -> cuda, then mps, then cpu
    voxcpm_cfg_value: float = 2.0
    voxcpm_inference_timesteps: int = 10  # more = slower, slightly better
    # Description of the standard TTS voice, designed once and saved (see services/voxcpm.py).
    voxcpm_house_voice: str = "A warm, clear adult female voice, friendly and calm, studio quality"

    # Abuse protection and daily allowances (see limits.py). A caller is the signed-in
    # user, otherwise the client IP. false = count usage but never block.
    limits_enabled: bool = True
    rate_limit_window_s: int = 60
    rate_limit_anon: int = 10  # requests per window, per endpoint group
    rate_limit_user: int = 30
    rate_limit_api_key: int = 60  # per developer API key (each key has its own bucket)
    rate_limit_cheap: int = 120  # endpoints that run no model, e.g. the TTS preview while typing
    quota_utc_offset_hours: int = 7  # allowances reset at midnight here (Cambodia)
    quota_stt_seconds_anon: int = 600  # audio transcribed per day
    quota_stt_seconds_user: int = 3600
    quota_tts_chars_anon: int = 5_000  # characters spoken per day
    quota_tts_chars_user: int = 50_000
    quota_clone_jobs_user: int = 20  # cloning always needs an account
    max_api_keys_per_user: int = 10

    @model_validator(mode="after")
    def _require_real_secret_outside_dev(self):
        if self.env not in ("development", "test") and (
            self.jwt_secret == DEV_JWT_SECRET or len(self.jwt_secret) < 32
        ):
            raise ValueError(
                "Set BONDETH_JWT_SECRET to a random value of at least 32 characters outside development "
                "(python3 -c \"import secrets; print(secrets.token_urlsafe(48))\").")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
