"""Live dictation over a WebSocket: speak, and Khmer or English text appears as you talk.

Protocol (WS /api/v1/stt/live):

1. Client sends JSON `{"type": "start", "language": "auto"|"km"|"en", "token": "<access token or API key>"}`.
   The token is optional (signed-out dictation uses the signed-out allowance). It's
   sent in the first message because browsers can't set headers on a WebSocket.
2. Server replies `{"type": "ready"}`.
3. Client streams binary frames of 16 kHz mono 16-bit little-endian PCM (~100 ms each).
4. Server sends `{"type": "partial", "text"}` (the phrase so far, replaced each time) and
   `{"type": "final", "text", "segmented_text", "start", "end"}` (a finished phrase).
5. Client sends `{"type": "stop"}`; the server finalizes and sends
   `{"type": "done", "text", "segmented_text", "language", "duration", "transcription_id"}`.

Errors arrive as `{"type": "error", "detail", "reason"}` and the socket closes.
Audio counts against the daily speech-to-text allowance as it arrives.
"""

import asyncio
import json
import logging
import math

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from app.auth import _authenticate
from app.config import Settings, get_settings
from app.db import Transcription
from app.deps import get_stt_service
from app.limits import Caller, LimitExceeded, Limits
from app.services.live_stt import LiveConfig, LiveTranscriber
from app.services.stt import SttService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stt", tags=["speech-to-text"])

START_TIMEOUT_S = 10
IDLE_SLEEP_S = 0.15  # how often to look for new audio when nothing is waiting

POLICY_VIOLATION, TRY_AGAIN_LATER = 1008, 1013
PREVIEW_BEAM = 2


async def _fail(ws: WebSocket, detail: str, reason: str, code: int) -> None:
    await ws.send_json({"type": "error", "detail": detail, "reason": reason})
    await ws.close(code)


@router.websocket("/live")
async def live_dictation(ws: WebSocket, settings: Settings = Depends(get_settings),
                         stt: SttService = Depends(get_stt_service)) -> None:
    await ws.accept()
    try:
        start = json.loads(await asyncio.wait_for(ws.receive_text(), START_TIMEOUT_S))
    except (asyncio.TimeoutError, ValueError, KeyError):
        return await _fail(ws, 'Send {"type": "start"} first.', "protocol", POLICY_VIOLATION)
    except WebSocketDisconnect:
        return
    language = start.get("language", "auto")
    if start.get("type") != "start" or language not in ("auto", "km", "en"):
        return await _fail(ws, 'Send {"type": "start", "language": "auto"|"km"|"en"} first.', "protocol",
                           POLICY_VIOLATION)

    app = ws.app
    user = None
    if token := start.get("token"):
        try:
            async with app.state.sessionmaker() as session:
                user = await _authenticate(token, ws, session, settings)
        except HTTPException as exc:
            return await _fail(ws, exc.detail, "auth", POLICY_VIOLATION)

    caller = Caller.of(ws, user)
    limits = Limits(app.state.redis, settings, sessionmaker=app.state.sessionmaker)
    try:
        await limits.hit("stt", caller)
        await limits.charge("stt_seconds", caller, 0, requests=1)  # some allowance must be left
    except LimitExceeded as exc:
        return await _fail(ws, str(exc), exc.reason, TRY_AGAIN_LATER)

    live = LiveTranscriber(
        transcribe=lambda audio, lang, preview: _text(stt, audio, lang, preview),
        speech_spans=stt.speech_spans, detect_language=stt.detect_language,
        language=None if language == "auto" else language,
        config=LiveConfig(pause_s=settings.stt_live_pause_s, max_window_s=settings.stt_live_max_window_s,
                          partials=settings.stt_live_partials),
    )
    await ws.send_json({"type": "ready"})

    stop = asyncio.Event()
    state = {"received_s": 0.0, "charged_s": 0, "error": None, "gone": False}

    async def receive() -> None:
        try:
            while not stop.is_set():
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    state["gone"] = True
                    break
                if message.get("bytes"):
                    state["received_s"] += live.add_pcm16(message["bytes"])
                    # Pay for whole seconds as they arrive.
                    owed = math.floor(state["received_s"]) - state["charged_s"]
                    if owed > 0:
                        await limits.charge("stt_seconds", caller, owed)
                        state["charged_s"] += owed
                    if state["received_s"] >= settings.stt_live_max_s:
                        state["error"] = (f"Live sessions are limited to {settings.stt_live_max_s // 60} min.", "length")
                        break
                elif message.get("text") and json.loads(message["text"]).get("type") == "stop":
                    break
        except LimitExceeded as exc:
            state["error"] = (str(exc), exc.reason)
        except (WebSocketDisconnect, RuntimeError):
            state["gone"] = True
        finally:
            stop.set()

    receiver = asyncio.create_task(receive())
    try:
        while not stop.is_set():
            if not live.has_new_audio:
                await asyncio.sleep(IDLE_SLEEP_S)
                continue
            for event in await run_in_threadpool(live.step):
                await ws.send_json(event)
        await receiver
        if state["gone"]:
            return
        for event in await run_in_threadpool(live.step, True):
            await ws.send_json(event)

        transcription_id = None
        if user is not None and live.text:
            async with app.state.sessionmaker() as session:
                row = Transcription(user_id=user.id, language_code=live.language or "km",
                                    transcribed_text=live.text, audio_duration_seconds=round(state["received_s"], 2))
                session.add(row)
                await session.commit()
                transcription_id = str(row.id)
        await ws.send_json({"type": "done", "text": live.text, "segmented_text": live.segmented_text,
                            "language": live.language, "duration": round(state["received_s"], 2),
                            "transcription_id": transcription_id})
        if state["error"]:
            detail, reason = state["error"]
            return await _fail(ws, detail, reason, TRY_AGAIN_LATER)
        await ws.close()
    except (WebSocketDisconnect, RuntimeError):
        pass  # the client went away mid-send
    finally:
        receiver.cancel()


def _text(stt: SttService, audio, language: str, preview: bool) -> tuple[str, str]:
    # Partials are replaced within seconds: a narrower beam is faster. (Greedy decoding loops on
    # Khmer, which is slower, not faster.) Finals use the full beam.
    result = stt.transcribe_audio(audio, language, beam_size=PREVIEW_BEAM if preview else None)
    return result.text, result.segmented_text
