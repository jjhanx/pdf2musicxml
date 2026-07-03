import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import apply_fix, measure_snapshot  # noqa: E402


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
fix = {
    "kind": "applyBeam",
    "partId": "P1",
    "measureMxl": "1",
    "fromNoteIndex": 0,
    "toNoteIndex": 2,
    "beamNumber": 1,
}
assert apply_fix(root, "", fix)
snap = measure_snapshot(root, "", "P1", "1")
notes = [e for e in snap["elements"] if e.get("elementKind") == "note"]
assert notes[0]["beams"] == ["begin"]
assert notes[1]["beams"] == ["continue"]
assert notes[2]["beams"] == ["end"]

part = root.find(".//{*}part")
measure = part.find("{*}measure")
note_els = [n for n in measure if _local(n.tag) == "note"]
for note in note_els:
    direct = [b for b in note if _local(b.tag) == "beam"]
    assert direct, "beam must be direct child of note for OSMD"
    notations = note.find("{*}notations")
    if notations is not None:
        assert not list(notations.findall("{*}beam")), "beam must not live under notations"

chord_xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>down</stem></note>
<note><chord/><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>eighth</type><stem>down</stem></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>down</stem></note>
</measure></part></score-partwise>"""
root2 = ET.fromstring(chord_xml)
assert apply_fix(
    root2,
    "",
    {
        "kind": "applyBeam",
        "partId": "P1",
        "measureMxl": "1",
        "fromNoteIndex": 0,
        "toNoteIndex": 2,
        "beamNumber": 1,
    },
)
snap2 = measure_snapshot(root2, "", "P1", "1")
notes2 = [e for e in snap2["elements"] if e.get("elementKind") == "note"]
assert notes2[0]["beams"] == ["begin"]
assert notes2[1]["beams"] == ["begin"]
assert notes2[2]["beams"] == ["end"]

fix2 = {
    "kind": "removeBeam",
    "partId": "P1",
    "measureMxl": "1",
    "fromNoteIndex": 0,
    "toNoteIndex": 2,
}
assert apply_fix(root, "", fix2)
snap3 = measure_snapshot(root, "", "P1", "1")
notes3 = [e for e in snap3["elements"] if e.get("elementKind") == "note"]
assert all(not n.get("beams") for n in notes3)
print("beam ok")

# pitch 힌트(G4)와 XML alter(G#4) 불일치 — #index·beamNoteCount 우선
sharp_xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>G</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note><pitch><step>G</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
</measure></part></score-partwise>"""
root3 = ET.fromstring(sharp_xml)
assert apply_fix(
    root3,
    "",
    {
        "kind": "applyBeam",
        "partId": "P1",
        "measureMxl": "1",
        "fromNoteIndex": 0,
        "toNoteIndex": 2,
        "fromPitch": "G4",
        "toPitch": "G4",
        "beamNumber": 1,
        "beamNoteCount": 3,
    },
)
snap4 = measure_snapshot(root3, "", "P1", "1")
notes4 = [e for e in snap4["elements"] if e.get("elementKind") == "note"]
assert notes4[0]["beams"] == ["begin"]
assert notes4[1]["beams"] == ["continue"]
assert notes4[2]["beams"] == ["end"]

# 화음 중간 + beamNoteCount로 3리더 확장
extend_xml = """<score-partwise version="3.1">
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>up</stem></note>
</measure></part></score-partwise>"""
root4 = ET.fromstring(extend_xml)
assert apply_fix(
    root4,
    "",
    {
        "kind": "applyBeam",
        "partId": "P1",
        "measureMxl": "1",
        "fromNoteIndex": 0,
        "toNoteIndex": 2,
        "beamNumber": 1,
        "beamNoteCount": 3,
    },
)
snap5 = measure_snapshot(root4, "", "P1", "1")
notes5 = [e for e in snap5["elements"] if e.get("elementKind") == "note"]
assert notes5[0]["beams"] == ["begin"]
assert notes5[2]["beams"] == ["continue"]
assert notes5[3]["beams"] == ["end"]
print("beam pitch/extend ok")
