"""Split bilingual text into Khmer and English runs.

Each MMS model only understands its own script, so code-switched input like
"ខ្ញុំប្រើ Facebook រាល់ថ្ងៃ" must be voiced by both models in turn.
"""

import re
from dataclasses import dataclass

_KHMER_RE = re.compile(r"[ក-៿᧠-᧿]")
_LATIN_RE = re.compile(r"[A-Za-z]")
# Sentence ends: Khmer khan (។), bariyoosan (៕), and Latin punctuation.
_SENTENCE_RE = re.compile(r"(?<=[។៕?!.])\s*|\n+")


@dataclass
class Run:
    lang: str  # "km" | "en"
    text: str


def char_lang(ch: str) -> str | None:
    if _KHMER_RE.match(ch):
        return "km"
    if _LATIN_RE.match(ch):
        return "en"
    return None  # digits, spaces, punctuation: belong to whatever surrounds them


def dominant_lang(text: str) -> str:
    km = len(_KHMER_RE.findall(text))
    en = len(_LATIN_RE.findall(text))
    return "en" if en > km else "km"


def split_runs(text: str, default: str) -> list[Run]:
    """Group characters into same-script runs; neutral characters join the current run."""
    runs: list[Run] = []
    current_lang: str | None = None
    buf: list[str] = []
    for ch in text:
        lang = char_lang(ch)
        if lang and current_lang and lang != current_lang:
            runs.append(Run(current_lang, "".join(buf)))
            buf = []
        if lang:
            current_lang = lang
        buf.append(ch)
    if buf:
        runs.append(Run(current_lang or default, "".join(buf)))
    return [r for r in runs if r.text.strip()]


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_RE.split(text) if s and s.strip()]
