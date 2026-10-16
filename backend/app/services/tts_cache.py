"""Redis cache of generated speech, for phrases that are spoken again and again.

Entries are keyed by what the voices will actually say (the normalized chunks
from TtsService.prepare), the speed and the model ids, so a normalizer fix or
a model swap simply misses instead of serving stale audio.

The cache shares Redis with refresh tokens and job queues, so it must never
rely on eviction (which could drop those): every entry has a TTL and entries
above a size cap aren't stored at all.
"""

import hashlib
import json

from redis.asyncio import Redis

from app.config import Settings

CACHE_FORMAT = 2  # phrasing, edge fades and bounded whole-utterance mastering


class TtsCache:
    def __init__(self, redis: Redis, settings: Settings):
        self._redis = redis  # a client with decode_responses=False: values are WAV bytes
        self._s = settings

    @property
    def enabled(self) -> bool:
        return self._s.tts_cache_enabled

    def key(self, chunks: list[tuple[str, str]], speed: float) -> str:
        if self._s.tts_engine == "omnivoice":
            from app.services.omni_tts import house_path
            path = house_path(self._s)
            # Regenerating/removing a synthetic house voice must not reuse old audio.
            fingerprint = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
            engine = ["omnivoice", self._s.clone_model, self._s.clone_model_revision,
                      self._s.tts_omni_voice, self._s.tts_omni_khmer_chars_per_second, fingerprint]
        elif self._s.tts_engine == "voxcpm":
            engine = ["voxcpm", self._s.voxcpm_model_revision, self._s.voxcpm_house_voice]
        else:
            engine = ["mms", self._s.tts_model_km, self._s.tts_model_en,
                      self._s.tts_km_noise_scale, self._s.tts_km_noise_scale_duration]
        identity = [CACHE_FORMAT, *engine, round(speed, 3), chunks]
        digest = hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()
        return f"tts:cache:{digest}"

    async def get(self, key: str) -> tuple[bytes, float] | None:
        if not self.enabled:
            return None
        wav, duration = await self._redis.hmget(key, ["wav", "duration"])
        return (wav, float(duration)) if wav is not None and duration is not None else None

    async def put(self, key: str, wav: bytes, duration: float) -> None:
        if not self.enabled or len(wav) > self._s.tts_cache_max_bytes:
            return
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.hset(key, mapping={"wav": wav, "duration": f"{duration:.2f}"})
            pipe.expire(key, self._s.tts_cache_ttl_s)
            await pipe.execute()
