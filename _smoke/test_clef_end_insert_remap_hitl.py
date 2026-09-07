# -*- coding: utf-8 -*-
"""맨 끝 clef 삽입: trailing F 제거 + remap 시 앞 음 변환·앞 clef 정렬."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root  # noqa: E402


def _dump(m: ET.Element) -> list[str]:
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


# --- trailing F after last note: insert G+remap → F 제거, E1→C3, 앞에 G ---
xml_trail = """<score-partwise version="3.1">
<part id="P5">
<measure number="52">
  <attributes><divisions>4</divisions>
    <clef number="1"><sign>G</sign><line>2</line></clef>
    <clef number="2"><sign>F</sign><line>4</line></clef>
  </attributes>
  <note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><staff>1</staff></note>
  <backup><duration>16</duration></backup>
  <note><pitch><step>E</step><octave>1</octave></pitch><duration>16</duration><type>whole</type><voice>5</voice><staff>2</staff></note>
  <attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
</measure>
</part></score-partwise>"""

root = ET.fromstring(xml_trail)
apply_fixes_to_root(
    root,
    [
        {
            "kind": "insertClef",
            "partId": "P5",
            "measureMxl": "52",
            "afterNoteIndex": 1,
            "clefSign": "G",
            "clefLine": 2,
            "staff": 2,
            "remapStaffPitches": True,
        }
    ],
)
d = _dump(root.find(".//measure[@number='52']"))
assert "#1:C3s2" in d, d
assert d[-1] == "clef:Gn2", d
# 음 뒤·backup 뒤에 F staff2가 남지 않음 (머리 G로 정리)
after_backup = d[d.index("backup") + 1 :]
assert "clef:Fn2" not in after_backup, d
assert all(x != "clef:Fn2" for x in d if x.startswith("clef:") and x != "clef:Gn1"), d

# --- mid F before note + end G+remap: mid→G, pitch remap, trailing G, no F after G ---
xml_mid = """<score-partwise version="3.1">
<part id="P5">
<measure number="52">
  <attributes><divisions>4</divisions>
    <clef number="1"><sign>G</sign><line>2</line></clef>
    <clef number="2"><sign>F</sign><line>4</line></clef>
  </attributes>
  <note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><staff>1</staff></note>
  <backup><duration>16</duration></backup>
  <attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
  <note><pitch><step>E</step><octave>1</octave></pitch><duration>16</duration><type>whole</type><voice>5</voice><staff>2</staff></note>
</measure>
</part></score-partwise>"""
root2 = ET.fromstring(xml_mid)
apply_fixes_to_root(
    root2,
    [
        {
            "kind": "insertClef",
            "partId": "P5",
            "measureMxl": "52",
            "afterNoteIndex": 1,
            "clefSign": "G",
            "clefLine": 2,
            "staff": 2,
            "remapStaffPitches": True,
        }
    ],
)
d2 = _dump(root2.find(".//measure[@number='52']"))
assert "#1:C3s2" in d2, d2
assert d2[-1] == "clef:Gn2", d2
idx_note = d2.index("#1:C3s2")
assert d2[idx_note - 1] == "clef:Gn2", d2
assert "clef:Fn2" not in d2[d2.index("backup") :], d2

# --- mid insert still forward-only: after #0 insert G between notes ---
xml_fwd = """<score-partwise version="3.1">
<part id="P1">
<measure number="1">
  <attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
  <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
  <note><pitch><step>F</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
  <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
</measure>
</part></score-partwise>"""
root3 = ET.fromstring(xml_fwd)
apply_fixes_to_root(
    root3,
    [
        {
            "kind": "insertClef",
            "partId": "P1",
            "measureMxl": "1",
            "afterNoteIndex": 0,
            "clefSign": "G",
            "clefLine": 2,
            "staff": 1,
            "remapStaffPitches": True,
        }
    ],
)
m3 = root3.find(".//measure[@number='1']")
pitches = []
for n in m3.findall("note"):
    p = n.find("pitch")
    pitches.append(f"{p.findtext('step')}{p.findtext('octave')}")
assert pitches[0] == "C3", pitches  # before clef unchanged
assert pitches[1:] == ["D5", "B4"], pitches

print("trailing end clef remap ok")
