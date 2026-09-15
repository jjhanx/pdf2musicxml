"""Chord-gap wedge stop + note dynamics must not appear as measure-only."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    MEASURE_END_ANCHOR_ATTR,
    _apply_note_direction,
    _measure_standalone_directions_snapshot,
    _note_direction_infos,
    list_note_elements,
    repair_directions_between_chord_notes_in_measure,
)


def test_chord_gap_stop_moves_after_chord() -> None:
    m = ET.fromstring(
        """<measure number="5">
  <direction placement="below"><direction-type><wedge type="crescendo" spread="0"/></direction-type><staff>1</staff></direction>
  <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
  <direction placement="below"><direction-type><wedge type="stop" spread="15"/></direction-type><staff>1</staff></direction>
  <note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
</measure>"""
    )
    assert repair_directions_between_chord_notes_in_measure(m, "") >= 1
    kids = list(m)
    stop_i = next(
        i
        for i, c in enumerate(kids)
        if c.tag == "direction" and c.find(".//wedge") is not None and c.find(".//wedge").get("type") == "stop"
    )
    chord_i = next(i for i, c in enumerate(kids) if c.tag == "note" and c.find("chord") is not None)
    assert stop_i > chord_i, (stop_i, chord_i)


def test_add_note_dyn_not_measure_anchor() -> None:
    root = ET.fromstring(
        """<score-partwise version="3.1">
  <part id="P2">
    <measure number="61">
      <attributes><divisions>4</divisions></attributes>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type></note>
    </measure>
  </part>
</score-partwise>"""
    )
    m = root.find("part/measure")
    assert m is not None
    notes = list_note_elements(m, "")
    assert _apply_note_direction(m, notes, 1, "", "dynamics", "f", "above", distance="3")
    e4 = notes[1]
    infos = _note_direction_infos(m, e4, "")
    assert any(i.get("directionType") == "dynamics" and i.get("directionValue") == "f" for i in infos), infos
    standalone = _measure_standalone_directions_snapshot(m, "")
    dyn_rows = [r for r in standalone if r.get("directionType") == "dynamics"]
    for r in dyn_rows:
        assert r.get("measureAnchor") not in ("start", "end"), r
        # direction sits before E4 — not measure-end
        assert r.get("measureAnchor") is None


def test_measure_end_dyn_keeps_anchor() -> None:
    m = ET.fromstring(
        """<measure number="1">
  <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  <direction placement="below" data-hitl-measure-anchor="end">
    <direction-type><dynamics><f/></dynamics></direction-type>
  </direction>
</measure>"""
    )
    rows = _measure_standalone_directions_snapshot(m, "")
    dyn = next(r for r in rows if r.get("directionType") == "dynamics")
    assert dyn.get("measureAnchor") == "end"


if __name__ == "__main__":
    test_chord_gap_stop_moves_after_chord()
    test_add_note_dyn_not_measure_anchor()
    test_measure_end_dyn_keeps_anchor()
    print("ok chord-gap stop + note dyn vs measure anchor")
