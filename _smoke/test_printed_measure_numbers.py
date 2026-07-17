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


if __name__ == "__main__":
    if not MANIFEST.is_file():
        print("skip manifest tests — _smoke/_6cbf_q/lyric_manifest.json missing")
    else:
        test_manifest_parse()
        test_restore_only_manifest_measures()
    test_strip_all_without_manifest()
    print("ok")
