#!/usr/bin/env python3
"""Run: python _smoke/test_trailing_tempo_reposition.py

마디 끝(마지막 note 뒤)에 위치한 템포 direction이 다음 마디(m51 등)에 중복 표시를
유발하지 않도록 첫 note 앞(마디 시작부)으로 정규화하는 기능 검증.
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))
sys.path.insert(0, str(ROOT_DIR / "scripts"))

from scripts.omr_hitl_lib import (
    _tempo_insert_index,
    reposition_trailing_tempo_directions_in_measure,
    reposition_trailing_tempo_directions_in_root,
)
from scripts.fix_audiveris_mxl import fix_score_xml


def test_tempo_insert_index_m50_no_attr():
    # m > 1이고 attributes가 없을 때, 마디 끝이 아니라 note 앞에 템포를 삽입해야 함
    m50 = ET.fromstring("""<measure number="50">
        <print/>
        <direction placement="above"><direction-type><words>poco rit.</words></direction-type></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>""")
    idx = _tempo_insert_index(m50)
    assert idx == 2, f"Expected insert index 2 (before note, after header/words), got {idx}"
    print("OK: _tempo_insert_index inserts before note in m50 without attributes")


def test_reposition_trailing_tempo_direction():
    m50 = ET.fromstring("""<measure number="50">
        <print/>
        <direction placement="above"><direction-type><words>poco rit.</words></direction-type></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
        <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
        <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>75</per-minute></metronome></direction-type><sound tempo="75"/></direction>
    </measure>""")
    moved = reposition_trailing_tempo_directions_in_measure(m50, "")
    assert moved == 1, f"Expected 1 moved, got {moved}"
    tags = [c.tag for c in m50]
    first_note = tags.index("note")
    tempo_idx = [i for i, c in enumerate(m50) if c.find(".//metronome") is not None][0]
    assert tempo_idx < first_note, f"Expected tempo ({tempo_idx}) before first note ({first_note})"
    print("OK: reposition_trailing_tempo_directions_in_measure moved trailing tempo before first note")


def test_trailing_tempo_dedup():
    m50 = ET.fromstring("""<measure number="50">
        <print/>
        <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>75</per-minute></metronome></direction-type><sound tempo="75"/></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
        <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>75</per-minute></metronome></direction-type><sound tempo="75"/></direction>
    </measure>""")
    moved = reposition_trailing_tempo_directions_in_measure(m50, "")
    assert moved == 1, f"Expected 1 removed, got {moved}"
    metronomes = [c for c in m50 if c.find(".//metronome") is not None]
    assert len(metronomes) == 1, "Expected only 1 metronome direction left"
    print("OK: duplicate trailing tempo removed when leading tempo already exists")


def main():
    test_tempo_insert_index_m50_no_attr()
    test_reposition_trailing_tempo_direction()
    test_trailing_tempo_dedup()
    print("ALL TESTS PASSED!")


if __name__ == "__main__":
    main()
