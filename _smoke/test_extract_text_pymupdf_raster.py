"""이미지 PDF 래스터는 Poppler 없이 PyMuPDF만 사용.

Run: python _smoke/test_extract_text_pymupdf_raster.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import extract_text as et  # noqa: E402

doc = fitz.open()
page = doc.new_page(width=200, height=100)
page.insert_text((20, 50), "가사 test", fontsize=14)
arr = et._page_rgb_array(page, dpi=72)
assert arr.ndim == 3 and arr.shape[2] == 3, arr.shape
assert arr.shape[0] == 100 and arr.shape[1] == 200, arr.shape

with tempfile.TemporaryDirectory() as td:
    pdf = Path(td) / "imgish.pdf"
    # 텍스트를 지운 것처럼 보이게 — 실제로는 벡터 문자 길이로 vector 경로가 탈 수 있음.
    # 래스터 헬퍼만 검증; extract_image는 RapidOCR 모델 필요.
    doc.save(pdf)
    doc2 = fitz.open(pdf)
    a2 = et._page_rgb_array(doc2[0], dpi=150)
    assert a2.shape[2] == 3

print("OK extract_text PyMuPDF raster (no poppler)")
