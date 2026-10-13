"""Khmer text normalization for TTS.

TTS models only know how to pronounce letters, so digits, currency symbols,
percentages and dates must be expanded into spoken Khmer words first:

    "$25"        -> "ម្ភៃប្រាំដុល្លារ"
    "13/10/2026" -> "ថ្ងៃទីដប់បី ខែតុលា ឆ្នាំពីរពាន់ម្ភៃប្រាំមួយ"
"""

import re

DIGITS = ["សូន្យ", "មួយ", "ពីរ", "បី", "បួន", "ប្រាំ", "ប្រាំមួយ", "ប្រាំពីរ", "ប្រាំបី", "ប្រាំបួន"]
TENS = ["", "ដប់", "ម្ភៃ", "សាមសិប", "សែសិប", "ហាសិប", "ហុកសិប", "ចិតសិប", "ប៉ែតសិប", "កៅសិប"]
# Place values below one million. Each quotient here is always a single digit.
PLACES = [(100_000, "សែន"), (10_000, "ម៉ឺន"), (1_000, "ពាន់"), (100, "រយ")]
MILLION = "លាន"

MONTHS = [
    "មករា", "កុម្ភៈ", "មីនា", "មេសា", "ឧសភា", "មិថុនា",
    "កក្កដា", "សីហា", "កញ្ញា", "តុលា", "វិច្ឆិកា", "ធ្នូ",
]

DECIMAL_POINT = "ចុច"
DOLLAR = "ដុល្លារ"
CENT = "សេន"
RIEL = "រៀល"
PERCENT = "ភាគរយ"

_KHMER_DIGITS = str.maketrans("០១២៣៤៥៦៧៨៩", "0123456789")

# "1,250,000.75" (grouped) or "1250000.75" (plain)
_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_DATE_RE = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b")
_DOLLAR_RE = re.compile(rf"\$\s?({_NUM})|({_NUM})\s?\$")
_RIEL_RE = re.compile(rf"៛\s?({_NUM})|({_NUM})\s?៛")
_PERCENT_RE = re.compile(rf"({_NUM})\s?%")
_NUM_RE = re.compile(_NUM)


def verbalize_int(n: int) -> str:
    if n < 0:
        return "ដក" + verbalize_int(-n)
    if n < 10:
        return DIGITS[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        return TENS[tens] + (DIGITS[ones] if ones else "")
    if n >= 1_000_000:
        # Recursion handles billions naturally: 10^9 -> "មួយពាន់លាន"
        millions, rest = divmod(n, 1_000_000)
        return verbalize_int(millions) + MILLION + (verbalize_int(rest) if rest else "")
    for value, name in PLACES:
        if n >= value:
            q, rest = divmod(n, value)
            return DIGITS[q] + name + (verbalize_int(rest) if rest else "")
    raise AssertionError("unreachable")


def verbalize_number(token: str) -> str:
    """Verbalize a numeric string such as '1,250' or '3.75'."""
    token = token.replace(",", "")
    whole, _, frac = token.partition(".")
    words = verbalize_int(int(whole))
    if frac:
        # Digits after the point are read one by one: 3.75 -> បីចុចប្រាំពីរប្រាំ
        words += DECIMAL_POINT + "".join(DIGITS[int(d)] for d in frac)
    return words


def _verbalize_dollars(amount: str) -> str:
    amount = amount.replace(",", "")
    whole, _, frac = amount.partition(".")
    words = verbalize_int(int(whole)) + DOLLAR
    if frac and len(frac) <= 2:
        cents = int(frac.ljust(2, "0"))
        if cents:
            words += " " + verbalize_int(cents) + CENT
    elif frac:
        words = verbalize_number(amount) + DOLLAR
    return words


def _verbalize_date(m: re.Match) -> str:
    day, month, year = int(m[1]), int(m[2]), int(m[3])
    if not (1 <= day <= 31 and 1 <= month <= 12):
        return m[0]
    return f"ថ្ងៃទី{verbalize_int(day)} ខែ{MONTHS[month - 1]} ឆ្នាំ{verbalize_int(year)}"


def normalize_khmer(text: str) -> str:
    text = text.translate(_KHMER_DIGITS)
    # Order matters: specific patterns first, bare numbers last.
    text = _DATE_RE.sub(_verbalize_date, text)
    text = _DOLLAR_RE.sub(lambda m: _verbalize_dollars(m[1] or m[2]), text)
    text = _RIEL_RE.sub(lambda m: verbalize_number(m[1] or m[2]) + RIEL, text)
    text = _PERCENT_RE.sub(lambda m: verbalize_number(m[1]) + PERCENT, text)
    text = _NUM_RE.sub(lambda m: verbalize_number(m[0]), text)
    return text
