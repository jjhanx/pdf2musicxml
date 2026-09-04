"""맨 끝 mid F clef 뒤에 음표 삽입 후 staff rebuild해도 F가 유지되는지.

Run: python _smoke/test_insert_note_after_trailing_clef.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import apply_fixes_to_root, _ns, _q, find_part, find_measure  # noqa: E402

SAMPLE = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="10">
      <attributes>
        <divisions>1</divisions>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff>
      </note>
      <attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>
    </measure>
  </part>
</score-partwise>
"""


def tags(m: ET.Element, ns: str) -> list[str]:
    out: list[str] = []
    for el in m:
        t = el.tag.split("}")[-1]
        if t == "note":
            p = el.find(_q(ns, "pitch"))
            out.append(f"note:{(p.findtext(_q(ns, 'step')) or '')}{(p.findtext(_q(ns, 'octave')) or '')}")
        elif t == "attributes":
            signs = [c.findtext(_q(ns, "sign")) or "?" for c in el.findall(_q(ns, "clef"))]
            if signs:
                out.append("attrs:" + ",".join(signs))
        else:
            out.append(t)
    return out


def main() -> None:
    root = ET.fromstring(SAMPLE)
    stats = apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertNote",
                "partId": "P1",
                "measureMxl": "10",
                "afterNoteIndex": 1,
                "afterClefIndex": 0,
                "pitchStep": "E",
                "pitchOctave": 3,
                "noteType": "quarter",
                "staff": 1,
                "voice": "1",
            }
        ],
    )
    assert stats["applied"] == 1, stats
    ns = _ns(root)
    m = find_measure(find_part(root, ns, "P1"), ns, "10")
    assert m is not None
    t = tags(m, ns)
    assert "attrs:F" in t, t
    fi = t.index("attrs:F")
    assert fi > 0 and t[fi - 1].startswith("note:"), t
    assert "note:E3" in t, t
    assert t.index("note:E3") > fi, t
    print("ok insert_note_after_trailing_clef", t)


if __name__ == "__main__":
    main()
