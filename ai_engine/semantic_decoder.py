"""TrOMR 토큰 → SymbolGraph (staff 접두사 지원)."""
from __future__ import annotations

import re

from ai_engine.symbol_graph import SymbolGraph, SymbolNode

_STAFF_PREFIX_RE = re.compile(r"^staff(\d+)-", re.IGNORECASE)

_TOKEN_RE = re.compile(
    r"^(?P<kind>clef|timeSignature|keySignature|note|rest|barline|beam)"
    r"(?:-(?P<body>.+))?$",
    re.IGNORECASE,
)

_PITCH_DUR_RE = re.compile(
    r"^(?P<pitch>[A-Ga-g][#b]?\d*)-(?P<dur>whole|half|quarter|eighth|16th|32nd)$"
)
_REST_DUR_RE = re.compile(r"^(?P<dur>whole|half|quarter|eighth|16th|32nd)$")

_DURATION_QUARTERS = {
    "whole": 4.0,
    "half": 2.0,
    "quarter": 1.0,
    "eighth": 0.5,
    "16th": 0.25,
    "32nd": 0.125,
}


def _strip_staff_prefix(token: str) -> tuple[str, int | None]:
    m = _STAFF_PREFIX_RE.match(token.strip())
    if not m:
        return token.strip(), None
    return token[m.end() :].strip(), int(m.group(1))


def decode_tokens(
    tokens: list[str],
    *,
    measure: int,
    staff: int,
    page: int = 1,
    system: int = 0,
    x_start: float = 0.0,
    default_staff: int | None = None,
) -> list[SymbolNode]:
    nodes: list[SymbolNode] = []
    x = x_start
    beam_open = False
    for raw_tok in tokens:
        tok, staff_from_prefix = _strip_staff_prefix(raw_tok)
        staff_id = staff_from_prefix if staff_from_prefix is not None else staff
        if default_staff is not None and staff_from_prefix is None:
            staff_id = default_staff

        m = _TOKEN_RE.match(tok)
        if not m:
            continue
        kind = m.group("kind").lower()
        body = (m.group("body") or "").strip()

        if kind == "barline":
            beam_open = False
            continue

        if kind == "beam":
            beam_open = body.lower() in ("begin", "continue", "")
            continue

        if kind == "clef":
            sign, line = _parse_clef(body or "G2")
            nodes.append(
                SymbolNode(
                    measure=measure,
                    staff=staff_id,
                    kind="clef",
                    clef_sign=sign,
                    clef_line=line,
                    page=page,
                    system=system,
                    x=x,
                )
            )
            x += 1.0
            continue

        if kind == "timesignature":
            beats, beat_type = _parse_time(body or "4/4")
            nodes.append(
                SymbolNode(
                    measure=measure,
                    staff=staff_id,
                    kind="timeSignature",
                    time_beats=beats,
                    time_beat_type=beat_type,
                    page=page,
                    system=system,
                    x=x,
                )
            )
            x += 1.0
            continue

        if kind == "rest":
            dur_type = body
            rm = _REST_DUR_RE.match(body)
            if rm:
                dur_type = rm.group("dur")
            nodes.append(
                SymbolNode(
                    measure=measure,
                    staff=staff_id,
                    kind="rest",
                    rest=True,
                    duration_type=dur_type or "quarter",
                    duration=_DURATION_QUARTERS.get(dur_type or "quarter", 1.0),
                    page=page,
                    system=system,
                    x=x,
                )
            )
            x += 1.0
            continue

        if kind == "note":
            pm = _PITCH_DUR_RE.match(body)
            if not pm:
                continue
            pitch = pm.group("pitch")
            dur_type = pm.group("dur")
            nodes.append(
                SymbolNode(
                    measure=measure,
                    staff=staff_id,
                    kind="note",
                    pitch=_normalize_pitch(pitch),
                    duration_type=dur_type,
                    duration=_DURATION_QUARTERS.get(dur_type, 1.0),
                    page=page,
                    system=system,
                    x=x,
                )
            )
            x += 1.0
    return nodes


def merge_token_streams_to_graph(
    streams: list[tuple[list[str], int, int, int, int]],
    graph: SymbolGraph | None = None,
) -> SymbolGraph:
    """(tokens, measure, staff, page, system) 목록 → SymbolGraph."""
    g = graph or SymbolGraph()
    for tokens, measure, staff, page, system in streams:
        g.extend(
            decode_tokens(
                tokens,
                measure=measure,
                staff=staff,
                page=page,
                system=system,
                default_staff=staff,
            )
        )
    return g


def _parse_clef(body: str) -> tuple[str, int]:
    body = body.upper()
    if body.startswith("F"):
        return "F", 4
    if body.startswith("C"):
        return "C", 3
    return "G", 2


def _parse_time(body: str) -> tuple[int, int]:
    if "/" in body:
        a, b = body.split("/", 1)
        try:
            return int(a), int(b)
        except ValueError:
            pass
    return 4, 4


def _normalize_pitch(pitch: str) -> str:
    pitch = pitch.strip()
    if len(pitch) < 2:
        return pitch
    step = pitch[0].upper()
    rest = pitch[1:]
    return f"{step}{rest}"
