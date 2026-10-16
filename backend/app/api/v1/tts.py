from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.deps import get_tts_cache, get_tts_service
from app.limits import Caller, Limits, get_limits, rate_limit
from app.services.tts import NothingToSpeak, TtsService, to_wav_bytes
from app.services.tts_cache import TtsCache
from app.services.errors import EngineUnavailable, SpeechGenerationError

router = APIRouter(prefix="/tts", tags=["text-to-speech"])


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=1)
    lang: Literal["auto", "km", "en"] = Field(
        "auto", description="Primary language; decides how numbers are read. Mixed scripts are always handled.")
    speed: float = Field(1.0, ge=0.5, le=2.0)


class TtsPreview(BaseModel):
    primary_lang: str
    engine: str
    chunks: list[dict[str, str]]


def _check_length(req: TtsRequest, settings: Settings) -> None:
    if len(req.text) > settings.tts_max_chars:
        raise HTTPException(413, f"Text exceeds {settings.tts_max_chars} characters")


@router.post("", response_class=Response, responses={200: {"content": {"audio/wav": {}}}})
async def text_to_speech(
    req: TtsRequest,
    settings: Settings = Depends(get_settings),
    tts: TtsService = Depends(get_tts_service),
    cache: TtsCache = Depends(get_tts_cache),
    caller: Caller = Depends(rate_limit("tts")),
    limits: Limits = Depends(get_limits),
) -> Response:
    """Public. Counts against the daily text-to-speech allowance (see GET /usage).

    Text that was already spoken at the same speed is served from a cache
    (`X-Cache: HIT`); it still counts against the allowance.
    """
    _check_length(req, settings)
    _, chunks = tts.prepare(req.text, req.lang)
    key = cache.key(chunks, req.speed)
    engine, fallback = tts.engine, "none"
    async with limits.spend("tts_chars", caller, len(req.text)):
        if cached := await cache.get(key):
            wav, duration = cached
        else:
            try:
                result = await run_in_threadpool(tts.synthesize_result, req.text, req.lang, req.speed)
            except NothingToSpeak as exc:
                raise HTTPException(422, str(exc)) from exc
            except (EngineUnavailable, SpeechGenerationError) as exc:
                raise HTTPException(503, str(exc)) from exc
            engine, fallback = result.engine, result.fallback
            wav = to_wav_bytes(result.wave, result.sample_rate)
            duration = len(result.wave) / result.sample_rate
            # A quality engine may create its synthetic house reference on this
            # request. Cache under its final identity so the next request can hit.
            # Do not replace OmniVoice with a cached different speaker. A new
            # request must try the main voice again after a transient failure.
            if fallback == "none":
                await cache.put(cache.key(chunks, req.speed), wav, duration)

    return Response(
        content=wav,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'inline; filename="speech.wav"',
            "X-Audio-Duration": f"{duration:.2f}",
            "X-Cache": "BYPASS" if fallback != "none" else ("HIT" if cached else "MISS"),
            "X-TTS-Engine": engine,
            "X-TTS-Fallback": fallback,
        },
    )


@router.post("/preview", response_model=TtsPreview, dependencies=[Depends(rate_limit("tts_preview", cheap=True))])
def preview(
    req: TtsRequest,
    settings: Settings = Depends(get_settings),
    tts: TtsService = Depends(get_tts_service),
) -> TtsPreview:
    """Show exactly what each voice will say, without generating audio."""
    _check_length(req, settings)
    primary, chunks = tts.prepare(req.text, req.lang)
    return TtsPreview(primary_lang=primary, engine=tts.engine, chunks=[{"lang": l, "text": t} for l, t in chunks])
