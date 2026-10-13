from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.deps import get_tts_service
from app.services.tts import NothingToSpeak, TtsService, to_wav_bytes

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
) -> Response:
    _check_length(req, settings)
    try:
        wave, sr = await run_in_threadpool(tts.synthesize, req.text, req.lang, req.speed)
    except NothingToSpeak as exc:
        raise HTTPException(422, str(exc)) from exc

    return Response(
        content=to_wav_bytes(wave, sr),
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'inline; filename="speech.wav"',
            "X-Audio-Duration": f"{len(wave) / sr:.2f}",
        },
    )


@router.post("/preview", response_model=TtsPreview)
def preview(
    req: TtsRequest,
    settings: Settings = Depends(get_settings),
    tts: TtsService = Depends(get_tts_service),
) -> TtsPreview:
    """Show exactly what each voice will say, without generating audio."""
    _check_length(req, settings)
    primary, chunks = tts.prepare(req.text, req.lang)
    return TtsPreview(primary_lang=primary, chunks=[{"lang": l, "text": t} for l, t in chunks])
