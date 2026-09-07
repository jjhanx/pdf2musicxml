# -*- coding: utf-8 -*-
"""insertClef remap은 새 clef 앞 음을 바꾸지 않음 + beforeNoteIndex 스냅샷."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import (  # noqa: E402
    apply_fixes_to_root,
    measure_elements_snapshot,
)


def _pitches(m: ET.Element) -> list[str]:
    out: list[str] = []
    for n in m.findall("note"):
        p = n.find("pitch")
        if p is None:
            continue
        out.append(f"{p.findtext('step')}{p.findtext('octave')}s{n.findtext('staff') or '1'}")
    return out


def _order(m: ET.Element) -> list[str]:
    out: list[str] = []
    ni = 0
    for c in list(m):
        tag = c.tag
        if tag == "note":
            p = c.find("pitch")
            out.append(f"#{ni}:{p.findtext('step')}{p.findtext('octave')}s{c.findtext('staff')}")
            ni += 1
        elif tag == "attributes":
            for cl in c.findall("clef"):
                out.append(f"clef:{cl.findtext('sign')}n{cl.get('number')}")
        elif tag == "backup":
            out.append("backup")
    return out


xml = """<score-partwise version="3.1">
<part id="P5">
<measure number="52">
  <attributes><divisions>4</divisions>
    <clef number="1"><sign>G</sign><line>2</line></clef>
    <clef number="2"><sign>F</sign><line>4</line></clef>
  </attributes>
  <note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
  <note><chord/><pitch><step>G</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
  <note><chord/><pitch><step>B</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
  <note><chord/><pitch><step>E</step><octave>6</octave></pitch><duration>16</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
  <backup><duration>16</duration></backup>
  <attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
  <note><pitch><step>E</step><octave>1</octave></pitch><duration>16</duration><type>whole</type><voice>5</voice><staff>2</staff></note>
  <note><chord/><pitch><step>E</step><octave>2</octave></pitch><duration>16</duration><type>whole</type><voice>5</voice><staff>2</staff></note>
</measure>
</part></score-partwise>"""

root = ET.fromstring(xml)
m0 = root.find(".//measure[@number='52']")
els = measure_elements_snapshot(m0, "")
clefs = [e for e in els if e.get("elementKind") == "clef"]
assert len(clefs) == 1, clefs
assert clefs[0]["afterNoteIndex"] == 3, clefs[0]
assert clefs[0]["beforeNoteIndex"] == 4, clefs[0]  # PL 첫 음 앞

# #5 뒤 + remap → 앞 음(E1/E2) 불변, G는 맨 끝
root2 = ET.fromstring(xml)
apply_fixes_to_root(
    root2,
    [
        {
            "kind": "insertClef",
            "partId": "P5",
            "measureMxl": "52",
            "afterNoteIndex": 5,
            "clefSign": "G",
            "clefLine": 2,
            "staff": 2,
            "remapStaffPitches": True,
        }
    ],
)
m2 = root2.find(".//measure[@number='52']")
assert _pitches(m2) == ["E5s1", "G5s1", "B5s1", "E6s1", "E1s2", "E2s2"], _pitches(m2)
assert _order(m2)[-1].startswith("clef:G"), _order(m2)

# F clef 뒤(=#4 앞)에 G + remap → #4,#5만 변환, PR 불변
root3 = ET.fromstring(xml)
apply_fixes_to_root(
    root3,
    [
        {
            "kind": "insertClef",
            "partId": "P5",
            "measureMxl": "52",
            "afterNoteIndex": 3,
            "afterClefIndex": 0,
            "clefSign": "G",
            "clefLine": 2,
            "staff": 2,
            "remapStaffPitches": True,
        }
    ],
)
m3 = root3.find(".//measure[@number='52']")
assert _pitches(m3)[:4] == ["E5s1", "G5s1", "B5s1", "E6s1"], _pitches(m3)
assert _pitches(m3)[4:] == ["C3s2", "C4s2"], _pitches(m3)
ord3 = _order(m3)
assert "clef:Fn2" in ord3 and "clef:Gn2" in ord3
assert ord3.index("clef:Gn2") < ord3.index("#4:C3s2"), ord3

print("clef forward-only remap + beforeNoteIndex ok")
