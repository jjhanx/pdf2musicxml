"""homr 백엔드 — PDF 페이지별 homr OMR → MusicXML 병합 → MXL."""
from __future__ import annotations

import copy
import logging
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import fitz

from ai_engine.config import AiOmrConfig
from ai_engine.run_result import RunResult

logger = logging.getLogger(__name__)


def _local_tag(el: ET.Element) -> str:
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def _renumber_measures(root: ET.Element) -> None:
    parts = root.findall("part")
    if not parts:
        return
    max_measures = max(len(p.findall("measure")) for p in parts)
    for mi in range(max_measures):
        num = str(mi + 1)
        for part in parts:
            measures = part.findall("measure")
            if mi < len(measures):
                measures[mi].set("number", num)


def _merge_partwise_pages(xml_paths: list[Path]) -> ET.Element:
    if not xml_paths:
        raise RuntimeError("homr produced no MusicXML files")
    trees = [ET.parse(p) for p in xml_paths]
    roots = [t.getroot() for t in trees]
    if _local_tag(roots[0]) != "score-partwise":
        raise RuntimeError(f"Expected score-partwise, got {roots[0].tag}")

    merged = copy.deepcopy(roots[0])
    base_parts = merged.findall("part")
    for doc_root in roots[1:]:
        doc_parts = doc_root.findall("part")
        for i, part in enumerate(doc_parts):
            if i < len(base_parts):
                for measure in part.findall("measure"):
                    base_parts[i].append(copy.deepcopy(measure))
            else:
                merged.append(copy.deepcopy(part))
    _renumber_measures(merged)
    return merged


def _write_mxl_from_root(root: ET.Element, output_path: Path, basename: str) -> Path:
    xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    xml_name = f"{basename}.xml"
    container = f"""<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="{xml_name}" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>
"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("META-INF/container.xml", container)
        z.writestr(xml_name, xml_bytes)
    return output_path


def _render_pdf_pages(pdf_path: Path, out_dir: Path, dpi: int) -> list[Path]:
    doc = fitz.open(str(pdf_path))
    paths: list[Path] = []
    try:
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        for i in range(doc.page_count):
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            png = out_dir / f"page_{i + 1:03d}.png"
            pix.save(str(png))
            paths.append(png)
    finally:
        doc.close()
    if not paths:
        raise RuntimeError(f"PDF has no pages: {pdf_path}")
    return paths


def _run_homr_on_image(image_path: Path, python_bin: str) -> Path:
    xml_path = image_path.with_suffix(".musicxml")
    if xml_path.exists():
        xml_path.unlink()
    cmd = [python_bin, "-m", "homr", str(image_path)]
    logger.info("Running homr on %s", image_path.name)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"homr failed on {image_path.name} (exit {proc.returncode}): {err}")
    if not xml_path.is_file():
        raise RuntimeError(f"homr did not create {xml_path}")
    return xml_path


def run_homr_pdf_pipeline(
    pdf_path: Path,
    output_dir: Path,
    config: AiOmrConfig,
    python_bin: str | None = None,
) -> RunResult:
    py = python_bin or sys.executable
    output_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="homr-pages-") as tmp:
        tmp_dir = Path(tmp)
        page_pngs = _render_pdf_pages(pdf_path, tmp_dir, config.dpi)
        xml_paths: list[Path] = []
        for png in page_pngs:
            xml_paths.append(_run_homr_on_image(png, py))

        merged_root = _merge_partwise_pages(xml_paths)
        mxl_path = output_dir / f"{config.output_basename}.mxl"
        _write_mxl_from_root(merged_root, mxl_path, config.output_basename)

    measure_count = len(merged_root.findall(".//measure"))

    return RunResult(
        mxl_paths=[str(mxl_path.resolve())],
        symbol_graph_path=None,
        backend="homr",
        measure_count=measure_count,
        node_count=0,
        stats={"pages": len(page_pngs), "homr_pages": len(xml_paths)},
    )
