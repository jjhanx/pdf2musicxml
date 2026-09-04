"""연속 insertNote — afterNoteIndex를 직전 삽입 음으로 연결.

Run: python _smoke/test_insert_note_sequence.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import apply_fixes_to_root, list_note_elements  # noqa: E402

SAMPLE = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration><type>quarter</type>
        <voice>1</voice><staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""

WHOLE_REST = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="45">
      <attributes><divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef number="1"><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <rest measure="yes"/>
        <duration>16</duration>
        <voice>1</voice><staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def _steps(root: ET.Element, part_id: str = "P1") -> list[str]:
    part = root.find(f".//part[@id='{part_id}']")
    assert part is not None
    measure = part.find("measure")
    assert measure is not None
    notes = list_note_elements(measure, "")
    leaders = [n for n in notes if n.find("chord") is None]
    out: list[str] = []
    for n in leaders:
        if n.find("rest") is not None:
            out.append("REST")
            continue
        out.append(n.findtext("pitch/step") or "?")
    return out


def main() -> None:
    root = ET.fromstring(SAMPLE)
    stats = apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertNote",
                "partId": "P1",
                "measureMxl": "1",
                "afterNoteIndex": 0,
                "pitchStep": "D",
                "pitchOctave": 4,
                "noteType": "quarter",
                "staff": 1,
                "voice": "1",
            },
            {
                "kind": "insertNote",
                "partId": "P1",
                "measureMxl": "1",
                "afterNoteIndex": 1,
                "pitchStep": "E",
                "pitchOctave": 4,
                "noteType": "quarter",
                "staff": 1,
                "voice": "1",
            },
            {
                "kind": "insertNote",
                "partId": "P1",
                "measureMxl": "1",
                "afterNoteIndex": 2,
                "pitchStep": "F",
                "pitchOctave": 4,
                "noteType": "quarter",
                "staff": 1,
                "voice": "1",
            },
        ],
    )
    assert stats["applied"] == 3, stats
    steps = _steps(root)
    assert steps == ["C", "D", "E", "F"], steps
    print("insert_note_sequence ok", steps)

    # 온쉼만 있는 마디 + UI after+=1 체인 → 입력 순 유지(역순 금지)
    root2 = ET.fromstring(WHOLE_REST)
    pitches = list("CDEFGAB") + ["C", "D", "E", "F"]
    fixes = []
    after = 0
    for i, step in enumerate(pitches):
        fixes.append(
            {
                "kind": "insertNote",
                "partId": "P5",
                "measureMxl": "45",
                "afterNoteIndex": after,
                "pitchStep": step,
                "pitchOctave": 5 if i >= 7 else 4,
                "noteType": "eighth",
                "staff": 1,
                "voice": "1",
            }
        )
        after += 1
    stats2 = apply_fixes_to_root(root2, fixes)
    assert stats2["applied"] == 11, stats2
    steps2 = _steps(root2, "P5")
    assert "REST" not in steps2, steps2
    assert steps2 == list(pitches), f"expected input order, got {steps2}"
    print("insert after whole-rest ok", steps2)


if __name__ == "__main__":
    main()
