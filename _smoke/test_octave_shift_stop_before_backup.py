#!/usr/bin/env python3
"""PR octave-shift stop must stay before cross-staff backup (d9d04491 m30)."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    _local,
    _ns,
    _rebuild_measure_flat_staffs,
    repair_octave_shift_stops_before_cross_staff_backup_in_measure,
)


XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="30">
      <attributes>
        <divisions>4</divisions>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <direction placement="above">
        <direction-type><octave-shift type="up" size="8" number="1">8va</octave-shift></direction-type>
        <staff>1</staff>
      </direction>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <direction placement="above">
        <direction-type><octave-shift type="stop" number="1"/></direction-type>
        <staff>1</staff>
      </direction>
      <backup><duration>16</duration></backup>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>
"""


def stop_index_and_backup(measure: ET.Element) -> tuple[int | None, int | None]:
    stop_i = None
    backup_i = None
    for i, c in enumerate(list(measure)):
        tag = _local(c)
        if tag == "backup":
            backup_i = i
        elif tag == "direction":
            for dt in c:
                if _local(dt) != "direction-type":
                    continue
                for child in dt:
                    if _local(child) == "octave-shift" and child.get("type") == "stop":
                        stop_i = i
    return stop_i, backup_i


def main() -> None:
    root = ET.fromstring(XML)
    ns = _ns(root)
    measure = root.find(".//{*}measure")
    assert measure is not None

    # Simulate the buggy rebuild path that used to pull stop after backup
    # by placing stop after backup first, then repairing.
    children = list(measure)
    stop = None
    for c in children:
        if _local(c) != "direction":
            continue
        for dt in c:
            for child in dt:
                if _local(child) == "octave-shift" and child.get("type") == "stop":
                    stop = c
    assert stop is not None
    measure.remove(stop)
    # append after backup (wrong)
    for i, c in enumerate(list(measure)):
        if _local(c) == "backup":
            measure.insert(i + 1, stop)
            break
    si, bi = stop_index_and_backup(measure)
    assert si is not None and bi is not None and si > bi, (si, bi)

    assert repair_octave_shift_stops_before_cross_staff_backup_in_measure(measure, ns)
    si, bi = stop_index_and_backup(measure)
    assert si is not None and bi is not None and si < bi, (si, bi)

    # rebuild must not move stop after backup again
    _rebuild_measure_flat_staffs(measure, ns)
    si, bi = stop_index_and_backup(measure)
    assert si is not None and bi is not None and si < bi, (si, bi)
    print("ok octave-shift stop stays before cross-staff backup")


if __name__ == "__main__":
    main()
