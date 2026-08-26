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


def main() -> None:
    root = ET.fromstring(SAMPLE)
    # C4 뒤 D4 → E4 → F4 (after: 0, then 1, then 2)
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
    notes = list_note_elements(root.find("part").find("measure"), "")  # type: ignore[union-attr]
    leaders = [n for n in notes if n.find("chord") is None]
    steps = [n.findtext("pitch/step") for n in leaders]
    assert steps == ["C", "D", "E", "F"], steps
    print("insert_note_sequence ok", steps)


if __name__ == "__main__":
    main()
