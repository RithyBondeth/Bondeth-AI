import numpy as np
import pytest

from app.config import get_settings
from app.deps import get_stt_service
from app.main import app
from app.services.live_stt import SAMPLE_RATE, LiveConfig, LiveTranscriber
from app.services.stt import Transcription


def tone(seconds: float) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def pcm16(audio: np.ndarray) -> bytes:
    return (audio * 32767).astype("<i2").tobytes()


def speech_spans(audio: np.ndarray) -> list[tuple[float, float]]:
    """Loud 10 ms frames are speech."""
    frame = SAMPLE_RATE // 100
    loud = [np.abs(audio[i:i + frame]).max() > 0.05 for i in range(0, len(audio) - frame + 1, frame)]
    spans, start = [], None
    for i, on in enumerate(loud + [False]):
        if on and start is None:
            start = i
        elif not on and start is not None:
            spans.append((start / 100, i / 100))
            start = None
    return spans


class FakeEngine:
    def __init__(self):
        self.calls, self.detected = [], 0

    def transcribe(self, audio, lang, preview=False):
        self.calls.append((round(len(audio) / SAMPLE_RATE, 2), lang, preview))
        speech = sum(e - s for s, e in speech_spans(audio))
        return (f"{lang}:{speech:.1f}", f"{lang} {speech:.1f}") if speech else ("", "")

    def detect(self, audio):
        self.detected += 1
        return "km"


@pytest.fixture
def engine():
    return FakeEngine()


def live(engine, language="km", **config):
    return LiveTranscriber(engine.transcribe, speech_spans, engine.detect, language, LiveConfig(**config))


def feed(t: LiveTranscriber, *pieces) -> list[dict]:
    for piece in pieces:
        t.add_pcm16(pcm16(piece))
    return t.step()


# --- Policy ------------------------------------------------------------------------

def test_partials_while_speaking(engine):
    t = live(engine)
    assert feed(t, tone(1.0)) == [{"type": "partial", "text": "km:1.0"}]
    assert feed(t, tone(0.5)) == [{"type": "partial", "text": "km:1.5"}]  # the whole phrase so far
    assert t.finals == []


def test_a_pause_finalizes_the_phrase(engine):
    t = live(engine)
    feed(t, tone(1.0))
    events = feed(t, silence(0.8))
    assert events[0] == {"type": "final", "text": "km:1.0", "segmented_text": "km 1.0", "start": 0.0, "end": 1.2}
    assert events[1] == {"type": "partial", "text": ""}  # clears the client's partial
    # The next phrase is timed from where the last one ended.
    feed(t, tone(1.0), silence(0.8))
    assert t.finals[-1]["start"] == 1.2 and t.text == "km:1.0 km:1.0"


def test_long_silence_is_dropped_without_transcribing(engine):
    t = live(engine)
    assert feed(t, silence(3.5)) == []
    assert engine.calls == [] and t.offset_s == pytest.approx(3.0)
    feed(t, tone(1.0), silence(0.8))
    assert t.finals[0]["start"] == pytest.approx(3.0)


def test_a_long_phrase_is_cut_at_its_last_gap(engine):
    t = live(engine, max_window_s=6.0)
    feed(t, tone(2.5), silence(0.3), tone(3.4))  # 6.2 s, no pause long enough to end it
    assert t.finals[0]["end"] == pytest.approx(2.5)
    assert t.step() == [{"type": "partial", "text": "km:3.4"}]  # the rest of the phrase carries on


def test_pauses_inside_a_backlog_each_end_a_phrase(engine):
    t = live(engine)  # all of it arrives before the model gets a turn (slow CPU)
    events = feed(t, tone(1.0), silence(0.8), tone(1.5), silence(0.7), tone(0.5))
    assert [e["text"] for e in events if e["type"] == "final"] == ["km:1.0", "km:1.5"]
    assert events[-1] == {"type": "partial", "text": "km:0.5"}


def test_auto_mode_detects_the_language_once(engine):
    t = live(engine, language=None)
    assert feed(t, tone(1.0)) == []  # not enough speech to tell yet
    assert feed(t, tone(1.0))[0]["text"] == "km:2.0"
    feed(t, tone(1.0))
    assert engine.detected == 1 and t.language == "km"


def test_finish_finalizes_what_is_left(engine):
    t = live(engine)
    feed(t, tone(1.0))
    t.add_pcm16(pcm16(tone(0.4)))
    events = t.step(finish=True)
    assert events[0]["type"] == "final" and events[0]["text"] == "km:1.4"
    assert t.step(finish=True) == []


def test_partials_are_previews_and_finals_are_not(engine):
    t = live(engine)
    feed(t, tone(1.0))
    feed(t, silence(0.8))
    assert [preview for _, _, preview in engine.calls] == [True, False]


