# -*- coding: utf-8 -*-
"""다성부 짧은 쉼표 — 동시 다른 voice 음의 반대편(오선 안)에 배치."""
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
    <measure number="5">
      <attributes>
        <divisions>24</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <rest><display-step>F</display-step><display-octave>3</display-octave></rest>
        <duration>12</duration><voice>5</voice><type>eighth</type><staff>2</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>12</duration><voice>5</voice><type>eighth</type><stem>up</stem><staff>2</staff>
      </note>
      <attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>24</duration><voice>5</voice><type>quarter</type><staff>2</staff>
      </note>
      <backup><duration>48</duration></backup>
      <note>
        <pitch><step>A</step><octave>2</octave></pitch>
        <duration>48</duration><voice>6</voice><type>half</type><staff>2</staff>
      </note>
    </measure>
    <measure number="6">
      <attributes>
        <divisions>2</divisions>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <rest/>
        <duration>1</duration><voice>1</voice><type>eighth</type>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration><voice>1</voice><type>eighth</type>
      </note>
      <backup><duration>2</duration></backup>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>2</duration><voice>2</voice><type>quarter</type>
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


def first_eighth_rest(measure: ET.Element, ns: str) -> ET.Element:
    for note in list_note_elements(measure, ns):
        if note.find(f"{ns}rest") is None:
            continue
        type_el = note.find(f"{ns}type")
        if type_el is not None and (type_el.text or "").strip() == "eighth":
            return note
    raise AssertionError("eighth rest missing")


def main() -> None:
    root = ET.fromstring(XML)
    stats = normalize_rest_durations_root(root)
    ns = _ns(root)
    part = root.find(f"{ns}part")
    assert part is not None
    measures = list(part.findall(f"{ns}measure"))

    # m4: 다른 voice C3(중선 D3 아래) → 쉼표는 위쪽 F3, 포개지지 않음
    step, octv = rest_display(first_eighth_rest(measures[0], ns), ns)
    assert (step, octv) == ("F", "3"), (step, octv, stats)

    # m5: 앞쪽 mid F 유지. 다른 voice A2 → 위쪽 F3 (mid G로 B4에 안 감)
    step5, octv5 = rest_display(first_eighth_rest(measures[1], ns), ns)
    assert (step5, octv5) == ("F", "3"), (step5, octv5, "mid G must not pin opening rest to B4")

    # m6: 다른 voice E5(중선 위) → 쉼표는 아래 G4
    step6, octv6 = rest_display(first_eighth_rest(measures[2], ns), ns)
    assert (step6, octv6) == ("G", "4"), (step6, octv6)

    assert stats["restDisplayPinned"] >= 1, stats
    print("ok", stats)


if __name__ == "__main__":
    main()
