"""같은 musical onset·다른 voice에 서로 다른 연주순번 → 통일.

예: voice5 po=1(onset0) + voice6 po=6(onset0) → 둘 다 1.
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
    _unify_play_orders_on_same_onset,
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
      <backup><duration>24</duration></backup>
      <note data-hitl-play-order="6">
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

    assert _unify_play_orders_on_same_onset(measure, NS) is True
    f3 = next(n for n in _leaders(measure) if n.findtext("pitch/step") == "F")
    g3 = next(n for n in _leaders(measure) if n.findtext("pitch/step") == "G")
    assert f3.get(PLAY_ORDER_ATTR) == "1", f3.get(PLAY_ORDER_ATTR)
    assert g3.get(PLAY_ORDER_ATTR) == "1", g3.get(PLAY_ORDER_ATTR)

    root2 = ET.fromstring(SAMPLE)
    measure2 = root2.find("part").find("measure")  # type: ignore[union-attr]
    notes2 = list_note_elements(measure2, NS)
    g_i = next(
        i
        for i, n in enumerate(notes2)
        if n.find("chord") is None and n.findtext("pitch/step") == "G"
    )
    stats = apply_fixes_to_root(
        root2,
        [
            {
                "kind": "setPlayOrder",
                "partId": "P5",
                "measureMxl": "21",
                "noteIndex": g_i,
                "playOrder": 1,
            }
        ],
    )
    assert stats["applied"] >= 1, stats
    measure2b = root2.find("part").find("measure")  # type: ignore[union-attr]
    f3b = next(n for n in _leaders(measure2b) if n.findtext("pitch/step") == "F")
    g3b = next(n for n in _leaders(measure2b) if n.findtext("pitch/step") == "G")
    assert f3b.get(PLAY_ORDER_ATTR) == "1"
    assert g3b.get(PLAY_ORDER_ATTR) == "1"

    root3 = ET.fromstring(SAMPLE)
    m3 = root3.find("part").find("measure")  # type: ignore[union-attr]
    snaps = measure_elements_snapshot(m3, NS)
    g_snap = next(s for s in snaps if str(s.get("pitch") or "").startswith("G") and not s.get("chord"))
    f_snap = next(s for s in snaps if str(s.get("pitch") or "").startswith("F") and not s.get("chord"))
    assert int(g_snap.get("playOrder") or g_snap.get("displayPlayOrder") or 0) == 1
    assert int(f_snap.get("playOrder") or f_snap.get("displayPlayOrder") or 0) == 1

    print("play_order_same_onset_unify ok")


if __name__ == "__main__":
    main()
