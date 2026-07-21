#!/usr/bin/env python3
"""printed_measure_numbers + fix_audiveris manifest-aware measure-numbering."""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

os.environ["AUDIVERIS_MXL_RHYTHM_FIX"] = "off"

from fix_audiveris_mxl import fix_score_xml  # noqa: E402
from printed_measure_numbers import load_printed_measure_mxl_set  # noqa: E402
from printed_measure_numbers import (  # noqa: E402
    load_printed_measure_marker_map,
    strip_spurious_measure_number_words_root,
)
import xml.etree.ElementTree as ET

MANIFEST = ROOT / "_smoke" / "_6cbf_q" / "lyric_manifest.json"
SAMPLE = ROOT / "_smoke" / "x" / "clean_score_only.xml"


def test_manifest_parse() -> None:
    allowed = load_printed_measure_mxl_set(MANIFEST, measure_offset=1)
    assert 3 in allowed  # printed "3" -> mxl 3 (offset 1 + sidebar +1 보정)
    assert len(allowed) >= 10


def test_restore_only_manifest_measures() -> None:
    raw = SAMPLE.read_bytes()
    allowed = load_printed_measure_mxl_set(MANIFEST, 1)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tf:
        json.dump({"items": [{"type": "measure_number", "text": str(m + 1), "bbox": [0, 0, 10, 10]} for m in sorted(list(allowed))[:5]]}, tf)
        manifest_path = tf.name
    os.environ["PDF2MXL_LYRIC_MANIFEST"] = manifest_path
    try:
        fixed, stats = fix_score_xml(raw)
        xml = fixed.decode("utf-8")
        assert stats.get("measure_numbering_removed", 0) > 0
        assert stats.get("measure_numbering_restored", 0) == 5
        assert xml.count("<measure-numbering>") == 5
    finally:
        os.environ.pop("PDF2MXL_LYRIC_MANIFEST", None)
        Path(manifest_path).unlink(missing_ok=True)


def test_strip_all_without_manifest() -> None:
    raw = SAMPLE.read_bytes()
    os.environ.pop("PDF2MXL_LYRIC_MANIFEST", None)
    fixed, stats = fix_score_xml(raw)
    assert b"<measure-numbering>" not in fixed
    assert stats.get("measure_numbering_restored", 0) == 0


def test_strip_spurious_numeric_words() -> None:
    xml = """<score-partwise>
  <part id="P1">
    <measure number="1"><direction><direction-type><words>1</words></direction-type></direction></measure>
    <measure number="2"><direction><direction-type><words>2</words></direction-type></direction></measure>
    <measure number="6"><direction><direction-type><words>6</words></direction-type></direction></measure>
    <measure number="7"><direction><direction-type><words>제목</words></direction-type></direction></measure>
  </part>
</score-partwise>"""
    root = ET.fromstring(xml)
    removed = strip_spurious_measure_number_words_root(root, "", {6: "6"})
    assert removed == 2
    m1_words = root.find(".//measure[@number='1']/direction/direction-type/words")
    assert m1_words is None
    m6_words = root.find(".//measure[@number='6']/direction/direction-type/words")
    assert m6_words is not None and m6_words.text == "6"
    m7_words = root.find(".//measure[@number='7']/direction/direction-type/words")
    assert m7_words is not None and m7_words.text == "제목"


def test_marker_map_from_manifest() -> None:
    if not MANIFEST.is_file():
        return
    markers = load_printed_measure_marker_map(MANIFEST, 1)
    assert markers.get(3) == "3"
    assert len(markers) >= 10


if __name__ == "__main__":
    if not MANIFEST.is_file():
        print("skip manifest tests — _smoke/_6cbf_q/lyric_manifest.json missing")
    else:
        test_manifest_parse()
        test_restore_only_manifest_measures()
        test_marker_map_from_manifest()
    test_strip_all_without_manifest()
    test_strip_spurious_numeric_words()
    print("ok")
