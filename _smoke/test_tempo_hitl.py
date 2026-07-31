#!/usr/bin/env python3
"""HITL measure tempo set/remove across all parts."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")

from omr_hitl_lib import (  # noqa: E402
    apply_fix,
    measure_snapshot,
    _parse_bpm_from_tempo_direction,
    _q,
)


def tempo_in_measure(part_id: str, mnum: str, root: ET.Element, ns: str) -> float | None:
    part = next(p for p in root.findall(_q(ns, "part")) if p.get("id") == part_id)
    meas = next(m for m in part.findall(_q(ns, "measure")) if m.get("number") == mnum)
    for d in meas.findall(_q(ns, "direction")):
        bpm = _parse_bpm_from_tempo_direction(d, ns)
        if bpm is not None:
            return bpm
    return None


def has_metronome(part_id: str, mnum: str, root: ET.Element, ns: str) -> bool:
    part = next(p for p in root.findall(_q(ns, "part")) if p.get("id") == part_id)
    meas = next(m for m in part.findall(_q(ns, "measure")) if m.get("number") == mnum)
    return meas.find(f".//{_q(ns, 'metronome')}") is not None


XML = """<score-partwise version="3.1">
<part id="P1">
  <measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  </measure>
  <measure number="2">
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  </measure>
</part>
<part id="P2">
  <measure number="1">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  </measure>
  <measure number="2">
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
  </measure>
</part>
</score-partwise>"""

root = ET.fromstring(XML)
ns = ""

assert apply_fix(
    root,
    ns,
    {
        "kind": "setMeasureTempo",
        "partId": "P2",
        "measureMxl": "2",
        "tempoBpm": 88,
        "beatUnit": "quarter",
    },
)
assert tempo_in_measure("P1", "2", root, ns) == 88.0
assert tempo_in_measure("P2", "2", root, ns) == 88.0
assert has_metronome("P1", "2", root, ns)
assert not has_metronome("P2", "2", root, ns)

snap = measure_snapshot(root, ns, "P2", "2")
assert snap is not None
assert snap.get("tempos") and snap["tempos"][0]["tempoBpm"] == 88.0

assert apply_fix(
    root,
    ns,
    {"kind": "removeMeasureTempo", "partId": "P1", "measureMxl": "2"},
)
assert tempo_in_measure("P1", "2", root, ns) is None
assert tempo_in_measure("P2", "2", root, ns) is None

print("OK: tempo HITL all-parts set/remove")
