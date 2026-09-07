# -*- coding: utf-8 -*-
"""insertClef / setMeasureClef + remapStaffPitches (중간·마디머리)."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import (  # noqa: E402
    apply_fixes_to_root,
    _clef_change_diatonic_delta,
    _from_diatonic_index,
    _diatonic_index,
    _middle_line_diatonic,
)


def _pitches(measure: ET.Element) -> list[str]:
    out: list[str] = []
    for n in measure.findall("note"):
        p = n.find("pitch")
        if p is None:
            continue
        out.append(f"{p.findtext('step')}{p.findtext('octave')}")
    return out


assert _clef_change_diatonic_delta("F", 4, "G", 2) == (
    _middle_line_diatonic("G", 2) - _middle_line_diatonic("F", 4)
)
f3 = _diatonic_index("F", 3)
d5_step, d5_oct = _from_diatonic_index(f3 + _clef_change_diatonic_delta("F", 4, "G", 2))
assert (d5_step, d5_oct) == ("D", 5), (d5_step, d5_oct)

xml = """<score-partwise version="3.1">
<part id="P1">
<measure number="1">
  <attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
  <note><pitch><step>F</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
  <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
  <note><pitch><step>A</step><octave>2</octave></pitch><duration>1</duration><type>quarter</type></note>
</measure>
</part></score-partwise>"""
root = ET.fromstring(xml)
apply_fixes_to_root(
    root,
    [
        {
            "kind": "setMeasureClef",
            "partId": "P1",
            "measureMxl": "1",
            "clefSign": "G",
            "clefLine": 2,
            "staff": 1,
            "remapStaffPitches": True,
            "removeSubsequentClefs": True,
        }
    ],
)
m1 = root.find(".//measure[@number='1']")
assert m1.findtext("attributes/clef/sign") == "G"
assert _pitches(m1) == ["D5", "B4", "F4"], _pitches(m1)

root_keep = ET.fromstring(xml)
apply_fixes_to_root(
    root_keep,
    [
        {
            "kind": "setMeasureClef",
            "partId": "P1",
            "measureMxl": "1",
            "clefSign": "G",
            "clefLine": 2,
            "staff": 1,
            "removeSubsequentClefs": True,
        }
    ],
)
assert _pitches(root_keep.find(".//measure[@number='1']")) == ["F3", "D3", "A2"]

# insert mid: 앞 유지 뒤만 변환
xml_mid = """<score-partwise version="3.1">
<part id="P1">
<measure number="52">
  <attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
  <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
  <note><pitch><step>F</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
  <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
</measure>
</part></score-partwise>"""
root_mid = ET.fromstring(xml_mid)
apply_fixes_to_root(
    root_mid,
    [
        {
            "kind": "insertClef",
            "partId": "P1",
            "measureMxl": "52",
            "afterNoteIndex": 0,
            "clefSign": "G",
            "clefLine": 2,
            "staff": 1,
            "remapStaffPitches": True,
        }
    ],
)
assert _pitches(root_mid.find(".//measure[@number='52']")) == ["C3", "D5", "B4"]

print("clef remap staff pitches ok")
