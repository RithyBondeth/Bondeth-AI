"""Khmer word segmentation.

Khmer is written without spaces between words, so transcripts come back as
long unbroken runs. khmercut splits them into words, which makes the text
easier to read, edit and search.
"""

from khmercut import tokenize


def segment_words(text: str) -> list[str]:
    # khmercut returns existing whitespace as separate tokens; drop them.
    return [tok for tok in tokenize(text) if tok.strip()]


def segment_khmer(text: str, separator: str = " ") -> str:
    return separator.join(segment_words(text))
