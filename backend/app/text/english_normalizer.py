"""English text normalization for TTS.

The MMS English model only knows lowercase letters, apostrophes and hyphens
(it is even missing the digits 7-9), so numbers and symbols are spelled out.
"""

import re

from num2words import num2words

_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_DOLLAR_RE = re.compile(rf"\$\s?({_NUM})|({_NUM})\s?\$")
_RIEL_RE = re.compile(rf"៛\s?({_NUM})|({_NUM})\s?៛")
_PERCENT_RE = re.compile(rf"({_NUM})\s?%")
_ORDINAL_RE = re.compile(r"\b(\d+)(?:st|nd|rd|th)\b", re.IGNORECASE)
_NUM_RE = re.compile(_NUM)


def _words(token: str) -> str:
    token = token.replace(",", "")
    value = float(token) if "." in token else int(token)
    # "one thousand, two hundred" -> "one thousand two hundred"
    return num2words(value).replace(",", "")


def _dollars(amount: str) -> str:
    amount = amount.replace(",", "")
    whole, _, frac = amount.partition(".")
    dollars = int(whole)
    words = f"{_words(whole)} dollar{'' if dollars == 1 else 's'}"
    if frac and len(frac) <= 2 and int(frac.ljust(2, "0")):
        cents = int(frac.ljust(2, "0"))
        words += f" and {_words(str(cents))} cent{'' if cents == 1 else 's'}"
    return words


def normalize_english(text: str, lowercase: bool = True) -> str:
    """Spell out numbers and symbols. MMS needs lowercase; other engines keep casing."""
    text = _DOLLAR_RE.sub(lambda m: _dollars(m[1] or m[2]), text)
    text = _RIEL_RE.sub(lambda m: _words(m[1] or m[2]) + " riel", text)
    text = _PERCENT_RE.sub(lambda m: _words(m[1]) + " percent", text)
    text = _ORDINAL_RE.sub(lambda m: num2words(int(m[1]), to="ordinal"), text)
    text = _NUM_RE.sub(lambda m: _words(m[0]), text)
    text = text.replace("&", " and ")
    return text.lower() if lowercase else text
