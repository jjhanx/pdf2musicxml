#!/usr/bin/env python3
"""검토 '-' 플레이스홀더가 MusicXML lyric으로 주입되는지 회귀."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from inject_ocr import apply_lyric_events, build_events_for_items, mxl_ns_uri, qname  # noqa: E402


def _minimal_score_xml():
    return b"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>
"""


def test_dash_lyric_injected():
    root = ET.parse(io.BytesIO(_minimal_score_xml())).getroot()
    ns = mxl_ns_uri(root)
    part = root.find(qname(ns, "part"))
    items = [{"text": "가-리", "lyricVoice": "1"}]
    events = build_events_for_items(items)
    apply_lyric_events(part, ns, events, lyric_number=1)
    texts = []
    for note in part.findall(f".//{qname(ns, 'note')}"):
        lyric = note.find(qname(ns, "lyric"))
        if lyric is not None:
            t = lyric.find(qname(ns, "text"))
            texts.append(t.text if t is not None else None)
        else:
            texts.append(None)
    assert texts == ["가", "-", "리"], f"unexpected lyric texts: {texts}"
    print("PASS: dash placeholder written to MXL lyrics")
    return True


if __name__ == "__main__":
    ok = test_dash_lyric_injected()
    raise SystemExit(0 if ok else 1)
