"""AI OMR pipeline 결과."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RunResult:
    mxl_paths: list[str]
    symbol_graph_path: str | None = None
    backend: str = "homr"
    measure_count: int = 0
    node_count: int = 0
    stats: dict = field(default_factory=dict)
