"""Cross-measure diminuendo (wedge start m.N, stop m.N+1)."""
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, _local  # noqa: E402


def wedges_in(measure: ET.Element) -> list[tuple[str, str]]:
    out = []
    for d in measure.findall("{*}direction"):
        w = None
        for dt in d.findall("{*}direction-type"):
            w = dt.find("{*}wedge")
            if w is not None:
                break
        if w is None:
            continue
        out.append(((w.get("type") or "").strip(), (w.get("number") or "1").strip()))
    return out


root = ET.fromstring(
    """<score-partwise version="3.1">
<part id="P1">
  <measure number="42">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure>
  <measure number="43">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure>
</part>
</score-partwise>"""
)

assert apply_fix(
    root,
    "",
    {
        "kind": "insertWedge",
        "partId": "P1",
        "measureMxl": "42",
        "toMeasureMxl": "43",
        "directionValue": "diminuendo",
        "fromNoteIndex": 1,
        "toNoteIndex": 0,
        "staff": 1,
        "placement": "above",
    },
)

m42 = root.find("./part/measure[@number='42']")
m43 = root.find("./part/measure[@number='43']")
w42 = wedges_in(m42)
w43 = wedges_in(m43)
assert any(t == "diminuendo" for t, _ in w42), w42
assert any(t == "stop" for t, _ in w43), w43
num = next(n for t, n in w42 if t == "diminuendo")
assert any(t == "stop" and n == num for t, n in w43), (w42, w43)
# start must not have stop in same measure
assert not any(t == "stop" for t, _ in w42), w42

assert apply_fix(
    root,
    "",
    {
        "kind": "setWedgeSpan",
        "partId": "P1",
        "measureMxl": "42",
        "toMeasureMxl": "43",
        "wedgeNumber": num,
        "directionValue": "diminuendo",
        "fromNoteIndex": 0,
        "toNoteIndex": 1,
        "staff": 1,
        "placement": "above",
    },
)
w42b = wedges_in(m42)
w43b = wedges_in(m43)
assert any(t == "diminuendo" for t, _ in w42b)
assert any(t == "stop" for t, _ in w43b)

assert apply_fix(
    root,
    "",
    {
        "kind": "removeWedge",
        "partId": "P1",
        "measureMxl": "42",
        "toMeasureMxl": "43",
        "wedgeNumber": num,
        "staff": 1,
    },
)
assert wedges_in(m42) == []
assert wedges_in(m43) == []

print("OK cross-measure wedge HITL")
