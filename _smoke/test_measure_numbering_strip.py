#!/usr/bin/env python3
"""Audiveris measure-numbering 제거 — fix_audiveris_mxl·샘플 XML."""
from __future__ import annotations

import io
import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

os.environ["AUDIVERIS_MXL_RHYTHM_FIX"] = "off"

from fix_audiveris_mxl import fix_score_xml  # noqa: E402

SAMPLE = ROOT / "_smoke" / "x" / "clean_score_only.xml"


def _count_measure_numbering(xml: bytes) -> int:
    return xml.decode("utf-8", errors="replace").count("<measure-numbering>")


def test_sample_xml() -> None:
    raw = SAMPLE.read_bytes()
    before = _count_measure_numbering(raw)
    assert before > 0, "sample should contain measure-numbering"
    fixed, stats = fix_score_xml(raw)
    after = _count_measure_numbering(fixed)
    assert after == 0, f"expected 0 after fix, got {after}"
    assert stats.get("measure_numbering_removed", 0) == before


def test_keep_env() -> None:
    raw = SAMPLE.read_bytes()
    os.environ["AUDIVERIS_MXL_KEEP_MEASURE_NUMBERING"] = "1"
    try:
        fixed, stats = fix_score_xml(raw)
        assert stats.get("measure_numbering_removed", 0) == 0
        assert _count_measure_numbering(fixed) == _count_measure_numbering(raw)
    finally:
        os.environ.pop("AUDIVERIS_MXL_KEEP_MEASURE_NUMBERING", None)


def test_omr_zips() -> None:
    zips = sorted(ROOT.glob("omr-work-*.zip"))
    if not zips:
        print("skip zip audit — no omr-work-*.zip in repo root")
        return
    for zp in zips[:8]:
        with zipfile.ZipFile(zp) as zf:
            name = next(
                (n for n in zf.namelist() if n.endswith(".xml") and "clean_score" in n.lower()),
                None,
            )
            if not name:
                continue
            raw = zf.read(name)
        before = _count_measure_numbering(raw)
        if before == 0:
            continue
        fixed, stats = fix_score_xml(raw)
        assert _count_measure_numbering(fixed) == 0, zp.name
        assert stats["measure_numbering_removed"] == before, zp.name


if __name__ == "__main__":
    test_sample_xml()
    test_keep_env()
    test_omr_zips()
    print("ok")
