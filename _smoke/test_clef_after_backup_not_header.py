"""backup 직후 mid clef가 rebuild로 마디 머리로 승격되지 않는지.

Run: python _smoke/test_clef_after_backup_not_header.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import rebuild_measure_timeline_clean  # noqa: E402

SAMPLE = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="5">
      <attributes>
        <divisions>1</divisions>
        <staves>2</staves>
        <clef number="1"><sign>F</sign><line>4</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>3</duration></backup>
      <attributes><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>3</duration><type>half</type><dot/><voice>2</voice><staff>2</staff></note>
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
    part = root.find("part")
    m = part.find("measure")  # type: ignore[union-attr]
    rebuild_measure_timeline_clean(m, "", part)
    t = tags(m)
    assert "attrs:G" in t, t
    # 머리(F,F) 다음에 G가 오면 안 됨 — G는 staff1 음 뒤·backup 앞
    assert t[0].startswith("attrs:F"), t
    gi = t.index("attrs:G")
    assert gi > 0 and not t[1].startswith("attrs:"), t
    assert t[gi - 1].startswith("note:") and "s1" in t[gi - 1], t
    assert "backup" in t and gi < t.index("backup"), t
    # PL은 여전히 F 영향권(머리) — G 뒤에 오지 않음
    assert t.index("note:C2s2") > t.index("backup"), t
    print("clef_after_backup_not_header ok", t)


if __name__ == "__main__":
    main()
