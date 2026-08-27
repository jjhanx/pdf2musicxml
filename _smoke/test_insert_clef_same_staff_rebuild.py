"""피아노: staff1 끝 G clef가 PL 음에 붙지 않고 staff1 뒤에 남는지.

Run: python _smoke/test_insert_clef_same_staff_rebuild.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import apply_fixes_to_root  # noqa: E402

SAMPLE = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <staves>2</staves>
        <clef number="1"><sign>F</sign><line>4</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note default-x="32.00" data-hitl-play-order="1">
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>2</duration><type>quarter</type>
        <voice>1</voice><staff>1</staff>
      </note>
      <note default-x="132.00" data-hitl-play-order="2">
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>2</duration><type>quarter</type>
        <voice>1</voice><staff>1</staff>
      </note>
      <note default-x="232.00" data-hitl-play-order="3">
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>2</duration><type>quarter</type>
        <voice>1</voice><staff>1</staff>
      </note>
      <backup><duration>6</duration></backup>
      <note default-x="32.00">
        <pitch><step>C</step><octave>2</octave></pitch>
        <duration>6</duration><type>half</type>
        <dot/><voice>5</voice><staff>2</staff>
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
            out.append(
                f"note:{el.findtext('pitch/step')}{el.findtext('pitch/octave')}s{el.findtext('staff')}"
            )
        elif t == "attributes":
            signs = [c.findtext("sign") or "?" for c in el.findall("clef")]
            out.append("attrs:" + ",".join(signs))
        elif t == "backup":
            out.append("backup")
        else:
            out.append(t)
    return out


def main() -> None:
    root = ET.fromstring(SAMPLE)
    m = root.find("part").find("measure")  # type: ignore[union-attr]
    apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertClef",
                "partId": "P5",
                "measureMxl": "1",
                "afterNoteIndex": 2,
                "clefSign": "G",
                "clefLine": 2,
                "staff": 1,
            },
            {
                "kind": "insertNote",
                "partId": "P5",
                "measureMxl": "1",
                "afterNoteIndex": 2,
                "afterClefIndex": 0,
                "pitchStep": "A",
                "pitchOctave": 4,
                "noteType": "quarter",
                "staff": 1,
                "voice": "1",
            },
        ],
    )
    t = tags(m)
    assert "attrs:G" in t, t
    gi = t.index("attrs:G")
    assert t[gi + 1] == "note:A4s1", t
    # PL 앞에 붙지 않음
    assert gi < t.index("backup"), t
    print("insert_clef_same_staff_rebuild ok", t)


if __name__ == "__main__":
    main()
