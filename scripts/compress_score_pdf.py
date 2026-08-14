#!/usr/bin/env python3
"""이미지 악보 PDF — 마스킹 후 비압축 PNG로 불어난 스트림을 JPEG로 되돌림.

픽셀 크기(약 300 DPI)는 유지한다. 원본이 JPEG 이미지 PDF(~수 MB)인데
mask/save 후 수백 MB가 되는 것은 해상도 증가가 아니라 스트림이 raw PNG로
풀리기 때문이다. 벡터 전용 PDF는 손대지 않는다.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

_JPEG_QUALITY = 82
_MIN_BYTES = 8 * 1024 * 1024


def compress_score_pdf(
    pdf_path: str | Path,
    out_path: str | Path | None = None,
    *,
    jpeg_quality: int = _JPEG_QUALITY,
    min_bytes: int = _MIN_BYTES,
    reference_path: str | Path | None = None,
) -> dict[str, Any]:
    import fitz

    src = Path(pdf_path)
    dest = Path(out_path) if out_path else src
    before = src.stat().st_size if src.is_file() else 0
    ref_bytes = 0
    if reference_path:
        ref = Path(reference_path)
        if ref.is_file():
            ref_bytes = ref.stat().st_size
    stats: dict[str, Any] = {
        "path": str(dest),
        "beforeBytes": before,
        "afterBytes": before,
        "referenceBytes": ref_bytes or None,
        "imagesConverted": 0,
        "jpegQuality": jpeg_quality,
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

    def _run(quality: int) -> tuple[int, int]:
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
                        jpg = pix.tobytes("jpeg", jpg_quality=quality)
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
                return 0, before
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
            return converted, dest.stat().st_size
        finally:
            if doc is not None:
                try:
                    doc.close()
                except Exception:
                    pass

    converted, after = _run(jpeg_quality)
    if converted == 0:
        stats["skipped"] = True
        stats["reason"] = "no-raster-or-convert-failed"
        return stats

    # 원본보다 여전히 크게 부풀면 품질을 한 단계 낮춰 재시도(해상도는 동일)
    if ref_bytes > 0 and after > max(ref_bytes * 2, min_bytes) and jpeg_quality > 70:
        q2 = max(70, jpeg_quality - 12)
        converted2, after2 = _run(q2)
        if converted2 > 0 and after2 < after:
            converted, after = converted2, after2
            jpeg_quality = q2
            stats["jpegQuality"] = q2

    stats["afterBytes"] = after
    stats["imagesConverted"] = converted
    stats["jpegQuality"] = jpeg_quality
    if after >= before * 0.9:
        stats["skipped"] = True
        stats["reason"] = "no-gain"
    return stats


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "pdf path required"}))
        return 2
    src = Path(sys.argv[1])
    dest = Path(sys.argv[2]) if len(sys.argv) > 2 else src
    ref = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    try:
        stats = compress_score_pdf(src, dest, reference_path=ref)
        print(json.dumps(stats, ensure_ascii=False))
        return 0
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
