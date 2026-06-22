"""AI OMR end-to-end pipeline."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from ai_engine.config import AiOmrConfig, load_config
from ai_engine.image_loader import load_pdf_pages
from ai_engine.musicxml_builder import write_mxl
from ai_engine.rhythm_corrector import correct_rhythm
from ai_engine.semantic_decoder import merge_token_streams_to_graph
from ai_engine.symbol_graph import SymbolGraph
from ai_engine.system_splitter import split_page_into_systems
from ai_engine.tr_omr_engine import TrOmrEngine
from ai_engine.voice_assigner import assign_voices

logger = logging.getLogger(__name__)


@dataclass
class RunResult:
    mxl_paths: list[str]
    symbol_graph_path: str | None = None
    backend: str = "mock"
    measure_count: int = 0
    node_count: int = 0
    stats: dict = field(default_factory=dict)


def run_ai_omr_pipeline(
    pdf_path: Path,
    output_dir: Path,
    config: AiOmrConfig | None = None,
) -> RunResult:
    cfg = config or load_config()
    output_dir.mkdir(parents=True, exist_ok=True)

    pages = load_pdf_pages(pdf_path, dpi=cfg.dpi)
    engine = TrOmrEngine(cfg)
    streams: list[tuple[list[str], int, int, int, int]] = []
    measure_counter = 1
    backends: set[str] = set()

    for page in pages:
        systems = split_page_into_systems(page, max_systems=1)
        for system in systems:
            result = engine.recognize_system(system)
            backends.add(result.backend)
            staff = min(system.system_index, max(0, cfg.total_staves() - 1))
            streams.append(
                (result.tokens, measure_counter, staff, page.page_index + 1, system.system_index)
            )
            measure_counter += 1

    graph: SymbolGraph = merge_token_streams_to_graph(streams)
    graph.metadata.update(
        {
            "source_pdf": str(pdf_path),
            "backend": ",".join(sorted(backends)) or cfg.backend,
            "dpi": cfg.dpi,
        }
    )
    assign_voices(graph, cfg)
    correct_rhythm(graph, mode="off")

    sg_path: Path | None = None
    if cfg.save_symbol_graph:
        sg_path = output_dir / f"{cfg.output_basename}.symbol_graph.json"
        graph.save_json(sg_path)

    mxl_path = output_dir / f"{cfg.output_basename}.mxl"
    write_mxl(graph, cfg, mxl_path)

    return RunResult(
        mxl_paths=[str(mxl_path.resolve())],
        symbol_graph_path=str(sg_path.resolve()) if sg_path else None,
        backend=",".join(sorted(backends)) or cfg.backend,
        measure_count=graph.max_measure(),
        node_count=len(graph.nodes),
        stats={"pages": len(pages), "systems": len(streams)},
    )
