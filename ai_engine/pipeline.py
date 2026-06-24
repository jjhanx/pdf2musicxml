"""AI OMR end-to-end pipeline."""
from __future__ import annotations

import logging
from pathlib import Path

from ai_engine.config import AiOmrConfig, load_config
from ai_engine.image_loader import load_pdf_pages
from ai_engine.musicxml_builder import write_mxl
from ai_engine.rhythm_corrector import correct_rhythm
from ai_engine.run_result import RunResult

__all__ = ["RunResult", "run_ai_omr_pipeline"]
from ai_engine.semantic_decoder import merge_token_streams_to_graph
from ai_engine.staff_splitter import split_system_into_staves
from ai_engine.symbol_graph import SymbolGraph
from ai_engine.system_splitter import split_page_into_systems
from ai_engine.tr_omr_engine import TrOmrEngine
from ai_engine.voice_assigner import assign_voices

logger = logging.getLogger(__name__)


def run_ai_omr_pipeline(    pdf_path: Path,
    output_dir: Path,
    config: AiOmrConfig | None = None,
) -> RunResult:
    cfg = config or load_config()
    output_dir.mkdir(parents=True, exist_ok=True)

    if cfg.backend == "homr":
        from ai_engine.homr_pipeline import run_homr_pdf_pipeline

        return run_homr_pdf_pipeline(pdf_path, output_dir, cfg)

    engine = TrOmrEngine(cfg)
    pages = load_pdf_pages(pdf_path, dpi=cfg.dpi)
    streams: list[tuple[list[str], int, int, int, int]] = []
    measure_counter = 1
    backends: set[str] = set()
    system_count = 0
    staff_crop_count = 0

    fixed = cfg.systems_per_page_fixed if cfg.systems_mode == "fixed" else 1

    for page in pages:
        systems = split_page_into_systems(
            page,
            mode=cfg.systems_mode,
            fixed_count=fixed,
        )
        for system in systems:
            system_count += 1
            measure_no = measure_counter
            measure_counter += 1

            if cfg.split_staves:
                staff_images = split_system_into_staves(
                    system,
                    staves_per_system=cfg.staves_per_system,
                    margin_px=cfg.staff_margin_px,
                )
                for staff_img in staff_images:
                    staff_crop_count += 1
                    global_staff = cfg.global_staff_index(staff_img.staff_index)
                    result = engine.recognize(staff_img, staff_index=global_staff)
                    backends.add(result.backend)
                    streams.append(
                        (
                            result.tokens,
                            measure_no,
                            global_staff,
                            page.page_index + 1,
                            system.system_index,
                        )
                    )
            else:
                result = engine.recognize_system(system)
                backends.add(result.backend)
                streams.append(
                    (
                        result.tokens,
                        measure_no,
                        0,
                        page.page_index + 1,
                        system.system_index,
                    )
                )

    graph: SymbolGraph = merge_token_streams_to_graph(streams)
    graph.metadata.update(
        {
            "source_pdf": str(pdf_path),
            "backend": ",".join(sorted(backends)) or cfg.backend,
            "dpi": cfg.dpi,
            "systems_mode": cfg.systems_mode,
            "split_staves": cfg.split_staves,
            "staves_per_system": cfg.staves_per_system,
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
        stats={
            "pages": len(pages),
            "systems": system_count,
            "staff_crops": staff_crop_count,
        },
    )
