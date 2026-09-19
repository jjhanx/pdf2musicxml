"""HITL: intentional other voice stays separate with opposite stem (not chord-merged).

Run: python _smoke/test_hitl_voice_keeps_stem.py
"""
from __future__ import annotations

import sys
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    _ns,
    _note_stem_dir,
    _note_voice_staff,
    apply_fix,
    list_note_elements,
    merge_homophonic_parallel_voices_in_measure,
    normalize_multivoice_stems_in_measure,
    rebuild_measure_timeline_clean,
)


def _score_with_pl_v5() -> ET.Element:
    root = ET.Element("score-partwise")
    part = ET.SubElement(root, "part", id="P5")
    m = ET.SubElement(part, "measure", number="13")
    attrs = ET.SubElement(m, "attributes")
    ET.SubElement(attrs, "divisions").text = "12"
    time = ET.SubElement(attrs, "time")
    ET.SubElement(time, "beats").text = "4"
    ET.SubElement(time, "beat-type").text = "4"
    n = ET.SubElement(m, "note")
    n.set("default-x", "32.00")
    p = ET.SubElement(n, "pitch")
    ET.SubElement(p, "step").text = "F"
    ET.SubElement(p, "octave").text = "3"
    ET.SubElement(n, "duration").text = "12"
    ET.SubElement(n, "voice").text = "5"
    ET.SubElement(n, "type").text = "quarter"
    ET.SubElement(n, "stem").text = "up"
    ET.SubElement(n, "staff").text = "2"
    return root


def test_rebuild_does_not_chord_merge_same_duration() -> None:
    root = _score_with_pl_v5()
    part = root.find("part")
    assert part is not None
    m = part.find("measure")
    assert m is not None
    ns = _ns(m)
    n2 = ET.Element("note")
    n2.set("default-x", "32.00")
    p = ET.SubElement(n2, "pitch")
    ET.SubElement(p, "step").text = "F"
    ET.SubElement(p, "octave").text = "2"
    ET.SubElement(n2, "duration").text = "12"
    ET.SubElement(n2, "voice").text = "6"
    ET.SubElement(n2, "type").text = "quarter"
    ET.SubElement(n2, "stem").text = "down"
    ET.SubElement(n2, "staff").text = "2"
    b = ET.SubElement(m, "backup")
    ET.SubElement(b, "duration").text = "12"
    m.append(n2)

    rebuild_measure_timeline_clean(m, ns, part)
    voices = {
        _note_voice_staff(n, ns)[0]
        for n in list_note_elements(m, ns)
        if _note_voice_staff(n, ns)[1] == "2"
    }
    assert voices == {"5", "6"}, f"rebuild must keep both voices, got {voices}"
    normalize_multivoice_stems_in_measure(m, ns)
    by_v: dict[str, str] = {}
    for n in list_note_elements(m, ns):
        v, st = _note_voice_staff(n, ns)
        if st != "2" or n.find("chord") is not None:
            continue
        by_v[v] = _note_stem_dir(n, ns)
    assert by_v.get("5") == "up", by_v
    assert by_v.get("6") == "down", by_v


def test_insert_note_voice_override_stem_down() -> None:
    root = _score_with_pl_v5()
    ns = _ns(root)
    ok = apply_fix(
        root,
        ns,
        {
            "kind": "insertNote",
            "partId": "P5",
            "measureMxl": "13",
            "afterNoteIndex": 0,
            "staff": 2,
            "voice": "6",
            "pitchStep": "F",
            "pitchOctave": 2,
            "noteType": "quarter",
        },
    )
    assert ok
    part = root.find("part")
    assert part is not None
    m = part.find("measure")
    assert m is not None
    pl = [n for n in list_note_elements(m, ns) if _note_voice_staff(n, ns)[1] == "2"]
    voices = {_note_voice_staff(n, ns)[0] for n in pl}
    assert "6" in voices, voices
    v6 = next(n for n in pl if _note_voice_staff(n, ns)[0] == "6")
    assert _note_stem_dir(v6, ns) == "down"
    assert v6.find("chord") is None


def test_omr_merge_still_available() -> None:
    ns = ""
    m = ET.Element("measure", number="1")

    def note(step: str, octv: str, voice: str, dx: str) -> None:
        n = ET.SubElement(m, "note")
        n.set("default-x", dx)
        p = ET.SubElement(n, "pitch")
        ET.SubElement(p, "step").text = step
        ET.SubElement(p, "octave").text = octv
        ET.SubElement(n, "duration").text = "6"
        ET.SubElement(n, "voice").text = voice
        ET.SubElement(n, "type").text = "eighth"
        ET.SubElement(n, "stem").text = "up" if voice == "1" else "down"
        ET.SubElement(n, "staff").text = "1"

    note("A", "4", "1", "32.00")
    note("F", "4", "1", "80.00")
    b = ET.SubElement(m, "backup")
    ET.SubElement(b, "duration").text = "12"
    note("F", "4", "2", "32.00")
    note("C", "4", "2", "80.00")
    assert merge_homophonic_parallel_voices_in_measure(m, ns)


if __name__ == "__main__":
    test_rebuild_does_not_chord_merge_same_duration()
    test_insert_note_voice_override_stem_down()
    test_omr_merge_still_available()
    print("ok")
