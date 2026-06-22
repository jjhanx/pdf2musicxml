"""Rhythm corrector — OMR 충실 원칙: 자동 duration 추정 없음.

기존 verify_*.py / fix_audiveris_mxl.py 는 MusicXML 단계에서 그대로 재사용.
SymbolGraph 단계에서는 pass-through만 수행.
"""
from __future__ import annotations

from ai_engine.symbol_graph import SymbolGraph


def correct_rhythm(graph: SymbolGraph, *, mode: str = "off") -> SymbolGraph:
    """mode=off: 변경 없음. legacy/beams 등은 MusicXML 후처리에서 처리."""
    _ = mode
    return graph
