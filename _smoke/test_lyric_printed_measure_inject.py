"""가사 블록 lyricPrintedMeasure → 해당 MusicXML 마디부터 주입.

Run: python _smoke/test_lyric_printed_measure_inject.py
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import inject_ocr as inj  # noqa: E402

XML = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>S</part-name></score-part>
    <score-part id="P2"><part-name>A</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
    </measure>
    <measure number="2">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
    </measure>
    <measure number="3">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
    </measure>
    <measure number="3">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>
"""

root = ET.fromstring(XML)
ns = ""
parts = inj.find_parts(root, ns)
assert len(parts) == 2

# S: 인쇄 마디 3부터 "솔"
events_s = inj.build_events_for_items(
    [
        {
            "text": "솔",
            "lyricVoice": "1",
            "lyricPrintedMeasure": 3,
        }
    ],
    parts[0],
    ns,
)
assert any(e.get("op") == "seek_measure" and e.get("mxlMeasure") == 3 for e in events_s)
inj.apply_lyric_events(parts[0], ns, events_s, lyric_number=1)

m1 = parts[0].findall("measure")[0]
m3 = parts[0].findall("measure")[2]
assert m1.find(".//lyric") is None, "m1 must stay empty"
ly = m3.find(".//lyric/text")
assert ly is not None and ly.text == "솔", ly.text if ly is not None else None

# A: 성부 2 + 인쇄 마디 2 → "라 시"
events_a = inj.build_events_for_items(
    [
        {
            "text": "라 시",
            "lyricVoice": "1",
            "lyricPrintedMeasure": 2,
        }
    ],
    parts[1],
    ns,
)
inj.apply_lyric_events(parts[1], ns, events_a, lyric_number=1)
a_m1 = parts[1].findall("measure")[0]
a_m2 = parts[1].findall("measure")[1]
assert a_m1.find(".//lyric") is None
texts = [t.text for t in a_m2.findall(".//lyric/text")]
assert texts == ["라", "시"], texts

print("OK lyricPrintedMeasure inject seek")
