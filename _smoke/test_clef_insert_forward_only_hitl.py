# -*- coding: utf-8 -*-
"""insertClef: 앞은 불변, 삽입 이후만 remap (이후 마디 포함)."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fixes_to_root, measure_elements_snapshot  # noqa: E402


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

# 앞 F(머리·mid) 유지, 온음 E1 유지, 맨 끝 G
assert d52[0:2] == ["clef:Gn1", "clef:Fn2"], d52
assert "backup" in d52
assert d52[d52.index("backup") + 1] == "clef:Fn2", d52
assert "#1:E1s2" in d52, d52
assert d52[-1] == "clef:Gn2", d52

# 52 앞 음 불변, 53 staff2는 G 영향 → F3→D5
assert _pitch(m52, "2") == ["E1"], _pitch(m52, "2")
assert _pitch(m53, "2") == ["D5"], _pitch(m53, "2")
assert _pitch(m53, "1") == ["E5"], _pitch(m53, "1")

# 다음 마디 머리에 잔류 F가 있어도 G로 교체 + remap (G 뒤 F 잔류 금지)
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
d52s = _dump(m52s)
assert d52s[0] == "clef:Fn2" and d52s[1] == "#0:F3s2" and d52s[-1] == "clef:Gn2", d52s
assert _pitch(m52s, "2") == ["F3"], _pitch(m52s, "2")
# m53: 잔류 F → G, F3→D5
assert any(
    (c.findtext("sign") or "").upper() == "G"
    for c in m53s.find("attributes").findall("clef")
), ET.tostring(m53s, encoding="unicode")
assert not any(
    (c.findtext("sign") or "").upper() == "F"
    for c in m53s.find("attributes").findall("clef")
), "stale F must not remain after inserted G"
assert _pitch(m53s, "2") == ["D5"], _pitch(m53s, "2")
# m54: 다른 clef(C) — 중단, pitch·clef 불변
assert m54s.findtext("attributes/clef/sign") == "C"
assert _pitch(m54s, "2") == ["C4"], _pitch(m54s, "2")

# trailing F 있으면 제거하고 G만 맨 끝 (앞 mid 없음·머리 F 유지)
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

# beforeNoteIndex 스냅샷
els = measure_elements_snapshot(ET.fromstring(xml).find(".//measure[@number='52']"), "")
clefs = [e for e in els if e.get("elementKind") == "clef"]
assert clefs and clefs[0]["beforeNoteIndex"] == 1, clefs

print("insertClef forward-only ok")
