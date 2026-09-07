# -*- coding: utf-8 -*-
"""insertClef: 앞은 불변, 삽입 이후만 remap (이후 마디 포함)."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root, measure_elements_snapshot, measure_snapshot  # noqa: E402


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


def _pitch(m: ET.Element, staff: str) -> list[str]:
    out = []
    for n in m.findall("note"):
        if (n.findtext("staff") or "1") != staff:
            continue
        p = n.find("pitch")
        if p is not None:
            out.append(f"{p.findtext('step')}{p.findtext('octave')}")
    return out


xml = """<score-partwise version="3.1">
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
<measure number="53">
  <attributes><divisions>4</divisions></attributes>
  <note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><staff>1</staff></note>
  <backup><duration>16</duration></backup>
  <note><pitch><step>F</step><octave>3</octave></pitch><duration>16</duration><type>whole</type><voice>5</voice><staff>2</staff></note>
</measure>
</part></score-partwise>"""

root = ET.fromstring(xml)
before52 = _dump(root.find(".//measure[@number='52']"))
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
m52 = root.find(".//measure[@number='52']")
m53 = root.find(".//measure[@number='53']")
d52 = _dump(m52)

# 맨 끝 삽입: 현재 마디 완전 불변( trailing G 안 넣음 — OSMD가 앞 음에 G 적용하는 회귀 방지)
assert d52 == before52, (before52, d52)
assert _pitch(m52, "2") == ["E1"], _pitch(m52, "2")
# 다음 마디부터 G + remap F3→D5
assert any(
    (c.findtext("sign") or "").upper() == "G" and c.get("number") == "2"
    for c in m53.find("attributes").findall("clef")
), _dump(m53)
assert _pitch(m53, "2") == ["D5"], _pitch(m53, "2")
assert _pitch(m53, "1") == ["E5"], _pitch(m53, "1")

# 다음 마디 머리 잔류 F → G + remap. 현재 마디는 불변.
xml_stale = """<score-partwise version="3.1">
<part id="P5">
<measure number="52">
  <attributes><divisions>4</divisions>
    <clef number="2"><sign>F</sign><line>4</line></clef>
  </attributes>
  <note><pitch><step>F</step><octave>3</octave></pitch><duration>16</duration><type>whole</type><staff>2</staff></note>
</measure>
<measure number="53">
  <attributes><divisions>4</divisions>
    <clef number="2"><sign>F</sign><line>4</line></clef>
  </attributes>
  <note><pitch><step>F</step><octave>3</octave></pitch><duration>16</duration><type>whole</type><staff>2</staff></note>
</measure>
<measure number="54">
  <attributes><divisions>4</divisions>
    <clef number="2"><sign>C</sign><line>3</line></clef>
  </attributes>
  <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type><staff>2</staff></note>
</measure>
</part></score-partwise>"""
root_s = ET.fromstring(xml_stale)
before_s52 = _dump(root_s.find(".//measure[@number='52']"))
apply_fixes_to_root(
    root_s,
    [
        {
            "kind": "insertClef",
            "partId": "P5",
            "measureMxl": "52",
            "afterNoteIndex": 0,
            "clefSign": "G",
            "clefLine": 2,
            "staff": 2,
            "remapStaffPitches": True,
        }
    ],
)
m52s = root_s.find(".//measure[@number='52']")
m53s = root_s.find(".//measure[@number='53']")
m54s = root_s.find(".//measure[@number='54']")
assert _dump(m52s) == before_s52, (_dump(m52s), before_s52)
assert _pitch(m52s, "2") == ["F3"], _pitch(m52s, "2")
assert any(
    (c.findtext("sign") or "").upper() == "G"
    for c in m53s.find("attributes").findall("clef")
), ET.tostring(m53s, encoding="unicode")
assert not any(
    (c.findtext("sign") or "").upper() == "F"
    for c in m53s.find("attributes").findall("clef")
), "stale F must not remain on following measure"
assert _pitch(m53s, "2") == ["D5"], _pitch(m53s, "2")
assert m54s.findtext("attributes/clef/sign") == "C"
assert _pitch(m54s, "2") == ["C4"], _pitch(m54s, "2")

snap = measure_snapshot(root_s, "", "P5", "52")
assert snap is not None
assert (snap.get("effectiveClefsByStaff") or {}).get("2", {}).get("sign") == "F", snap

# 다음 마디 없음: 끝에 G만 붙이고 이 마디 음은 remap 안 함
xml_t = """<score-partwise version="3.1">
<part id="P5">
<measure number="52">
  <attributes><divisions>4</divisions>
    <clef number="2"><sign>F</sign><line>4</line></clef>
  </attributes>
  <note><pitch><step>E</step><octave>1</octave></pitch><duration>16</duration><type>whole</type><staff>2</staff></note>
  <attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
</measure>
</part></score-partwise>"""
root_t = ET.fromstring(xml_t)
apply_fixes_to_root(
    root_t,
    [
        {
            "kind": "insertClef",
            "partId": "P5",
            "measureMxl": "52",
            "afterNoteIndex": 0,
            "clefSign": "G",
            "clefLine": 2,
            "staff": 2,
            "remapStaffPitches": True,
        }
    ],
)
dt = _dump(root_t.find(".//measure[@number='52']"))
assert dt == ["clef:Fn2", "#0:E1s2", "clef:Gn2"], dt

# 중간 삽입: 앞 음 불변, 뒤만 변환
xml_m = """<score-partwise version="3.1">
<part id="P1">
<measure number="1">
  <attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
  <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
  <note><pitch><step>F</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
  <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
</measure>
</part></score-partwise>"""
root_m = ET.fromstring(xml_m)
apply_fixes_to_root(
    root_m,
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
pm = []
for n in root_m.find(".//measure").findall("note"):
    p = n.find("pitch")
    pm.append(f"{p.findtext('step')}{p.findtext('octave')}")
assert pm == ["C3", "D5", "B4"], pm

# backup 뒤 mid F: 같은 staff 직전 음 없으면 after=-1, beforeNoteIndex=PL
els = measure_elements_snapshot(ET.fromstring(xml).find(".//measure[@number='52']"), "")
clefs = [e for e in els if e.get("elementKind") == "clef"]
pl_clefs = [c for c in clefs if c.get("staff") == 2]
assert pl_clefs and pl_clefs[0].get("beforeNoteIndex") == 1, pl_clefs

print("insertClef forward-only ok")
