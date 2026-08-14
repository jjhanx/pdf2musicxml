# -*- coding: utf-8 -*-
"""다성부 짧은 쉼표를 오선 중선에 고정 (F=D3)."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import _ns, list_note_elements, normalize_rest_durations_root  # noqa: E402

XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="4">
      <attributes>
        <divisions>24</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <rest><display-step>A</display-step><display-octave>3</display-octave></rest>
        <duration>12</duration><voice>5</voice><type>eighth</type><staff>2</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>12</duration><voice>5</voice><type>eighth</type><stem>up</stem><staff>2</staff>
      </note>
      <backup><duration>24</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>96</duration><voice>6</voice><type>whole</type><staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def rest_display(note: ET.Element, ns: str) -> tuple[str | None, str | None]:
    rest = note.find(f"{ns}rest") if ns else note.find("rest")
    if rest is None:
        return None, None
    step = rest.find(f"{ns}display-step") if ns else rest.find("display-step")
    octv = rest.find(f"{ns}display-octave") if ns else rest.find("display-octave")
    return (
        (step.text or "").strip() if step is not None and step.text else None,
        (octv.text or "").strip() if octv is not None and octv.text else None,
    )


def main() -> None:
    root = ET.fromstring(XML)
    stats = normalize_rest_durations_root(root)
    ns = _ns(root)
    part = root.find(f"{ns}part")
    measure = part.find(f"{ns}measure")
    eighth = None
    for note in list_note_elements(measure, ns):
        if note.find(f"{ns}rest") is None:
            continue
        type_el = note.find(f"{ns}type")
        if type_el is not None and (type_el.text or "").strip() == "eighth":
            eighth = note
            break
    assert eighth is not None
    step, octv = rest_display(eighth, ns)
    assert (step, octv) == ("D", "3"), (step, octv, stats)
    assert stats["restDisplayPinned"] >= 1, stats
    print("ok", stats)


if __name__ == "__main__":
    main()
