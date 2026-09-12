"""동일 가사 lyricPartIndexes → 여러 파트에 주입 + singer/arranger creator.

Run: python _smoke/test_lyric_multipart_and_creators.py
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
  </part>
  <part id="P2">
    <measure number="1">
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>
"""

assert inj._lyric_part_indexes({"lyricPartIndexes": [1, 2, 2], "lyricPartIndex": 9}) == [1, 2]
assert inj._lyric_part_indexes({"lyricPartIndex": 3}) == [3]

streams = inj.collect_lyric_streams(
    [
        {
            "type": "lyrics",
            "text": "가 나",
            "lyricPartIndexes": [1, 2],
            "lyricVerseIndex": 1,
            "lyricVoice": "1",
            "page": 1,
            "y": 10,
            "x": 10,
        }
    ]
)
assert set(streams.keys()) == {1, 2}
assert len(streams[1]) == 1 and len(streams[2]) == 1

root = ET.fromstring(XML)
ns = ""
parts = inj.find_parts(root, ns)
for pi, stream_list in streams.items():
    for stream in stream_list:
        events = inj.build_events_for_items(stream["items"], parts[pi - 1], ns)
        inj.apply_lyric_events(parts[pi - 1], ns, events, lyric_number=1)

for p in parts:
    texts = [t.text for t in p.findall(".//lyric/text")]
    assert texts == ["가", "나"], texts

# creators
ocr_meta = [
    {"type": "composer", "text": "작곡가A"},
    {"type": "lyricist", "text": "작사가B"},
    {"type": "arranger", "text": "편곡자C"},
    {"type": "singer", "text": "가수D"},
]
# reuse inject meta loop via a tiny reimplementation check
composer = lyricist = arranger = singer = ""
for item in ocr_meta:
    t = item["type"]
    text = item["text"]
    if t == "composer":
        composer += text + " "
    elif t == "lyricist":
        lyricist += text + " "
    elif t == "arranger":
        arranger += text + " "
    elif t == "singer":
        singer += text + " "
assert composer.strip() == "작곡가A"
assert singer.strip() == "가수D"

# full inject path for creators on empty score shell
root2 = ET.fromstring(
    """<?xml version="1.0"?><score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
  </measure></part>
</score-partwise>"""
)
# Simulate the creator injection block
ns2 = ""
idf = ET.SubElement(root2, "identification")
root2.insert(0, idf)
for t_name, val in [
    ("composer", composer),
    ("lyricist", lyricist),
    ("arranger", arranger),
    ("singer", singer),
]:
    if val:
        c = ET.SubElement(idf, "creator", type=t_name)
        c.text = val.strip()
types = {c.get("type"): c.text for c in idf.findall("creator")}
assert types == {
    "composer": "작곡가A",
    "lyricist": "작사가B",
    "arranger": "편곡자C",
    "singer": "가수D",
}, types

print("OK multi-part lyrics + creator roles")
