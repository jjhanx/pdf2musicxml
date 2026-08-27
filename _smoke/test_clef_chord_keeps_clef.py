"""화음 삽입 시 리더·멤버 사이에 끼인 mid clef를 리더 앞으로 복구.

Run: python _smoke/test_clef_chord_keeps_clef.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    apply_fixes_to_root,
    _move_attributes_out_of_chord_groups,
)

SAMPLE = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note data-hitl-play-order="1">
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>2</duration><type>quarter</type><voice>1</voice><staff>1</staff>
      </note>
      <note data-hitl-play-order="2">
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>2</duration><type>quarter</type><voice>1</voice><staff>1</staff>
      </note>
      <note data-hitl-play-order="3">
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>2</duration><type>quarter</type><voice>1</voice><staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def tags(m: ET.Element) -> list[str]:
    out: list[str] = []
    for el in m:
        t = el.tag.split("}")[-1]
        if t == "note":
            ch = "c" if el.find("chord") is not None else "l"
            out.append(f"{el.findtext('pitch/step')}{el.findtext('pitch/octave')}{ch}")
        elif t == "attributes":
            out.append("@" + (el.findtext("clef/sign") or "?"))
        else:
            out.append(t)
    return out


def main() -> None:
    # Case A: afterClefIndex 정상 화음
    root = ET.fromstring(SAMPLE)
    m = root.find("part").find("measure")  # type: ignore[union-attr]
    apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertClef",
                "partId": "P1",
                "measureMxl": "1",
                "afterNoteIndex": 2,
                "clefSign": "G",
                "clefLine": 2,
                "staff": 1,
            },
            {
                "kind": "insertNote",
                "partId": "P1",
                "measureMxl": "1",
                "afterNoteIndex": 2,
                "afterClefIndex": 0,
                "pitchStep": "C",
                "pitchOctave": 4,
                "noteType": "quarter",
                "staff": 1,
                "voice": "1",
            },
            {
                "kind": "insertChordMember",
                "partId": "P1",
                "measureMxl": "1",
                "leaderNoteIndex": 3,
                "pitchStep": "E",
                "pitchOctave": 4,
            },
            {
                "kind": "insertChordMember",
                "partId": "P1",
                "measureMxl": "1",
                "leaderNoteIndex": 3,
                "pitchStep": "G",
                "pitchOctave": 4,
            },
        ],
    )
    t = tags(m)
    assert t.index("@G") < t.index("C4l"), t
    assert "E4c" in t and "G4c" in t, t

    # Case B: afterClefIndex 미스(잘못된 인덱스)여도 attributes를 건너뛰어 clef 뒤에 삽입
    root2 = ET.fromstring(SAMPLE)
    m2 = root2.find("part").find("measure")  # type: ignore[union-attr]
    apply_fixes_to_root(
        root2,
        [
            {
                "kind": "insertClef",
                "partId": "P1",
                "measureMxl": "1",
                "afterNoteIndex": 2,
                "clefSign": "G",
                "clefLine": 2,
                "staff": 1,
            },
            {
                "kind": "insertNote",
                "partId": "P1",
                "measureMxl": "1",
                "afterNoteIndex": 2,
                "afterClefIndex": 99,
                "pitchStep": "C",
                "pitchOctave": 4,
                "noteType": "quarter",
                "staff": 1,
                "voice": "1",
            },
            {
                "kind": "insertChordMember",
                "partId": "P1",
                "measureMxl": "1",
                "leaderNoteIndex": 3,
                "pitchStep": "E",
                "pitchOctave": 4,
            },
            {
                "kind": "insertChordMember",
                "partId": "P1",
                "measureMxl": "1",
                "leaderNoteIndex": 3,
                "pitchStep": "G",
                "pitchOctave": 4,
            },
        ],
    )
    t2 = tags(m2)
    assert "@G" in t2, t2
    gi = t2.index("@G")
    assert t2[gi + 1] == "C4l", t2
    assert t2.index("E4c") > gi and t2.index("G4c") > gi, t2

    # Case C: 직접 between 상태
    m3 = ET.fromstring(
        """<measure number="1">
      <attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <attributes><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
    </measure>"""
    )
    assert _move_attributes_out_of_chord_groups(m3, "") is True
    t3 = tags(m3)
    assert t3.index("@G") < t3.index("C4l") < t3.index("E4c"), t3

    print("clef_chord_keeps_clef ok")


if __name__ == "__main__":
    main()
