"""HITL setNoteStem — 단일 voice stem 혼재 시 monophonic 다수결 정규화가 덮어쓰지 않음."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    HITL_STEM_ATTR,
    _ns,
    _q,
    apply_fix,
    list_note_elements,
    normalize_multivoice_stems_in_measure,
)


def _stem(note: ET.Element, ns: str) -> str:
    el = note.find(_q(ns, "stem"))
    return (el.text or "").strip().lower() if el is not None and el.text else ""


def _locked(note: ET.Element, ns: str) -> bool:
    el = note.find(_q(ns, "stem"))
    return bool(el is not None and el.get(HITL_STEM_ATTR) in ("up", "down"))


def _load_m33_like() -> tuple[ET.Element, str, ET.Element, ET.Element]:
    xml = """<?xml version="1.0"?><score-partwise><part id="P5"><measure number="33">
          <attributes><divisions>4</divisions></attributes>
          <note><pitch><step>A</step><octave>5</octave></pitch><duration>1</duration>
            <voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">begin</beam></note>
          <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration>
            <voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">continue</beam></note>
          <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration>
            <voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">continue</beam></note>
          <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration>
            <voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">end</beam></note>
          <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration>
            <voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">begin</beam></note>
          <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration>
            <voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">continue</beam></note>
          <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration>
            <voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">end</beam></note>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>
            <voice>1</voice><type>quarter</type><stem>up</stem><staff>1</staff></note>
        </measure></part></score-partwise>"""
    root = ET.fromstring(xml)
    ns = _ns(root)
    part = root.find(_q(ns, "part"))
    measure = part.find(_q(ns, "measure"))
    return root, ns, part, measure


def test_set_note_stem_down_survives_monophonic_normalize() -> None:
    root, ns, part, measure = _load_m33_like()
    ok = apply_fix(
        root,
        ns,
        {
            "kind": "setNoteStem",
            "partId": "P5",
            "measureMxl": "33",
            "noteIndex": 0,
            "stem": "down",
        },
    )
    assert ok, "setNoteStem should apply"
    notes = list_note_elements(measure, ns)
    for i in range(4):
        assert _stem(notes[i], ns) == "down", f"note {i} should stay down"
        assert _locked(notes[i], ns), f"note {i} should be hitl-locked"
    for i in range(4, 8):
        assert _stem(notes[i], ns) == "up", f"note {i} should remain up"

    normalize_multivoice_stems_in_measure(measure, ns)
    for i in range(4):
        assert _stem(notes[i], ns) == "down", f"note {i} reverted after normalize"
    for i in range(4, 8):
        assert _stem(notes[i], ns) == "up"


def test_monophonic_normalize_still_unifies_unmarked() -> None:
    xml = """<?xml version="1.0"?><score-partwise><part id="P1"><measure number="1">
          <attributes><divisions>1</divisions></attributes>
          <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration>
            <voice>1</voice><type>quarter</type><stem>up</stem><staff>1</staff></note>
          <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration>
            <voice>1</voice><type>quarter</type><stem>down</stem><staff>1</staff></note>
        </measure></part></score-partwise>"""
    root = ET.fromstring(xml)
    ns = _ns(root)
    measure = root.find(_q(ns, "part")).find(_q(ns, "measure"))
    assert normalize_multivoice_stems_in_measure(measure, ns)
    notes = list_note_elements(measure, ns)
    assert _stem(notes[0], ns) == _stem(notes[1], ns) == "up"


if __name__ == "__main__":
    test_set_note_stem_down_survives_monophonic_normalize()
    test_monophonic_normalize_still_unifies_unmarked()
    print("ok")
