"""SymbolGraph — Audiveris MusicXML을 대체하는 내부 OMR 표현."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterator


@dataclass
class SymbolNode:
    measure: int
    staff: int

    pitch: str | None = None
    duration: float | None = None
    duration_type: str | None = None
    rest: bool = False
    voice: int | None = None

    x: float = 0.0
    y: float = 0.0
    lyric: str | None = None

    confidence_pitch: float = 1.0
    confidence_duration: float = 1.0

    kind: str = "note"  # note | rest | clef | timeSignature | barline | keySignature
    clef_sign: str | None = None
    clef_line: int | None = None
    time_beats: int | None = None
    time_beat_type: int | None = None
    page: int = 1
    system: int = 0

    def sort_key(self) -> tuple[int, int, float, float]:
        return (self.measure, self.staff, self.x, self.y)


@dataclass
class SymbolGraph:
    nodes: list[SymbolNode] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def add(self, node: SymbolNode) -> None:
        self.nodes.append(node)

    def extend(self, nodes: list[SymbolNode]) -> None:
        self.nodes.extend(nodes)

    def sorted_nodes(self) -> list[SymbolNode]:
        return sorted(self.nodes, key=lambda n: n.sort_key())

    def by_measure_staff(self) -> dict[tuple[int, int], list[SymbolNode]]:
        out: dict[tuple[int, int], list[SymbolNode]] = {}
        for n in self.sorted_nodes():
            if n.kind not in ("note", "rest"):
                continue
            key = (n.measure, n.staff)
            out.setdefault(key, []).append(n)
        return out

    def max_measure(self) -> int:
        if not self.nodes:
            return 0
        return max(n.measure for n in self.nodes)

    def to_dict(self) -> dict[str, Any]:
        return {
            "metadata": self.metadata,
            "nodes": [asdict(n) for n in self.nodes],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SymbolGraph:
        nodes = [SymbolNode(**row) for row in data.get("nodes", [])]
        return cls(nodes=nodes, metadata=dict(data.get("metadata") or {}))

    def save_json(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")

    @classmethod
    def load_json(cls, path: Path) -> SymbolGraph:
        return cls.from_dict(json.loads(path.read_text(encoding="utf-8")))

    def iter_music_events(self) -> Iterator[SymbolNode]:
        for n in self.sorted_nodes():
            if n.kind in ("note", "rest"):
                yield n
