#!/usr/bin/env python3
"""PL mid G→F must survive fix_audiveris so next measure starts in bass (d9d04491 m29→m30)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from fix_audiveris_mxl import fix_score_xml  # noqa: E402
import xml.etree.ElementTree as ET


def q(t: str) -> str:
    return t


XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P5"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P5">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="29">
      <attributes>
        <clef number="2"><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <attributes>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>8</duration><voice>5</voice><type>half</type><staff>2</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
    </measure>
    <measure number="30">
      <attributes>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>
"""


def staff2_clefs(root: ET.Element, mno: str) -> list[tuple[str, int]]:
    """(sign, index_among_staff2_attrs_in_order) with note count before each."""
    part = next(p for p in root.findall("part") if p.get("id") == "P5")
    m = next(x for x in part.findall("measure") if x.get("number") == mno)
    out: list[tuple[str, int]] = []
    n2 = 0
    for child in list(m):
        tag = child.tag
        if tag == "attributes":
            for clef in child.findall("clef"):
                if (clef.get("number") or "1") != "2":
                    continue
                sign = (clef.findtext("sign") or "").strip().upper()
                out.append((sign, n2))
        elif tag == "note" and child.find("chord") is None:
            if (child.findtext("staff") or "1") == "2":
                n2 += 1
    return out


def effective_staff2_at_start(root: ET.Element, mno: int) -> str | None:
    part = next(p for p in root.findall("part") if p.get("id") == "P5")
    sign: str | None = None
    for m in part.findall("measure"):
        n = int(m.get("number") or 0)
        if n == mno:
            return sign
        for child in list(m):
            if child.tag != "attributes":
                continue
            for clef in child.findall("clef"):
                if (clef.get("number") or "1") != "2":
                    continue
                s = (clef.findtext("sign") or "").strip().upper()
                if s:
                    sign = s
    return sign


def main() -> None:
    fixed, stats = fix_score_xml(XML.encode("utf-8"))
    root = ET.fromstring(fixed)
    m29 = staff2_clefs(root, "29")
    assert any(s == "F" and after > 0 for s, after in m29), m29
    # m30 header F may be stripped as courtesy if m29 ends F — effective must still be F
    assert effective_staff2_at_start(root, 30) == "F", (
        effective_staff2_at_start(root, 30),
        staff2_clefs(root, "30"),
        stats.get("key_change_clef_misread_fixed"),
    )
    print("ok pl mid G→F kept; m30 starts bass")


if __name__ == "__main__":
    main()
