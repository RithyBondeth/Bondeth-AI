"""Plain-text SRT/WebVTT serialization without treating transcript text as markup."""
import html
import math


def timestamp(seconds: float, separator: str = ".") -> str:
    total = math.floor(seconds * 1000 + 0.5)
    hours, rest = divmod(total, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    whole, milliseconds = divmod(rest, 1000)
    return f"{hours:02}:{minutes:02}:{whole:02}{separator}{milliseconds:03}"


def subtitle_text(segments: list[dict], format: str) -> str:
    blocks = []
    for segment in segments:
        # Empty lines delimit cues. Collapse them inside a payload and escape text
        # so names containing <, &, or --> cannot become formatting/timing syntax.
        text = str(segment["text"]).replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
        text = "\n".join(line.strip() for line in text.split("\n") if line.strip())
        if not text:
            continue
        if not (math.isfinite(segment["start"]) and math.isfinite(segment["end"])):
            continue
        if segment["start"] < 0 or math.floor(segment["end"] * 1000 + 0.5) <= math.floor(segment["start"] * 1000 + 0.5):
            continue
        text = html.escape(text, quote=False).replace("-->", "--&gt;")
        separator = "," if format == "srt" else "."
        timing = f"{timestamp(segment['start'], separator)} --> {timestamp(segment['end'], separator)}"
        blocks.append(f"{len(blocks) + 1}\n{timing}\n{text}")
    if not blocks:
        raise ValueError("No timed subtitle text is available")
    return ("WEBVTT\n\n" if format == "vtt" else "") + "\n\n".join(blocks) + "\n"
