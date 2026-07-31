#!/usr/bin/env python3
"""청산에 살리라 — clean_score strip 시 26마디(NWC 22.8pt) 음표 보존 회귀."""
from __future__ import annotations

import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_separator import strip_font_ranges  # noqa: E402

ORIG = ROOT / "청산에 살리라 F/청산에 살리라 F장조(이현철 곡).pdf"
OUT_7_17 = ROOT / "_smoke/_cheongsan_strip_guard_7_17.pdf"
OUT_7_36 = ROOT / "_smoke/_cheongsan_strip_guard_7_36.pdf"


def nwc_count_page(page) -> int:
    n = 0
    for block in page.get_text("rawdict").get("blocks") or []:
        if block.get("type") != 0:
            continue
        for line in block.get("lines") or []:
            for span in line.get("spans") or []:
                if "NWC" not in str(span.get("font") or ""):
                    continue
                n += len(span.get("chars") or [])
    return n


def m26_nwc_count(page) -> int:
    y0, y1 = 197, 311
    n = 0
    for block in page.get_text("rawdict").get("blocks") or []:
        if block.get("type") != 0:
            continue
        for line in block.get("lines") or []:
            for span in line.get("spans") or []:
                if "NWC" not in str(span.get("font") or ""):
                    continue
                for ch in span.get("chars") or []:
                    bb = ch.get("bbox") or [0, 0, 0, 0]
                    cy = (bb[1] + bb[3]) / 2
                    if y0 <= cy <= y1:
                        n += 1
    return n


def main() -> None:
    if not ORIG.is_file():
        print("skip: original PDF missing", ORIG)
        return
    orig = fitz.open(ORIG)
    orig_p5 = nwc_count_page(orig[4])
    orig_m26 = m26_nwc_count(orig[4])
    orig.close()
    assert orig_p5 > 100, orig_p5
    assert orig_m26 > 10, orig_m26

    strip_font_ranges(str(ORIG), str(OUT_7_17), [(7.0, 17.0)])
    doc17 = fitz.open(OUT_7_17)
    assert nwc_count_page(doc17[4]) == orig_p5, (orig_p5, nwc_count_page(doc17[4]))
    assert m26_nwc_count(doc17[4]) == orig_m26, (orig_m26, m26_nwc_count(doc17[4]))
    doc17.close()

    strip_font_ranges(str(ORIG), str(OUT_7_36), [(7.0, 36.0)])
    doc36 = fitz.open(OUT_7_36)
    p5_36 = nwc_count_page(doc36[4])
    m26_36 = m26_nwc_count(doc36[4])
    doc36.close()
    assert p5_36 == orig_p5, f"7-36pt strip must keep page5 NWC: orig={orig_p5} got={p5_36}"
    assert m26_36 == orig_m26, f"7-36pt strip must keep m26 NWC: orig={orig_m26} got={m26_36}"

    print("cheongsan strip m26 guard ok")


if __name__ == "__main__":
    main()
