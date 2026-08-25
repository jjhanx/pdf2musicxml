"""명시 setPlayOrder는 유지 — 다른 pitch·다른 onset이 같은 순번을 공유할 수 있음.

예: voice5 onset0 po=1, voice6 G3를 po=6으로 두면(voice5 6번째 열에 맞춤) MXL에 6이 남음.
옛 same-onset 자동 통일(_unify…)은 제거됨.
Run: python _smoke/test_play_order_same_onset_unify.py
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
        <duration>16</duration><type>quarter</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>A</step><octave>3</octave></pitch>
        <duration>16</duration><type>quarter</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note data-hitl-play-order="2">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>8</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note data-hitl-play-order="3">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>8</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note data-hitl-play-order="4">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>8</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note data-hitl-play-order="5">
        <pitch><step>F</step><octave>4</octave></pitch>
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


def _leaders(measure: ET.Element) -> list[ET.Element]:
    return [n for n in list_note_elements(measure, NS) if n.find("chord") is None]


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
                "playOrder": 6,
            }
        ],
    )
    assert stats["applied"] >= 1, stats

    measure_b = root.find("part").find("measure")  # type: ignore[union-attr]
    f3 = next(n for n in _leaders(measure_b) if n.findtext("pitch/step") == "F" and n.findtext("pitch/octave") == "3")
    g3 = next(n for n in _leaders(measure_b) if n.findtext("pitch/step") == "G" and n.findtext("pitch/octave") == "3")
    g4 = next(n for n in _leaders(measure_b) if n.findtext("pitch/step") == "G" and n.findtext("pitch/octave") == "4")
    assert f3.get(PLAY_ORDER_ATTR) == "1", f3.get(PLAY_ORDER_ATTR)
    assert g3.get(PLAY_ORDER_ATTR) == "6", g3.get(PLAY_ORDER_ATTR)
    assert g4.get(PLAY_ORDER_ATTR) == "6", g4.get(PLAY_ORDER_ATTR)

    snaps = measure_elements_snapshot(measure_b, NS)
    g3_snap = next(
        s
        for s in snaps
        if str(s.get("pitch") or "").startswith("G3") and not s.get("chord")
    )
    assert int(g3_snap.get("playOrder") or 0) == 6, g3_snap

    print("play_order_explicit_persist ok")


if __name__ == "__main__":
    main()
