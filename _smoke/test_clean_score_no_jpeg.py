# -*- coding: utf-8 -*-
"""이미지 PDF 마스킹: 가사 픽셀은 지우되 JPEG 재인코딩은 하지 않음."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from compress_score_pdf import compress_score_pdf  # noqa: E402
from mask_pdf import mask_pdf  # noqa: E402

_REDACT = fitz.Rect(50, 50, 200, 80)


def _jpeg_page_pdf(path: Path) -> None:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 800, 1100), 0)
    pix.clear_with(40)
    jpg = pix.tobytes("jpeg", jpg_quality=80)
    page.insert_image(page.rect, stream=jpg)
    doc.save(path)
    doc.close()


def _image_exts(pdf_path: Path) -> list[str]:
    doc = fitz.open(pdf_path)
    out: list[str] = []
    try:
        for page in doc:
            for im in page.get_images(full=True):
                info = doc.extract_image(int(im[0])) or {}
                out.append(str(info.get("ext") or "").lower())
    finally:
        doc.close()
    return out


def main() -> None:
    td = Path(tempfile.mkdtemp())
    src = td / "orig.jpg.pdf"
    _jpeg_page_pdf(src)
    orig_sz = src.stat().st_size
    assert orig_sz < 200_000, orig_sz
    assert _image_exts(src) == ["jpeg"] or _image_exts(src) == ["jpg"]

    doc = fitz.open(src)
    page = doc[0]
    pixels = int(getattr(fitz, "PDF_REDACT_IMAGE_PIXELS", 2))
    page.add_redact_annot(_REDACT, fill=(1, 1, 1))
    page.apply_redactions(
        images=pixels,
        graphics=int(getattr(fitz, "PDF_REDACT_LINE_ART_NONE", 0)),
        text=int(getattr(fitz, "PDF_REDACT_TEXT_REMOVE", 0)),
    )
    fat = td / "pixels.pdf"
    doc.save(fat, deflate=False)
    doc.close()
    fat_sz = fat.stat().st_size
    print("orig", orig_sz, "IMAGE_PIXELS", fat_sz)
    assert fat_sz > orig_sz * 5, (fat_sz, orig_sz)

    packed = td / "packed.pdf"
    st = compress_score_pdf(fat, packed, min_bytes=1000)
    packed_sz = packed.stat().st_size if packed.is_file() else 0
    print("lossless pack", st, "bytes", packed_sz)
    assert st["imagesConverted"] >= 1 or st.get("reason") == "deflate-only", st
    assert packed_sz < fat_sz * 0.5, (packed_sz, fat_sz)
    assert "jpeg" not in _image_exts(packed) and "jpg" not in _image_exts(packed), _image_exts(packed)

    st_jpg = compress_score_pdf(src, td / "leave-jpeg.pdf", min_bytes=1000)
    assert st_jpg["imagesConverted"] == 0, st_jpg
    print("jpeg left untouched", st_jpg.get("reason"))

    ocr = td / "ocr.json"
    ocr.write_text(
        json.dumps(
            [{"type": "lyrics", "page": 1, "bbox": [50, 50, 200, 80], "text": "가"}],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    masked = td / "masked.pdf"
    os.environ["MASK_PDF_LYRIC_SELECTIVE"] = "0"
    os.environ["MASK_PDF_GLOBAL_HANGUL_SYLLABLE_BLANK"] = "0"
    mask_pdf(str(src), str(masked), str(ocr))
    masked_sz = masked.stat().st_size
    print("mask_pdf", masked_sz, "exts", _image_exts(masked))
    assert masked_sz < fat_sz * 0.5, (masked_sz, fat_sz)
    assert "jpeg" not in _image_exts(masked) and "jpg" not in _image_exts(masked)

    pix = fitz.open(masked)[0].get_pixmap()
    # redact 박스 안이 흰색에 가깝면 픽셀 펀치가 된 것
    x, y = 80, 60
    n = pix.n
    i = (y * pix.width + x) * n
    rgb = tuple(pix.samples[i : i + 3])
    print("punched pixel", rgb)
    assert min(rgb) >= 240, rgb
    print("ok")


if __name__ == "__main__":
    main()
