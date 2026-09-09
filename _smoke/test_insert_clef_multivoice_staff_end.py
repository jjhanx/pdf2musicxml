#!/usr/bin/env python3
"""insertClef at a multi-voice staff end must not affect earlier parallel voices.

Run: python _smoke/test_insert_clef_multivoice_staff_end.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import apply_fixes_to_root  # noqa: E402


RAW = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>Piano</part-name></score-part></part-list>
  <part id="P5">
    <measure number="54">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>12</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>6</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="55">
      <attributes>
        <divisions>4</divisions>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>
"""


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def ns_of(root: ET.Element) -> str:
    return root.tag.split("}", 1)[0][1:] if root.tag.startswith("{") else ""


def q(ns: str, name: str) -> str:
    return f"{{{ns}}}{name}" if ns else name


def find_part(root: ET.Element, ns: str, part_id: str) -> ET.Element:
    for part in root.findall(q(ns, "part")):
        if part.get("id") == part_id:
            return part
    raise AssertionError(f"missing part {part_id}")


def find_measure(part: ET.Element, ns: str, number: str) -> ET.Element:
    for measure in part.findall(q(ns, "measure")):
        if measure.get("number") == number:
            return measure
    raise AssertionError(f"missing measure {number}")


def child_text(el: ET.Element, ns: str, name: str) -> str:
    child = el.find(q(ns, name))
    return (child.text or "").strip() if child is not None else ""


def note_staff(note: ET.Element, ns: str) -> str:
    return child_text(note, ns, "staff") or "1"


def note_voice(note: ET.Element, ns: str) -> str:
    return child_text(note, ns, "voice") or "1"


def note_pitch(note: ET.Element, ns: str) -> str | None:
    pitch = note.find(q(ns, "pitch"))
    if pitch is None:
        return None
    step = child_text(pitch, ns, "step")
    octave = child_text(pitch, ns, "octave")
    return f"{step}{octave}" if step and octave else None


def staff_voice_pitches(measure: ET.Element, ns: str, staff: str, voice: str) -> list[str]:
    out: list[str] = []
    for note in measure.findall(q(ns, "note")):
        if note_staff(note, ns) != staff or note_voice(note, ns) != voice:
            continue
        pitch = note_pitch(note, ns)
        if pitch:
            out.append(pitch)
    return out


def clefs_after_first_note(measure: ET.Element, ns: str, staff: str) -> list[str]:
    seen_note = False
    out: list[str] = []
    for child in list(measure):
        tag = local(child.tag)
        if tag == "note":
            seen_note = True
            continue
        if not seen_note or tag != "attributes":
            continue
        for clef in child.findall(q(ns, "clef")):
            num = (clef.get("number") or "1").strip()
            if num != staff:
                continue
            out.append(f"{child_text(clef, ns, 'sign')}{child_text(clef, ns, 'line')}")
    return out


def header_clefs(measure: ET.Element, ns: str, staff: str) -> list[str]:
    out: list[str] = []
    for child in list(measure):
        tag = local(child.tag)
        if tag == "note":
            break
        if tag != "attributes":
            continue
        for clef in child.findall(q(ns, "clef")):
            num = (clef.get("number") or "1").strip()
            if num == staff:
                out.append(f"{child_text(clef, ns, 'sign')}{child_text(clef, ns, 'line')}")
    return out


def main() -> None:
    root = ET.fromstring(RAW)
    ns = ns_of(root)
    part = find_part(root, ns, "P5")
    m54 = find_measure(part, ns, "54")

    assert staff_voice_pitches(m54, ns, "2", "5") == ["C3", "G3"]
    assert staff_voice_pitches(m54, ns, "2", "6") == ["C3"]

    apply_fixes_to_root(
        root,
        [
            {
                "kind": "insertClef",
                "partId": "P5",
                "measureMxl": "54",
                "afterNoteIndex": 2,
                "staff": 2,
                "clefSign": "F",
                "clefLine": 4,
                "remapStaffPitches": True,
            }
        ],
    )

    part = find_part(root, ns, "P5")
    m54 = find_measure(part, ns, "54")
    m55 = find_measure(part, ns, "55")

    assert staff_voice_pitches(m54, ns, "2", "5") == ["C3", "G3"]
    assert staff_voice_pitches(m54, ns, "2", "6") == ["C3"]
    assert "F4" not in clefs_after_first_note(m54, ns, "2")
    assert "F4" in header_clefs(m55, ns, "2")
    print("insert clef multivoice staff-end ok")


if __name__ == "__main__":
    main()