def test_partials_can_be_turned_off(engine):
    t = live(engine, partials=False)
    assert feed(t, tone(1.0)) == []
    assert feed(t, silence(0.8))[0]["text"] == "km:1.0"
    assert [preview for _, _, preview in engine.calls] == [False]  # only finals were decoded


def test_looping_previews_are_dropped():
    from app.services.live_stt import looks_degenerate
    assert looks_degenerate("វា និង និង និង និង និង និង និង")
    assert looks_degenerate("កាន់តែនៅស្រាប់ស្រាប់ស្រាប់ស្រាប់ស្រាប់ស្រាប់")  # no spaces in Khmer
    assert not looks_degenerate("ខ្ពស់ខ្ពស់ជាងគេ")  # a word said twice is fine
    assert not looks_degenerate("ការដាំឡើយសម្លៀកបំពាក់គឺធ្ងន់ ទទួលឥទ្ធិពលដោយវប្បធម៌")
    assert not looks_degenerate("yes yes")


def test_odd_byte_counts_are_tolerated(engine):
    t = live(engine)
    assert t.add_pcm16(b"\x00\x01\x02") == pytest.approx(1 / SAMPLE_RATE)


# --- WebSocket ---------------------------------------------------------------------

class FakeStt:
    def __init__(self):
        self.engine = FakeEngine()

    def transcribe_audio(self, audio, language=None, beam_size=None):
        text, segmented = self.engine.transcribe(audio, language, beam_size == 1)
        return Transcription(language, 1.0, len(audio) / SAMPLE_RATE, text, segmented)

    speech_spans = staticmethod(speech_spans)

    def detect_language(self, audio):
        return self.engine.detect(audio)


@pytest.fixture
def fake_stt(client):
    stt = FakeStt()
    app.dependency_overrides[get_stt_service] = lambda: stt
    return stt


def dictate(client, audio_pieces, token=None, language="km"):
    """Run a whole session; returns every message the server sent."""
    received = []
    with client.websocket_connect("/api/v1/stt/live") as ws:
        ws.send_json({"type": "start", "language": language, **({"token": token} if token else {})})
        received.append(ws.receive_json())
        if received[-1]["type"] != "ready":
            return received
        for piece in audio_pieces:
            ws.send_bytes(pcm16(piece))
        ws.send_json({"type": "stop"})
        while True:
            received.append(ws.receive_json())
            if received[-1]["type"] in ("done", "error"):
                if received[-1]["type"] == "done":
                    try:
                        received.append(ws.receive_json())  # a closing error, if any
                    except Exception:
                        pass
                return received


def test_dictation_session(client, fake_stt):
    messages = dictate(client, [tone(1.0), silence(0.8), tone(1.0)])
    assert messages[0] == {"type": "ready"}
    done = messages[-1]
    assert done["type"] == "done" and done["text"] == "km:1.0 km:1.0"
    assert done["duration"] == pytest.approx(2.8) and done["transcription_id"] is None
    assert any(m["type"] == "final" for m in messages[1:-1])
    assert client.get("/api/v1/usage").json()["quotas"]["stt_seconds"]["used"] == 2  # whole seconds


def test_signed_in_dictation_is_saved_to_history(client, fake_stt, register):
    token = register()["Authorization"].split()[1]
    done = dictate(client, [tone(1.0)], token=token)[-1]
    assert done["transcription_id"]
    history = client.get("/api/v1/transcriptions", headers={"Authorization": f"Bearer {token}"}).json()
    assert history["items"][0]["transcribed_text"] == "km:1.0"
    detail = client.get(f"/api/v1/transcriptions/{done['transcription_id']}", headers={"Authorization": f"Bearer {token}"}).json()
    assert detail["segments"] == done["segments"] == [{"start": 0.0, "end": 1.0, "text": "km:1.0"}]


def test_bad_token_is_refused(client, fake_stt):
    error = dictate(client, [], token="not-a-token")[-1]
    assert error["type"] == "error" and error["reason"] == "auth"


def test_must_start_properly(client, fake_stt):
    with client.websocket_connect("/api/v1/stt/live") as ws:
        ws.send_json({"type": "start", "language": "fr"})
        assert ws.receive_json()["reason"] == "protocol"


def test_allowance_runs_out_mid_session(client, fake_stt, monkeypatch):
    monkeypatch.setattr(get_settings(), "quota_stt_seconds_anon", 2)
    messages = dictate(client, [tone(1.0), tone(1.0), tone(1.0), tone(1.0)])
    assert messages[-2]["type"] == "done"  # what was said still comes back
    assert messages[-1]["type"] == "error" and messages[-1]["reason"] == "quota"
    assert client.get("/api/v1/usage").json()["quotas"]["stt_seconds"]["used"] == 2


def test_no_allowance_left_refuses_the_session(client, fake_stt, monkeypatch):
    monkeypatch.setattr(get_settings(), "quota_stt_seconds_anon", 0)
    error = dictate(client, [])[-1]
    assert error["type"] == "error" and error["reason"] == "quota"
