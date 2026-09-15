"""Chord-gap repair must not pull post-chord dyn/stop onto previous chord onset."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    _apply_note_direction,
    _note_direction_infos,
    list_note_elements,
    repair_adjacent_wedge_stop_after_notes_in_measure,
    repair_directions_between_chord_notes_in_measure,
)


def pitch_of(note: ET.Element) -> str:
    p = note.find("pitch")
    assert p is not None
    return f"{p.findtext('step')}{p.findtext('octave')}"


def test_m61_f_on_e4_stays() -> None:
    m = ET.fromstring(
        """<measure number="61">
  <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note>
  <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
  <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note>
  <direction><direction-type><wedge type="stop" spread="15"/></direction-type></direction>
  <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type></note>
  <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type></note>
</measure>"""
    )
    # existing f between D5 and E5 chord → move to before D5 only
    assert repair_directions_between_chord_notes_in_measure(m, "") == 1
    notes = list_note_elements(m, "")
    e4 = next(i for i, n in enumerate(notes) if pitch_of(n) == "E4")
    assert _apply_note_direction(m, notes, e4, "", "dynamics", "f", "above", distance="3")
    # must not pull E4's f onto D5
    assert repair_directions_between_chord_notes_in_measure(m, "") == 0
    notes2 = list_note_elements(m, "")
    d5 = notes2[0]
    e4n = notes2[e4]
    d5_dyn = [d for d in _note_direction_infos(m, d5, "") if d.get("directionType") == "dynamics"]
    e4_dyn = [d for d in _note_direction_infos(m, e4n, "") if d.get("directionType") == "dynamics"]
    assert any(d.get("directionValue") == "f" for d in d5_dyn), d5_dyn
    assert any(d.get("directionValue") == "f" for d in e4_dyn), e4_dyn
    # E4 still has its own f immediately before it
    kids = list(m)
    e4_el = notes2[e4]
    ei = kids.index(e4_el)
    assert kids[ei - 1].find(".//dynamics") is not None


def test_adjacent_wedge_moves_past_note() -> None:
    m = ET.fromstring(
        """<measure number="69">
  <direction><direction-type><wedge type="crescendo" spread="0"/></direction-type></direction>
  <direction><direction-type><wedge type="stop" spread="15"/></direction-type></direction>
  <note><pitch><step>A</step><octave>2</octave></pitch><duration>8</duration><type>half</type></note>
  <note><chord/><pitch><step>E</step><octave>3</octave></pitch><duration>8</duration><type>half</type></note>
</measure>"""
    )
    assert repair_adjacent_wedge_stop_after_notes_in_measure(m, "") == 1
    kids = list(m)
    stop_i = next(
        i
        for i, c in enumerate(kids)
        if c.tag == "direction" and c.find(".//wedge") is not None and c.find(".//wedge").get("type") == "stop"
    )
    chord_i = next(i for i, c in enumerate(kids) if c.tag == "note" and c.find("chord") is not None)
    assert stop_i > chord_i


def test_m35_stop_after_chords_untouched() -> None:
    m = ET.fromstring(
        """<measure number="35">
  <direction><direction-type><wedge type="crescendo" spread="0"/></direction-type></direction>
  <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
  <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
  <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
  <note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
  <direction><direction-type><wedge type="stop" spread="15"/></direction-type></direction>
  <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
  <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type></note>
</measure>"""
    )
    assert repair_directions_between_chord_notes_in_measure(m, "") == 0
    kids = list(m)
    stop_i = next(
        i
        for i, c in enumerate(kids)
        if c.tag == "direction" and c.find(".//wedge") is not None and c.find(".//wedge").get("type") == "stop"
    )
    f_i = next(i for i, c in enumerate(kids) if c.tag == "direction" and c.find(".//dynamics") is not None)
    e4_i = next(
        i
        for i, c in enumerate(kids)
        if c.tag == "note"
        and c.find("chord") is None
        and c.find("pitch") is not None
        and c.findtext("pitch/step") == "E"
        and c.findtext("pitch/octave") == "4"
    )
    assert stop_i < f_i < e4_i


def test_backup_stop_moves_before_backup() -> None:
    m = ET.fromstring(
        """<measure number="5">
  <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><staff>1</staff></note>
  <direction><direction-type><wedge type="crescendo" spread="0"/></direction-type><staff>1</staff></direction>
  <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>whole</type><staff>1</staff></note>
  <backup><duration>9</duration></backup>
  <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
  <direction><direction-type><wedge type="stop" spread="15"/></direction-type><staff>1</staff></direction>
  <note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
</measure>"""
    )
    from omr_hitl_lib import repair_wedge_stops_after_same_staff_backup_in_measure

    assert repair_wedge_stops_after_same_staff_backup_in_measure(m, "") == 1
    kids = list(m)
    stop_i = next(
        i
        for i, c in enumerate(kids)
        if c.tag == "direction" and c.find(".//wedge") is not None and c.find(".//wedge").get("type") == "stop"
    )
    backup_i = next(i for i, c in enumerate(kids) if c.tag == "backup")
    assert stop_i < backup_i


if __name__ == "__main__":
    test_m61_f_on_e4_stays()
    test_adjacent_wedge_moves_past_note()
    test_m35_stop_after_chords_untouched()
    test_backup_stop_moves_before_backup()
    print("ok chord-gap scope + adjacent wedge + m61 f + backup stop")
