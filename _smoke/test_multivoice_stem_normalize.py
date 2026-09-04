"""다성 겹침 stem 정규화 — 낮은 voice=up, 나머지=down; 빔 그룹은 voice 안에서만."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    _beam_span_note_indices,
    _ns,
    _q,
    list_note_elements,
    normalize_multivoice_stems_in_measure,
)


def _stem(note: ET.Element, ns: str) -> str:
    el = note.find(_q(ns, "stem"))
    return (el.text or "").strip().lower() if el is not None and el.text else ""


def test_overlap_secondary_stem_down_and_beam_isolated() -> None:
    # v1: A5 quarter then beamed E4-D4; v2: overlapping A5 16th + B4-C5 beam (all stem=up in XML)
    xml = """<?xml version="1.0"?>
    <score-partwise>
      <part id="P1">
        <measure number="1">
          <attributes><divisions>4</divisions></attributes>
          <note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration>
            <voice>1</voice><type>quarter</type><stem>up</stem><staff>1</staff></note>
          <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration>
            <voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">begin</beam></note>
          <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>
            <voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">end</beam></note>
          <backup><duration>6</duration></backup>
          <note><pitch><step>A</step><octave>5</octave></pitch><duration>1</duration>
            <voice>2</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">begin</beam></note>
          <note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration>
            <voice>2</voice><type>eighth</type><stem>up</stem><staff>1</staff>
            <beam number="1">continue</beam></note>
          <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration>
            <voice>2</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">end</beam></note>
        </measure>
      </part>
    </score-partwise>
    """
    root = ET.fromstring(xml)
    ns = _ns(root)
    measure = root.find(_q(ns, "part")).find(_q(ns, "measure"))
    assert normalize_multivoice_stems_in_measure(measure, ns) is True
    notes = list_note_elements(measure, ns)
    # v1 A5 up; v1 E4-D4 stay up (no overlap with v2 at that onset)
    assert _stem(notes[0], ns) == "up"
    assert _stem(notes[1], ns) == "up"
    assert _stem(notes[2], ns) == "up"
    # v2 beam all down
    assert _stem(notes[3], ns) == "down"
    assert _stem(notes[4], ns) == "down"
    assert _stem(notes[5], ns) == "down"


def test_beam_span_does_not_cross_voice() -> None:
    xml = """<?xml version="1.0"?>
    <score-partwise>
      <part id="P1">
        <measure number="1">
          <attributes><divisions>1</divisions></attributes>
          <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration>
            <voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">begin</beam></note>
          <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>
            <voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff>
            <beam number="1">end</beam></note>
          <backup><duration>2</duration></backup>
          <note><pitch><step>A</step><octave>5</octave></pitch><duration>1</duration>
            <voice>2</voice><type>16th</type><stem>down</stem><staff>1</staff>
            <beam number="1">begin</beam></note>
          <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration>
            <voice>2</voice><type>16th</type><stem>down</stem><staff>1</staff>
            <beam number="1">end</beam></note>
        </measure>
      </part>
    </score-partwise>
    """
    root = ET.fromstring(xml)
    ns = _ns(root)
    measure = root.find(_q(ns, "part")).find(_q(ns, "measure"))
    notes = list_note_elements(measure, ns)
    # from v2 begin — must not include v1 notes
    span = _beam_span_note_indices(notes, ns, 2, "1")
    assert span == {2, 3}


if __name__ == "__main__":
    test_overlap_secondary_stem_down_and_beam_isolated()
    test_beam_span_does_not_cross_voice()
    print("ok")
