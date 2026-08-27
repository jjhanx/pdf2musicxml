"""마디 중간 insertClef — attributes/clef가 음 사이에 남고 rebuild 후에도 유지.

Run: python _smoke/test_insert_clef_mid_measure.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    apply_fixes_to_root,
    rebuild_measure_timeline_clean,
)

SAMPLE = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <clef><sign>G</sign><line>2</line></clef>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration><type>quarter</type>
        <voice>1</voice><staff>1</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration><type>quarter</type>
        <voice>1</voice><staff>1</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>2</duration><type>quarter</type>
        <voice>1</voice><staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def _tags(measure: ET.Element) -> list[str]:
    out: list[str] = []
    for el in measure:
        tag = el.tag.split("}")[-1]
        if tag == "note":
            step = el.findtext("pitch/step") or "?"
            out.append(f"note:{step}")
        elif tag == "attributes":
            sign = el.findtext("clef/sign") or ""
            out.append(f"attrs:{sign or 'other'}")
        else:
            out.append(tag)
    return out


def main() -> None:
    root = ET.fromstring(SAMPLE)
    stats = apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertClef",
                "partId": "P1",
                "measureMxl": "1",
                "afterNoteIndex": 0,
                "clefSign": "F",
                "clefLine": 4,
                "staff": 1,
            }
        ],
    )
    assert stats["applied"] == 1, stats
    measure = root.find("part").find("measure")  # type: ignore[union-attr]
    assert _tags(measure) == [
        "attrs:G",
        "note:C",
        "attrs:F",
        "note:D",
        "note:E",
    ], _tags(measure)

    # 다른 음표 편집 후 rebuild 해도 중간 clef 유지
    stats2 = apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertNote",
                "partId": "P1",
                "measureMxl": "1",
                "afterNoteIndex": 1,
                "pitchStep": "F",
                "pitchOctave": 3,
                "noteType": "quarter",
                "staff": 1,
                "voice": "1",
            }
        ],
    )
    assert stats2["applied"] == 1, stats2
    tags = _tags(measure)
    assert "attrs:F" in tags, tags
    # F clef는 여전히 C 다음·D 앞에 (또는 D 직전 preamble — insertNote after D's previous)
    # afterNoteIndex 1 = D 뒤였던 자리 → F3가 D 뒤에 생김. clef는 C와 D 사이 유지.
    assert tags.index("attrs:F") == tags.index("note:C") + 1, tags
    assert tags.index("note:D") > tags.index("attrs:F"), tags

    # 명시 rebuild도 동일
    rebuild_measure_timeline_clean(measure, "", root.find("part"))  # type: ignore[arg-type]
    tags2 = _tags(measure)
    assert tags2.index("attrs:F") == tags2.index("note:C") + 1, tags2

    print("insert_clef_mid_measure ok")


if __name__ == "__main__":
    main()
