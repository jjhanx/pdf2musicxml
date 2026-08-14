#!/usr/bin/env python3
"""마스킹 후 비압축으로 풀린 이미지 스트림만 무손실 압축.

원본 JPEG를 다시 JPEG로 넣으면(품질 82 등) 손실이 생겨 OMR이 연속 쉼표 마디로
오인한다. 이미 작은 JPEG는 그대로 두고, 비압축/과대 PNG 스트림만 같은 픽셀로
PNG(Flate) 한다. 벡터 PDF는 건너뛴다.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

_MIN_BYTES = 2 * 1024 * 1024
# 픽셀 raw 대비 이보다 작으면 이미 압축된 것으로 본다.
_ALREADY_COMPRESSED_RATIO = 0.40


def compress_score_pdf(
    pdf_path: str | Path,
    out_path: str | Path | None = None,
    *,
    min_bytes: int = _MIN_BYTES,
    reference_path: str | Path | None = None,
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
        "mode": "lossless-png",
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
                    info = doc.extract_image(xref)
                except Exception:
                    continue
                if not info:
                    continue
                ext = str(info.get("ext") or "").lower()
                blob = info.get("image") or b""
                w = int(info.get("width") or 0)
                h = int(info.get("height") or 0)
                if w <= 0 or h <= 0 or not blob:
                    continue
                # 원본 JPEG는 건드리지 않음 — 재인코딩이 OMR 쉼표 오인의 원인
                if ext in ("jpeg", "jpg", "jpx", "jp2"):
                    continue
                raw_est = w * h * 3
                if raw_est > 0 and len(blob) < raw_est * _ALREADY_COMPRESSED_RATIO:
                    continue
                try:
                    pix = fitz.Pixmap(doc, xref)
                except Exception:
                    continue
                if pix.n - pix.alpha >= 4 or pix.alpha:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                try:
                    png = pix.tobytes("png")
                except Exception:
                    pix = None
                    continue
                pix = None
                if not png or len(png) >= len(blob) * 0.95:
                    continue
                try:
                    page.replace_image(xref, stream=png)
                    converted += 1
                except Exception:
                    continue

        if converted == 0:
            stats["skipped"] = True
            stats["reason"] = "no-uncompressed-raster"
            try:
                tmp_fd, tmp_name = tempfile.mkstemp(suffix=".pdf", dir=str(dest.parent))
                os.close(tmp_fd)
                doc.save(tmp_name, deflate=True, garbage=4)
                doc.close()
                doc = None
                after = Path(tmp_name).stat().st_size
                if after < before * 0.9:
                    os.replace(tmp_name, dest)
                    stats["afterBytes"] = after
                    stats["skipped"] = False
                    stats["reason"] = "deflate-only"
                else:
                    os.unlink(tmp_name)
                    stats["afterBytes"] = before
            except Exception:
                stats["afterBytes"] = before
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
