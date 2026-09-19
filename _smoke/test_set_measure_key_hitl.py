"""마디 머리(음자리표와 같은 attributes)에 조표 삽입·변경·제거."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")

from omr_hitl_lib import apply_fixes_to_root  # noqa: E402

SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>S</part-name></score-part>
    <score-part id="P5"><part-name>P</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <attributes>
        <clef><sign>G</sign><line>2</line></clef>
        <key><fifths>1</fifths></key>
      </attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
  <part id="P5">
    <measure number="11">
      <attributes>
        <divisions>12</divisions>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><type>quarter</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
"""


def _local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def _fifths(measure: ET.Element) -> list[str]:
    out: list[str] = []
    for child in list(measure):
        if _local(child.tag) == "note":
            break
        if _local(child.tag) != "attributes":
            continue
        for key in child:
            if _local(key.tag) != "key":
                continue
            f = None
            for c in key:
                if _local(c.tag) == "fifths":
                    f = c
                    break
            out.append((f.text or "").strip() if f is not None else "")
    return out


def _key_before_clef(attrs: ET.Element) -> bool:
    saw_key = False
    for child in list(attrs):
        loc = _local(child.tag)
        if loc == "key":
            saw_key = True
        if loc == "clef" and not saw_key:
            return False
    return True


root = ET.fromstring(SAMPLE)
stats = apply_fixes_to_root(
    root,
    [{"kind": "setMeasureKey", "partId": "P1", "measureMxl": "1", "fifths": 2}],
)
assert stats["applied"] == 1, stats
m1 = root.find("./part[@id='P1']/measure[@number='1']")
assert m1 is not None
assert _fifths(m1) == ["2"], _fifths(m1)
attrs = [c for c in m1 if _local(c.tag) == "attributes"][0]
assert _key_before_clef(attrs), "key should be before clef in MusicXML attributes order"

stats = apply_fixes_to_root(
    root,
    [
        {
            "kind": "setMeasureKey",
            "partId": "P1",
            "measureMxl": "1-2",
            "fifths": -1,
            "removeSubsequentKeys": True,
        }
    ],
)
assert stats["applied"] == 1, stats
m1 = root.find("./part[@id='P1']/measure[@number='1']")
m2 = root.find("./part[@id='P1']/measure[@number='2']")
assert m1 is not None and m2 is not None
assert _fifths(m1) == ["-1"], _fifths(m1)
assert _fifths(m2) == [], _fifths(m2)

stats = apply_fixes_to_root(
    root,
    [
        {
            "kind": "setMeasureKey",
            "partId": "P5",
            "measureMxl": "11",
            "fifths": 3,
            "staff": 1,
        }
    ],
)
assert stats["applied"] == 1, stats
m11 = root.find("./part[@id='P5']/measure[@number='11']")
assert m11 is not None
assert _fifths(m11) == ["3"], _fifths(m11)

stats = apply_fixes_to_root(
    root,
    [{"kind": "removeMeasureKey", "partId": "P5", "measureMxl": "11"}],
)
assert stats["applied"] == 1, stats
assert _fifths(m11) == [], _fifths(m11)

print("ok setMeasureKey / removeMeasureKey header key with clef")
