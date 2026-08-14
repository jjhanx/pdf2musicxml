# -*- coding: utf-8 -*-
"""다성부 짧은 쉼표를 오선 중선(F=D3)에 고정."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import (  # noqa: E402
    _ns,
    list_note_elements,
    normalize_rest_durations_root,
    pin_polyphonic_short_rests_in_measure,
    pin_polyphonic_short_rests_in_root,
)

XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part id="P5">
    <measure number="4">
      <attributes>
        <divisions>8</divisions>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <rest>
          <display-step>A</display-step>
          <display-octave>3</display-octave>
        </rest>
        <duration>4</duration>
        <voice>5</voice>
        <type>eighth</type>
        <staff>2</staff>
      </note>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>16</duration>
        <voice>6</voice>
        <type>whole</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def rest_display(note: ET.Element, ns: str) -> tuple[str, str]:
    rest = note.find(f"{{{ns}}}rest") if ns else note.find("rest")
    if rest is None:
        rest = note.find("rest")
    assert rest is not None
    step_el = rest.find(f"{{{ns}}}display-step") if ns else rest.find("display-step")
    oct_el = rest.find(f"{{{ns}}}display-octave") if ns else rest.find("display-octave")
    if step_el is None:
        step_el = rest.find("display-step")
    if oct_el is None:
        oct_el = rest.find("display-octave")
    return (
        (step_el.text or "").strip() if step_el is not None else "",
        (oct_el.text or "").strip() if oct_el is not None else "",
    )


def main() -> None:
    root = ET.fromstring(XML)
    ns = _ns(root)
    part = root.find(f"{{{ns}}}part") if ns else root.find("part")
    assert part is not None
    measure = part.find(f"{{{ns}}}measure") if ns else part.find("measure")
    assert measure is not None
    eighth = next(
        n
        for n in list_note_elements(measure, ns)
        if n.find("rest") is not None or n.find(f"{{{ns}}}rest") is not None
    )
    assert rest_display(eighth, ns) == ("A", "3")
    ok = pin_polyphonic_short_rests_in_measure(measure, ns, part)
    assert ok, "should pin eighth rest"
    assert rest_display(eighth, ns) == ("D", "3"), rest_display(eighth, ns)

    root_copy = ET.fromstring(XML)
    assert pin_polyphonic_short_rests_in_root(root_copy) == 1

    root2 = ET.fromstring(XML)
    stats = normalize_rest_durations_root(root2)
    assert stats["restDisplayPinned"] >= 1, stats
    ns2 = _ns(root2)
    part2 = root2.find(f"{{{ns2}}}part") if ns2 else root2.find("part")
    measure2 = part2.find(f"{{{ns2}}}measure") if ns2 else part2.find("measure")
    eighth2 = next(
        n
        for n in list_note_elements(measure2, ns2)
        if n.find("rest") is not None or n.find(f"{{{ns2}}}rest") is not None
    )
    assert rest_display(eighth2, ns2) == ("D", "3"), rest_display(eighth2, ns2)
    print("ok", stats)


if __name__ == "__main__":
    main()
