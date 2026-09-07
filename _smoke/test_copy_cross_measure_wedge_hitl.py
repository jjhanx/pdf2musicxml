# -*- coding: utf-8 -*-
"""copyMeasureContent must bring cross-measure wedge stop (m.N→m.N+1)."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, find_measure, find_part  # noqa: E402


def wedges(root: ET.Element, pid: str, mid: str) -> list[tuple[str, str]]:
    part = find_part(root, "", pid)
    m = find_measure(part, "", mid)
    out: list[tuple[str, str]] = []
    for d in m.findall("{*}direction"):
        w = None
        for dt in d.findall("{*}direction-type"):
            w = dt.find("{*}wedge")
            if w is not None:
                break
        if w is None:
            continue
        out.append(((w.get("type") or "").strip(), (w.get("number") or "1").strip()))
    return out


def paired(root: ET.Element, pid: str, start_m: str, stop_m: str) -> bool:
    starts = {n for t, n in wedges(root, pid, start_m) if t in ("crescendo", "diminuendo")}
    stops = {n for t, n in wedges(root, pid, stop_m) if t == "stop"}
    return bool(starts & stops)


root = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1">
  <measure number="42">
    <attributes><divisions>1</divisions></attributes>
    <direction placement="above"><direction-type><wedge type="diminuendo" number="1" spread="15"/></direction-type><staff>1</staff></direction>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure>
  <measure number="43">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <direction placement="above"><direction-type><wedge type="stop" number="1" spread="0"/></direction-type><staff>1</staff></direction>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure>
</part>
<part id="P2">
  <measure number="42">
    <attributes><divisions>1</divisions></attributes>
    <note><rest/><duration>2</duration><type>half</type></note>
  </measure>
  <measure number="43">
    <attributes><divisions>1</divisions></attributes>
    <note><rest/><duration>2</duration><type>half</type></note>
  </measure>
</part>
</score-partwise>"""
)

assert paired(root, "P1", "42", "43"), wedges(root, "P1", "42")
assert not any(t in ("crescendo", "diminuendo") for t, _ in wedges(root, "P2", "42"))

assert apply_fix(
    root,
    "",
    {
        "kind": "copyMeasureContent",
        "partId": "P1",
        "fromPartId": "P1",
        "toPartId": "P2",
        "toPartIds": ["P2"],
        "measureMxl": "42",
        "splitVoices": False,
    },
)

assert paired(root, "P2", "42", "43"), (
    "copy must place stop on next measure",
    wedges(root, "P2", "42"),
    wedges(root, "P2", "43"),
)
# source unchanged
assert paired(root, "P1", "42", "43")

# Dest already has open wedge m41→43; copied m42→43 must use another number and keep both
root2 = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1">
  <measure number="41">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure>
  <measure number="42">
    <attributes><divisions>1</divisions></attributes>
    <direction placement="below"><direction-type><wedge type="crescendo" number="1"/></direction-type><staff>1</staff></direction>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure>
  <measure number="43">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <direction placement="below"><direction-type><wedge type="stop" number="1"/></direction-type><staff>1</staff></direction>
  </measure>
</part>
<part id="P2">
  <measure number="41">
    <attributes><divisions>1</divisions></attributes>
    <direction placement="above"><direction-type><wedge type="diminuendo" number="1"/></direction-type><staff>1</staff></direction>
    <note><pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure>
  <measure number="42">
    <attributes><divisions>1</divisions></attributes>
    <note><rest/><duration>1</duration><type>quarter</type></note>
  </measure>
  <measure number="43">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>B</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
    <direction placement="above"><direction-type><wedge type="stop" number="1"/></direction-type><staff>1</staff></direction>
  </measure>
</part>
</score-partwise>"""
)

assert apply_fix(
    root2,
    "",
    {
        "kind": "copyMeasureContent",
        "partId": "P1",
        "fromPartId": "P1",
        "toPartId": "P2",
        "toPartIds": ["P2"],
        "measureMxl": "42",
        "splitVoices": False,
    },
)
assert paired(root2, "P2", "42", "43"), (wedges(root2, "P2", "42"), wedges(root2, "P2", "43"))
assert paired(root2, "P2", "41", "43"), (
    "pre-existing dest wedge must survive",
    wedges(root2, "P2", "41"),
    wedges(root2, "P2", "43"),
)
nums42 = {n for t, n in wedges(root2, "P2", "42") if t == "crescendo"}
nums41 = {n for t, n in wedges(root2, "P2", "41") if t == "diminuendo"}
assert nums42.isdisjoint(nums41), (nums41, nums42)

print("OK cross-measure wedge copy")
