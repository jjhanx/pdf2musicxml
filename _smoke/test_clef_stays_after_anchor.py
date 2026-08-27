"""insertClef 위치가 rebuild·normalize 후에도 직전 음 뒤에 유지되는지.

Run: python _smoke/test_clef_stays_after_anchor.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    PLAY_ORDER_ATTR,
    apply_fixes_to_root,
    rebuild_measure_timeline_clean,
)

SAMPLE = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
      <note data-hitl-play-order="1"><pitch><step>C</step><octave>3</octave></pitch>
        <duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <note data-hitl-play-order="2"><pitch><step>D</step><octave>3</octave></pitch>
        <duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <note data-hitl-play-order="3"><pitch><step>E</step><octave>3</octave></pitch>
        <duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <note data-hitl-play-order="4"><pitch><step>F</step><octave>3</octave></pitch>
        <duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
"""


def tags(m: ET.Element) -> list[str]:
    out: list[str] = []
    for el in m:
        t = el.tag.split("}")[-1]
        if t == "note":
            out.append(f"note:{el.findtext('pitch/step')}")
        elif t == "attributes":
            out.append("attrs:" + (el.findtext("clef/sign") or "?"))
        else:
            out.append(t)
    return out


def main() -> None:
    root = ET.fromstring(SAMPLE)
    part = root.find("part")
    m = part.find("measure")  # type: ignore[union-attr]
    apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertClef",
                "partId": "P1",
                "measureMxl": "1",
                "afterNoteIndex": 1,
                "clefSign": "G",
                "clefLine": 2,
                "staff": 1,
            }
        ],
    )
    t = tags(m)
    assert t == [
        "attrs:F",
        "note:C",
        "note:D",
        "attrs:G",
        "note:E",
        "note:F",
    ], t

    # 연주순번을 뒤집어 재정렬을 유도해도 G는 앵커 D 뒤
    notes = [el for el in m if el.tag == "note" or el.tag.endswith("}note")]
    for n, po in zip(notes, [4, 3, 2, 1]):
        n.set(PLAY_ORDER_ATTR, str(po))
    rebuild_measure_timeline_clean(m, "", part)
    t2 = tags(m)
    assert "attrs:G" in t2, t2
    gi = t2.index("attrs:G")
    assert t2[gi - 1] == "note:D", t2
    print("clef_stays_after_anchor ok", t2)


if __name__ == "__main__":
    main()
