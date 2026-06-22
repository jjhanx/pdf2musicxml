"""Voice 할당 — 1차 규칙 기반, 후속 GATv2 교체 예정."""
from __future__ import annotations

from ai_engine.config import AiOmrConfig
from ai_engine.symbol_graph import SymbolGraph, SymbolNode


def assign_voices(graph: SymbolGraph, config: AiOmrConfig | None = None) -> SymbolGraph:
    """staff별 기본 voice=1, 피아노 LH(staff 5)는 voice 5+ 규칙(기존 Audiveris 관례)."""
    _ = config
    for node in graph.nodes:
        if node.kind not in ("note", "rest"):
            continue
        if node.voice is not None:
            continue
        if node.staff >= 4:
            # 피아노 PR=4 → v1, PL=5 → v5 (Audiveris 관례에 맞춤)
            node.voice = 1 if node.staff == 4 else 5
        else:
            node.voice = 1
    return graph


def assign_voices_by_rules(graph: SymbolGraph) -> SymbolGraph:
    """확장 규칙: backup/forward 대신 x순 voice 분리(미래)."""
    return assign_voices(graph)
