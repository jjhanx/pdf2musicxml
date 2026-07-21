#!/usr/bin/env python3
"""원문자·영역 기반 인쇄 마디 번호 파싱 회귀."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from measure_number_text import normalize_printed_measure_number_text
from printed_measure_numbers import (
    collect_measure_number_candidates_from_manifest,
    load_printed_measure_marker_map,
    select_printed_measure_markers_from_candidates,
)

MANIFEST = ROOT / "_smoke" / "_6cbf_q" / "lyric_manifest.json"
CHEongsan = ROOT / "청산에 살리라 F장조(이현철 곡)-lyric_manifest.json"

EXPECTED_CHEONGSAN = {
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    17,
    23,
    28,
    32,
    41,
    53,
    56,
    66,
}


def test_normalize_circled_digits() -> None:
    assert normalize_printed_measure_number_text("①") == "1"
    assert normalize_printed_measure_number_text("⑩") == "10"
    assert normalize_printed_measure_number_text("㉑") == "21"
    assert normalize_printed_measure_number_text("１７") == "17"
    assert normalize_printed_measure_number_text("(3)") == "3"
    assert normalize_printed_measure_number_text("  17  ") == "17"


def test_cheongsan_manifest_zones() -> None:
    if not CHEongsan.is_file():
        return
    data = json.loads(CHEongsan.read_text(encoding="utf-8"))
    candidates = collect_measure_number_candidates_from_manifest(data)
    markers = select_printed_measure_markers_from_candidates(candidates, 1)
    mxl_set = {m for m, _ in markers}
    assert mxl_set == EXPECTED_CHEONGSAN, f"got {sorted(mxl_set)}"
    assert 44 not in mxl_set


def test_synthetic_header_and_sidebar() -> None:
    manifest = {
        "items": [
            {"id": "h2", "page": 2, "type": "measure_number", "text": "2", "bbox": [516, 65, 521, 74]},
            {"id": "h3", "page": 3, "type": "measure_number", "text": "3", "bbox": [516, 65, 521, 74]},
            {"id": "s17", "page": 3, "type": "measure_number", "text": "17", "bbox": [74, 425, 91, 436]},
            {"id": "bad5", "page": 2, "type": "measure_number", "text": "5", "bbox": [77, 83, 88, 94]},
            {"id": "bad44", "page": 8, "type": "measure_number", "text": "44", "bbox": [74, 83, 91, 94]},
            {"id": "circled", "page": 4, "type": "measure_number", "text": "④", "bbox": [516, 65, 521, 74]},
        ]
    }
    markers = select_printed_measure_markers_from_candidates(
        collect_measure_number_candidates_from_manifest(manifest),
        1,
    )
    by_mxl = dict(markers)
    assert by_mxl[2] == "2"
    assert by_mxl[3] == "3"
    assert by_mxl[4] == "4"
    assert by_mxl[17] == "17"
    assert 44 not in by_mxl
    assert 5 not in by_mxl


def test_marker_map_from_6cbf() -> None:
    if not MANIFEST.is_file():
        return
    markers = load_printed_measure_marker_map(MANIFEST, 1)
    assert len(markers) >= 5


if __name__ == "__main__":
    test_normalize_circled_digits()
    test_synthetic_header_and_sidebar()
    test_cheongsan_manifest_zones()
    test_marker_map_from_6cbf()
    print("ok")
