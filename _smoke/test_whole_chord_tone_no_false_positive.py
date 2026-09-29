import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# Add scripts directory
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import omr_score_patches
import fix_audiveris_mxl


def build_test_measure_multivoice(measure_number: int, c5_dur: int, c5_type: str, has_dot: bool) -> ET.Element:
    """Build a multi-voice measure like 바람이 불어오는 곳 M16."""
    m = ET.Element("measure", {"number": str(measure_number)})
    # voice 1 note: C5
    n1 = ET.SubElement(m, "note")
    pitch1 = ET.SubElement(n1, "pitch")
    ET.SubElement(pitch1, "step").text = "C"
    ET.SubElement(pitch1, "octave").text = "5"
    ET.SubElement(n1, "duration").text = str(c5_dur)
    ET.SubElement(n1, "voice").text = "1"
    ET.SubElement(n1, "type").text = c5_type
    if has_dot:
        ET.SubElement(n1, "dot")
    ET.SubElement(n1, "staff").text = "1"

    # backup
    bk = ET.SubElement(m, "backup")
    ET.SubElement(bk, "duration").text = str(c5_dur)

    # voice 2 notes
    for step, octv in [("G", "4"), ("A", "4")]:
        n2 = ET.SubElement(m, "note")
        pitch2 = ET.SubElement(n2, "pitch")
        ET.SubElement(pitch2, "step").text = step
        ET.SubElement(pitch2, "octave").text = octv
        ET.SubElement(n2, "duration").text = "3"
        ET.SubElement(n2, "voice").text = "2"
        ET.SubElement(n2, "type").text = "16th"
        ET.SubElement(n2, "staff").text = "1"

    # staff 2 notes (bass)
    bk2 = ET.SubElement(m, "backup")
    ET.SubElement(bk2, "duration").text = "6"
    n5 = ET.SubElement(m, "note")
    pitch5 = ET.SubElement(n5, "pitch")
    ET.SubElement(pitch5, "step").text = "F"
    ET.SubElement(pitch5, "octave").text = "3"
    ET.SubElement(n5, "duration").text = "12"
    ET.SubElement(n5, "voice").text = "5"
    ET.SubElement(n5, "type").text = "quarter"
    ET.SubElement(n5, "staff").text = "2"

    return m


def build_test_measure_true_whole_note(measure_number: int) -> ET.Element:
    """Build a true whole-note measure where M57 patch is intended."""
    m = ET.Element("measure", {"number": str(measure_number)})
    # RH: C5 whole note
    n1 = ET.SubElement(m, "note")
    pitch1 = ET.SubElement(n1, "pitch")
    ET.SubElement(pitch1, "step").text = "C"
    ET.SubElement(pitch1, "octave").text = "5"
    ET.SubElement(n1, "duration").text = "32"
    ET.SubElement(n1, "voice").text = "1"
    ET.SubElement(n1, "type").text = "whole"
    ET.SubElement(n1, "staff").text = "1"

    # backup
    bk = ET.SubElement(m, "backup")
    ET.SubElement(bk, "duration").text = "32"

    # LH: D#3, F#3, A3 whole chord
    for i, (step, octv, alt) in enumerate([("D", "3", 1), ("F", "3", 1), ("A", "3", 0)]):
        n = ET.SubElement(m, "note")
        if i > 0:
            ET.SubElement(n, "chord")
        pitch = ET.SubElement(n, "pitch")
        ET.SubElement(pitch, "step").text = step
        if alt:
            ET.SubElement(pitch, "alter").text = str(alt)
        ET.SubElement(pitch, "octave").text = octv
        ET.SubElement(n, "duration").text = "32"
        ET.SubElement(n, "voice").text = "5"
        ET.SubElement(n, "type").text = "whole"
        ET.SubElement(n, "staff").text = "2"

    return m


def test_no_false_positive_on_multivoice():
    # Test dotted eighth C5 in multi-voice measure
    m16 = build_test_measure_multivoice(16, c5_dur=9, c5_type="eighth", has_dot=True)
    applied = omr_score_patches._patch_piano_lost_whole_chord_tone(m16, "")
    assert applied == 0, f"Expected 0 applied on multi-voice measure, got {applied}"
    # Verify no chord note added to voice 1
    v1_notes = [n for n in m16.findall("note") if n.findtext("voice") == "1"]
    assert len(v1_notes) == 1, f"Expected 1 note in voice 1, got {len(v1_notes)}"
    assert v1_notes[0].find("chord") is None


def test_applies_on_true_whole_note_chord():
    m57 = build_test_measure_true_whole_note(57)
    applied = omr_score_patches._patch_piano_lost_whole_chord_tone(m57, "")
    assert applied == 2, f"Expected 2 applied on true whole note measure, got {applied}"
    # Verify C6 chord added to voice 1
    v1_notes = [n for n in m57.findall("note") if n.findtext("voice") == "1"]
    assert len(v1_notes) == 2, f"Expected 2 notes in voice 1 (C5 + C6 chord), got {len(v1_notes)}"
    assert v1_notes[1].find("chord") is not None
    assert v1_notes[1].find("pitch/step").text == "C"
    assert v1_notes[1].find("pitch/octave").text == "6"

    # Verify C4 chord added to voice 5
    v5_notes = [n for n in m57.findall("note") if n.findtext("voice") == "5"]
    assert len(v5_notes) == 4, f"Expected 4 notes in voice 5, got {len(v5_notes)}"
    assert v5_notes[-1].find("chord") is not None
    assert v5_notes[-1].find("pitch/step").text == "C"
    assert v5_notes[-1].find("pitch/octave").text == "4"


if __name__ == "__main__":
    test_no_false_positive_on_multivoice()
    test_applies_on_true_whole_note_chord()
    print("ALL TESTS PASSED!")
