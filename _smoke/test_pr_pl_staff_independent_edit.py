"""피아노 PR(staff 1)·PL(staff 2) HITL 편집이 서로 음을 삼키지 않는지.

Run: python _smoke/test_pr_pl_staff_independent_edit.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import apply_fixes_to_root, list_note_elements  # noqa: E402

PIANO = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="38">
      <attributes>
        <divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
      </attributes>
      <note default-x="40">
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration><voice>1</voice><type>half</type><staff>1</staff>
      </note>
      <note default-x="120">
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>4</duration><voice>1</voice><type>half</type><staff>1</staff>
      </note>
      <backup><duration>8</duration></backup>
      <note default-x="40">
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def _staff_pitches(measure: ET.Element, staff_n: int) -> list[tuple[str, str, bool]]:
    out: list[tuple[str, str, bool]] = []
    for n in list_note_elements(measure, ""):
        st = n.find("staff")
        sn = int((st.text if st is not None else "1") or "1")
        if sn != staff_n:
            continue
        p = n.find("pitch")
        v = (n.findtext("voice") or "").strip()
        ch = n.find("chord") is not None
        out.append((f"{p.findtext('step')}{p.findtext('octave')}", v, ch))
    return out


def test_pl_insert_with_other_voice_stays_on_pl() -> None:
    """PL 편집: afterNoteIndex=0(PR) + 다른 voice여도 staff=2를 유지."""
    root = ET.fromstring(PIANO)
    stats = apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertNote",
                "partId": "P5",
                "measureMxl": "38",
                "afterNoteIndex": -1,
                "pitchStep": "G",
                "pitchOctave": 2,
                "noteType": "quarter",
                "staff": 2,
                "voice": "6",
            },
            {
                "kind": "insertNote",
                "partId": "P5",
                "measureMxl": "38",
                "afterNoteIndex": 0,
                "pitchStep": "A",
                "pitchOctave": 2,
                "noteType": "quarter",
                "staff": 2,
                "voice": "6",
            },
        ],
    )
    assert stats.get("applied", 0) >= 2, stats
    m = root.find(".//measure")
    pr = _staff_pitches(m, 1)
    pl = _staff_pitches(m, 2)
    assert pr == [("C5", "1", False), ("D5", "1", False)], pr
    pl_pitches = [p for p, _v, ch in pl if not ch]
    assert "G2" in pl_pitches and "A2" in pl_pitches, pl
    assert all(v in ("5", "6") for _p, v, _c in pl), pl


def test_pr_batch_remove_does_not_eat_pl() -> None:
    """PR 음 두 개를 한 배치로 지워도 PL E3가 남는다 (앞쪽 삭제 인덱스 밀림)."""
    root = ET.fromstring(PIANO)
    stats = apply_fixes_to_root(
        root,
        [
            {
                "kind": "removeNote",
                "partId": "P5",
                "measureMxl": "38",
                "noteIndex": 0,
                "staff": 1,
            },
            {
                "kind": "removeNote",
                "partId": "P5",
                "measureMxl": "38",
                "noteIndex": 1,
                "staff": 1,
            },
        ],
    )
    assert stats.get("applied", 0) == 2, stats
    m = root.find(".//measure")
    assert _staff_pitches(m, 1) == [], _staff_pitches(m, 1)
    assert _staff_pitches(m, 2) == [("E3", "5", False)], _staff_pitches(m, 2)


def main() -> None:
    test_pl_insert_with_other_voice_stays_on_pl()
    test_pr_batch_remove_does_not_eat_pl()
    print("pr/pl staff independent edit ok")


if __name__ == "__main__":
    main()
