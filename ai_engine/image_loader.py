"""PDF → 페이지/시스템 이미지."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF


@dataclass
class PageImage:
    page_index: int
    width: int
    height: int
    rgb_bytes: bytes
    dpi: int


def load_pdf_pages(pdf_path: Path, dpi: int = 300) -> list[PageImage]:
    doc = fitz.open(str(pdf_path))
    pages: list[PageImage] = []
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    try:
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=mat, alpha=False)
            pages.append(
                PageImage(
                    page_index=i,
                    width=pix.width,
                    height=pix.height,
                    rgb_bytes=pix.samples,
                    dpi=dpi,
                )
            )
    finally:
        doc.close()
    return pages
