#!/usr/bin/env python3
"""PDF diagnostic helpers (PyMuPDF).

Usage:
  pdf_diagnostic.py info <pdf_path>
      Print JSON: {"pageCount": N}

  pdf_diagnostic.py render <pdf_path> <page_1based> <out_png_path> [dpi]
      Rasterize one page to PNG (RGB, no alpha).

  pdf_diagnostic.py pagesizes <pdf_path>
      Print JSON: {"pageCount": N, "pages": [{"widthPt":…,"heightPt":…}, ...]}
"""
from __future__ import annotations

import json
import os
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: pdf_diagnostic.py info|render ...", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "info":
        if len(sys.argv) < 3:
            sys.exit(1)
        path = sys.argv[2]
        import fitz  # PyMuPDF

        doc = fitz.open(path)
        n = doc.page_count
        doc.close()
        print(json.dumps({"pageCount": n}))
        return

    if cmd == "render":
        if len(sys.argv) < 5:
            sys.exit(1)
        path = sys.argv[2]
        page_1 = int(sys.argv[3])
        out_png = sys.argv[4]
        dpi = float(sys.argv[5]) if len(sys.argv) > 5 else 144.0
        import fitz  # PyMuPDF

        doc = fitz.open(path)
        idx = page_1 - 1
        if idx < 0 or idx >= doc.page_count:
            doc.close()
            sys.exit(2)
        page = doc[idx]
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        # colorspace를 RGB로 고정(일부 DeviceCMYK·특수 색공간 PDF가 기본 래스터에서 검게 나오는 경우 완화)
        try:
            if os.path.isfile(out_png):
                os.remove(out_png)
        except OSError:
            pass
        pix = page.get_pixmap(matrix=mat, alpha=False, colorspace="rgb")
        pix.save(out_png)
        doc.close()
        return

    if cmd == "pagesizes":
        if len(sys.argv) < 3:
            sys.exit(1)
        path = sys.argv[2]
        import fitz  # PyMuPDF

        doc = fitz.open(path)
        pages: list[dict[str, float]] = []
        for i in range(doc.page_count):
            r = doc[i].rect
            pages.append({"widthPt": float(r.width), "heightPt": float(r.height)})
        doc.close()
        print(json.dumps({"pageCount": len(pages), "pages": pages}))
        return

    sys.exit(1)


if __name__ == "__main__":
    main()
