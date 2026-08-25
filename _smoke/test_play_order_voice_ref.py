"""연주순번 `5-6` = voice5의 순번6 열에 맞춤 (교차 voice 참조).

Run: python _smoke/test_play_order_voice_ref.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    PLAY_ORDER_ATTR,
    apply_fixes_to_root,
    list_note_elements,
    measure_elements_snapshot,
)

NS = ""

SAMPLE = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="21">
      <attributes><divisions>8</divisions></attributes>
      <note data-hitl-play-order="1">
        <pitch><step>F</step><octave>3</octave></pitch>
        <duration>8</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note data-hitl-play-order="2">
        <pitch><step>A</step><octave>3</octave></pitch>
        <duration>8</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note data-hitl-play-order="3">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>8</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note data-hitl-play-order="4">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>8</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note data-hitl-play-order="5">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>8</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note data-hitl-play-order="6">
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>8</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <backup><duration>48</duration></backup>
      <note data-hitl-play-order="1">
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>16</duration><type>quarter</type>
        <voice>6</voice><staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>B</step><octave>3</octave></pitch>
        <duration>16</duration><type>quarter</type>
        <voice>6</voice><staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""


def main() -> None:
    root = ET.fromstring(SAMPLE)
    measure = root.find("part").find("measure")  # type: ignore[union-attr]
    notes = list_note_elements(measure, NS)
    g3_i = next(
        i
        for i, n in enumerate(notes)
        if n.find("chord") is None
        and n.findtext("pitch/step") == "G"
        and n.findtext("pitch/octave") == "3"
    )
    stats = apply_fixes_to_root(
        root,
        [
            {
                "kind": "setPlayOrder",
                "partId": "P5",
                "measureMxl": "21",
                "noteIndex": g3_i,
                "playOrderAlign": "5-6",
            }
        ],
    )
    assert stats["applied"] >= 1, stats
    g3 = notes[g3_i]
    assert g3.get(PLAY_ORDER_ATTR) == "5-6", g3.get(PLAY_ORDER_ATTR)
    chord = notes[g3_i + 1]
    assert chord.get(PLAY_ORDER_ATTR) == "5-6", chord.get(PLAY_ORDER_ATTR)

    snaps = measure_elements_snapshot(measure, NS)
    g_snap = next(s for s in snaps if s.get("pitch") == "G3" and not s.get("chord"))
    assert g_snap.get("playOrderAlign") == "5-6", g_snap
    assert g_snap.get("playOrder") is None
    assert g_snap.get("displayPlayOrder") == "5-6"

    # voice5 po6 유지
    g4 = next(
        n
        for n in notes
        if n.find("chord") is None
        and n.findtext("pitch/step") == "G"
        and n.findtext("pitch/octave") == "4"
    )
    assert g4.get(PLAY_ORDER_ATTR) == "6"

    print("play_order_voice_ref ok")


if __name__ == "__main__":
    main()
