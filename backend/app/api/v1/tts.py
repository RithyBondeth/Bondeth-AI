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

router = APIRouter(prefix="/tts", tags=["text-to-speech"])


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=1)
    lang: Literal["auto", "km", "en"] = Field(
        "auto", description="Primary language; decides how numbers are read. Mixed scripts are always handled.")
    speed: float = Field(1.0, ge=0.5, le=2.0)


class TtsPreview(BaseModel):
    primary_lang: str
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
    async with limits.spend("tts_chars", caller, len(req.text)):
        if cached := await cache.get(key):
            wav, duration = cached
        else:
            try:
                wave, sr = await run_in_threadpool(tts.synthesize, req.text, req.lang, req.speed)
            except NothingToSpeak as exc:
                raise HTTPException(422, str(exc)) from exc
            wav, duration = to_wav_bytes(wave, sr), len(wave) / sr
            await cache.put(key, wav, duration)

    return Response(
        content=wav,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'inline; filename="speech.wav"',
            "X-Audio-Duration": f"{duration:.2f}",
            "X-Cache": "HIT" if cached else "MISS",
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
    return TtsPreview(primary_lang=primary, chunks=[{"lang": l, "text": t} for l, t in chunks])
