#!/usr/bin/env python3
"""이미지 악보 PDF를 OMR에 충분한 해상도로 JPEG 재압축.

스캔/마스킹 후 페이지가 비압축 PNG로 남으면 수백 MB가 되고 omr-work ZIP 저장이 멈춘 것처럼 길어진다.
픽셀 크기(약 300 DPI)는 유지하고 JPEG만 써서 Audiveris 인식률을 지킨다.
벡터 전용 PDF는 손대지 않는다.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

_JPEG_QUALITY = 82
_MIN_BYTES = 12 * 1024 * 1024


def compress_score_pdf(
    pdf_path: str | Path,
    out_path: str | Path | None = None,
    *,
    jpeg_quality: int = _JPEG_QUALITY,
    min_bytes: int = _MIN_BYTES,
) -> dict[str, Any]:
    import fitz

    src = Path(pdf_path)
    dest = Path(out_path) if out_path else src
    before = src.stat().st_size if src.is_file() else 0
    stats: dict[str, Any] = {
        "path": str(dest),
        "beforeBytes": before,
        "afterBytes": before,
        "imagesConverted": 0,
        "skipped": False,
        "reason": "",
    }
    if not src.is_file():
        stats["skipped"] = True
        stats["reason"] = "missing"
        return stats
    if before < min_bytes:
        stats["skipped"] = True
        stats["reason"] = "small"
        return stats

    doc = fitz.open(src)
    converted = 0
    try:
        for page in doc:
            for im in page.get_images(full=True):
                xref = int(im[0])
                try:
                    pix = fitz.Pixmap(doc, xref)
                except Exception:
                    continue
                if pix.n - pix.alpha >= 4 or pix.alpha:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                try:
                    jpg = pix.tobytes("jpeg", jpg_quality=jpeg_quality)
                except TypeError:
                    jpg = pix.tobytes("jpeg")
                pix = None
                if not jpg:
                    continue
                try:
                    page.replace_image(xref, stream=jpg)
                    converted += 1
                except Exception:
                    continue

        if converted == 0:
            stats["skipped"] = True
            stats["reason"] = "no-raster-or-convert-failed"
            return stats

        tmp_fd, tmp_name = tempfile.mkstemp(suffix=".pdf", dir=str(dest.parent))
        os.close(tmp_fd)
        try:
            doc.save(tmp_name, deflate=True, garbage=4)
            doc.close()
            doc = None
            os.replace(tmp_name, dest)
        except Exception:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
            raise
        after = dest.stat().st_size
        stats["afterBytes"] = after
        stats["imagesConverted"] = converted
        if after >= before * 0.9:
            stats["skipped"] = True
            stats["reason"] = "no-gain"
        return stats
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "pdf path required"}))
        return 2
    src = Path(sys.argv[1])
    dest = Path(sys.argv[2]) if len(sys.argv) > 2 else src
    try:
        stats = compress_score_pdf(src, dest)
        print(json.dumps(stats, ensure_ascii=False))
        return 0
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
