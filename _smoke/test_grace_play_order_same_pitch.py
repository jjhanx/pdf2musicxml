"""꾸밈음 삽입이 앞선 같은 높이 음표 연주순번을 건드리지 않는지.

시나리오: voice 안 B4 8분(po=3) 뒤에 C5 2분(po=5) — B4 꾸밈음을 2분 앞에 달아도
앞 B4 8분의 po=3은 유지, 본음만 밀림.

Run: python _smoke/test_grace_play_order_same_pitch.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib  # noqa: E402

XML = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="79">
      <attributes><divisions>2</divisions><staves>1</staves></attributes>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>1</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch>
        <duration>1</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration><type>half</type>
        <voice>5</voice><staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""

root = ET.fromstring(XML)
# 명시 순번: 앞 B4=3, D5=4, 반음=5
lib.apply_fixes_to_root(
    root,
    [
        {"kind": "setPlayOrder", "partId": "P1", "measureMxl": "79", "noteIndex": 0, "playOrder": 3},
        {"kind": "setPlayOrder", "partId": "P1", "measureMxl": "79", "noteIndex": 1, "playOrder": 4},
        {"kind": "setPlayOrder", "partId": "P1", "measureMxl": "79", "noteIndex": 2, "playOrder": 5},
    ],
)
ns = ""
part = lib.find_part(root, ns, "P1")
measure = lib.find_measure(part, ns, "79")
notes = lib.list_note_elements(measure, ns)


def po(i: int) -> str | None:
    return notes[i].get("data-hitl-play-order")


assert po(0) == "3", po(0)
assert po(1) == "4", po(1)
assert po(2) == "5", po(2)

# 2분(#2) 앞에 같은 높이 B4 꾸밈음
ok = lib.apply_fix(
    root,
    ns,
    {
        "kind": "insertGraceNote",
        "partId": "P1",
        "measureMxl": "79",
        "beforeNoteIndex": 2,
        "pitchStep": "B",
        "pitchOctave": 4,
        "noteType": "16th",
        "graceSlash": True,
    },
)
assert ok
notes = lib.list_note_elements(measure, ns)
# #0 B4 eighth, #1 D5, #2 grace B4, #3 half C5
assert notes[2].find(lib._q(ns, "grace")) is not None
assert notes[2].find(lib._q(ns, "pitch") + "/" + lib._q(ns, "step")).text == "B"
assert notes[0].get("data-hitl-play-order") == "3", notes[0].get("data-hitl-play-order")
assert notes[1].get("data-hitl-play-order") == "4", notes[1].get("data-hitl-play-order")
assert notes[2].get("data-hitl-play-order") == "5", notes[2].get("data-hitl-play-order")
assert notes[3].get("data-hitl-play-order") == "6", notes[3].get("data-hitl-play-order")

# setPlayOrder on half must not rewrite earlier B4 eighth (same pitch, other onset)
lib.apply_fixes_to_root(
    root,
    [{"kind": "setPlayOrder", "partId": "P1", "measureMxl": "79", "noteIndex": 3, "playOrder": 7}],
)
notes = lib.list_note_elements(measure, ns)
assert notes[0].get("data-hitl-play-order") == "3", notes[0].get("data-hitl-play-order")
assert notes[3].get("data-hitl-play-order") == "7", notes[3].get("data-hitl-play-order")
# grace keeps its own slot (not forced to 7 via same-pitch)
assert notes[2].get("data-hitl-play-order") == "5", notes[2].get("data-hitl-play-order")

print("OK grace play-order same-pitch isolation")
