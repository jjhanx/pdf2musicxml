#!/usr/bin/env python3
"""inject_ocr: fix_audiveris_mxl 실패 시 빈 mkstemp를 zip으로 열지 않음."""
from __future__ import annotations

import io
import os
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import inject_ocr as inj  # noqa: E402


def _minimal_mxl(path: Path) -> None:
    score = b"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
 "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>whole</type>
      </note>
    </measure>
  </part>
</score-partwise>
"""
    container = b"""<?xml version="1.0" encoding="UTF-8"?>
<container>
  <rootfiles>
    <rootfile full-path="score.xml"/>
  </rootfiles>
</container>
"""
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("META-INF/container.xml", container)
        z.writestr("score.xml", score)


def test_fix_import_failure_falls_back_to_input():
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        mxl_in = td_path / "score.mxl"
        mxl_out = td_path / "out.mxl"
        manifest = td_path / "lyric_manifest.json"
        _minimal_mxl(mxl_in)
        manifest.write_text(
            '{"v":3,"items":[],"pymupdfReviewItems":[]}',
            encoding="utf-8",
        )

        with mock.patch.object(inj, "_run_audiveris_mxl_fix", return_value=False):
            inj.inject_ocr(str(mxl_in), str(mxl_out), str(manifest))

        assert mxl_out.is_file(), "원본 MXL로 inject가 완료되어야 함"
        assert inj._is_valid_mxl_zip(str(mxl_out))
        with zipfile.ZipFile(mxl_out, "r") as z:
            xml = z.read("score.xml")
        root = ET.parse(io.BytesIO(xml)).getroot()
        assert root is not None


def test_empty_tmp_is_not_valid_mxl():
    fd, path = tempfile.mkstemp(suffix=".mxl")
    os.close(fd)
    try:
        assert not inj._is_valid_mxl_zip(path)
    finally:
        os.remove(path)


if __name__ == "__main__":
    test_empty_tmp_is_not_valid_mxl()
    test_fix_import_failure_falls_back_to_input()
    print("ok")
