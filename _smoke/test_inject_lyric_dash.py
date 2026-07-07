#!/usr/bin/env python3
"""가사 토큰 매핑(공백·하이픈·빈 음표) 회귀."""
import io
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from inject_ocr import (  # noqa: E402
    apply_lyric_events,
    build_events_for_items,
    mxl_ns_uri,
    parse_lyric_text_events,
    qname,
)


def _minimal_score_xml(note_count: int = 4):
    notes = "\n".join(
        f'      <note><pitch><step>C</step><octave>4</octave></pitch>'
        f'<duration>4</duration><type>quarter</type></note>'
        for _ in range(note_count)
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
{notes}
    </measure>
  </part>
</score-partwise>
""".encode()


def _lyric_rows(part, ns):
    rows = []
    for note in part.findall(f".//{qname(ns, 'note')}"):
        lyric = note.find(qname(ns, "lyric"))
        if lyric is None:
            rows.append(None)
            continue
        syl = lyric.find(qname(ns, "syllabic"))
        txt = lyric.find(qname(ns, "text"))
        rows.append(
            (
                syl.text if syl is not None else None,
                txt.text if txt is not None else None,
            )
        )
    return rows


def _apply_items(text: str, note_count: int = 4):
    root = ET.parse(io.BytesIO(_minimal_score_xml(note_count))).getroot()
    ns = mxl_ns_uri(root)
    part = root.find(qname(ns, "part"))
    items = [{"text": text, "lyricVoice": "1"}]
    events = build_events_for_items(items)
    apply_lyric_events(part, ns, events, lyric_number=1)
    return _lyric_rows(part, ns)


def test_whole_line_one_note_korean():
    rows = _apply_items("주님의", 1)
    assert rows == [("single", "주님의")], rows
    print("PASS: Korean whole line -> one note")


def test_whole_line_one_note_english():
    rows = _apply_items("hello", 1)
    assert rows == [("single", "hello")], rows
    print("PASS: English whole line -> one note")


def test_syllable_hyphen_within_word():
    rows = _apply_items("가-리", 2)
    assert rows == [("begin", "가-"), ("end", "리")], rows
    print("PASS: hyphen syllable within token")


def test_spaced_empty_note():
    rows = _apply_items("가 - 리", 3)
    assert rows == [("single", "가"), ("single", "-"), ("single", "리")], rows
    print("PASS: spaced standalone - empty note")


def test_english_word_and_syllable():
    rows = _apply_items("hel-lo world", 3)
    assert rows == [("begin", "hel-"), ("end", "lo"), ("single", "world")], rows
    print("PASS: English hel-lo + word boundary")


def test_parse_events_counts():
    ev = parse_lyric_text_events("주 - 님", "1")
    assert [e["op"] for e in ev] == ["syllable", "empty_note", "syllable"]
    print("PASS: parse_lyric_text_events")


if __name__ == "__main__":
    test_whole_line_one_note_korean()
    test_whole_line_one_note_english()
    test_syllable_hyphen_within_word()
    test_spaced_empty_note()
    test_english_word_and_syllable()
    test_parse_events_counts()
    print("ALL OK")
