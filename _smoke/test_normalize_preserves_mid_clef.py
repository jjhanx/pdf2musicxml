"""_normalize_staff_note_order must keep mid-measure clef before its following note."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import PLAY_ORDER_ATTR, _normalize_staff_note_order  # noqa: E402

SAMPLE = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
      <note default-x="32" data-hitl-play-order="1">
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>2</duration><type>quarter</type><voice>1</voice><staff>1</staff>
      </note>
      <note default-x="232" data-hitl-play-order="3">
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>2</duration><type>quarter</type><voice>1</voice><staff>1</staff>
      </note>
      <attributes><clef><sign>G</sign><line>2</line></clef></attributes>
      <note default-x="132" data-hitl-play-order="2">
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>2</duration><type>quarter</type><voice>1</voice><staff>1</staff>
      </note>
      <note default-x="332" data-hitl-play-order="4">
        <pitch><step>A</step><octave>4</octave></pitch>
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
            out.append(f"note:{el.findtext('pitch/step')}po={el.get(PLAY_ORDER_ATTR)}")
        elif t == "attributes":
            out.append("attrs:" + (el.findtext("clef/sign") or "?"))
        else:
            out.append(t)
    return out


def main() -> None:
    root = ET.fromstring(SAMPLE)
    m = root.find("part").find("measure")  # type: ignore[union-attr]
    print("before", tags(m))
    changed = _normalize_staff_note_order(m, "", "1")
    print("changed", changed, "after", tags(m))
    t = tags(m)
    assert "attrs:G" in t, t
    gi = t.index("attrs:G")
    # 원래 G 다음 음이었던 D(po=2) 앞에 유지
    assert gi + 1 < len(t) and t[gi + 1].startswith("note:D"), t
    print("normalize_preserves_mid_clef ok")


if __name__ == "__main__":
    main()
