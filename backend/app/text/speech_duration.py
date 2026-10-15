"""Conservative Khmer timing budget for fixed-duration speech generation."""
import re


def khmer_speech_duration(text: str, speed: float = 1.0, chars_per_second: float = 12.0) -> float | None:
    khmer = len(re.findall(r"[ក-៓]", text))
    if not khmer:
        return None  # retain the model's English duration estimator
    words = len(re.findall(r"[A-Za-z]+(?:['-][A-Za-z]+)*", text))
    pauses = len(re.findall(r"[។៕.!?,;៖]", text)) * 0.12
    return max(1.2 / speed, (khmer / chars_per_second + words / 2.8 + pauses) / speed)
