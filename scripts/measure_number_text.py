#!/usr/bin/env python3
"""PDF·OCR 마디 번호 문자열 정규화 — shared/measureNumberText.ts 와 동일 규칙."""
from __future__ import annotations

import re

_PUA_RE = re.compile(r"[\uE000-\uF8FF]")
_DIGIT_RUN_RE = re.compile(r"\d{1,3}")


def _map_special_digit(code: int) -> str | None:
    if 0x2460 <= code <= 0x2473:
        return str(code - 0x2460 + 1)
    if 0x2474 <= code <= 0x2487:
        return str(code - 0x2474 + 1)
    if 0x3251 <= code <= 0x325F:
        return str(code - 0x3251 + 21)
    if 0xFF10 <= code <= 0xFF19:
        return str(code - 0xFF10)
    if 0x30 <= code <= 0x39:
        return chr(code)
    return None


def normalize_printed_measure_number_text(raw: str) -> str | None:
    """①, ⓵, ㈀, (1), １, PUA 제거 후 ASCII 숫자 라벨."""
    trimmed = _PUA_RE.sub("", str(raw or "")).strip()
    if not trimmed:
        return None

    digits = ""
    for ch in trimmed:
        mapped = _map_special_digit(ord(ch))
        if mapped is not None:
            digits += mapped
            continue
        if ch.isdigit():
            digits += ch

    if not digits:
        digits = re.sub(r"\D", "", trimmed)

    if not re.fullmatch(r"\d{1,3}", digits):
        return None
    n = int(digits)
    if n < 1 or n > 999:
        return None
    return digits
