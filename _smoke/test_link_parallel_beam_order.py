"""linkParallelOnsets must not reorder notes or break beams — only align selected default-x."""
import importlib
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import omr_hitl_lib as lib

importlib.reload(lib)

xml = """<score-partwise version="3.1">
<part id="P5"><measure number="16">
<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note default-x="10"><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><stem>up</stem><staff>1</staff></note>
<note default-x="100"><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>up</stem><staff>1</staff><beam number="1">begin</beam></note>
<note default-x="200"><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><stem>down</stem><staff>1</staff></note>
<note default-x="150"><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>up</stem><staff>1</staff><beam number="1">end</beam></note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
ns = lib._ns(root)
m = lib.find_measure(lib.find_part(root, ns, "P5"), ns, "16")
notes_before = lib.list_note_elements(m, ns)
order_before = [i for i in range(len(notes_before))]

lib.apply_fixes_to_root(
    root,
    [{"kind": "linkParallelOnsets", "partId": "P5", "measureMxl": "16", "staff": 1, "parallelNoteIndices": [1, 2]}],
)
notes = lib.list_note_elements(m, ns)
pitches = []
for n in notes:
    p = n.find(lib._q(ns, "pitch"))
    pitches.append(p.find(lib._q(ns, "step")).text + p.find(lib._q(ns, "octave")).text)

# XML 문서 순서·빔 그대로 (E4는 E5–F5 사이에 남음)
assert pitches == ["G4", "E5", "E4", "F5"], pitches
e5, e4, f5 = notes[1], notes[2], notes[3]
assert e5.get("default-x") == e4.get("default-x"), (e5.get("default-x"), e4.get("default-x"))
assert any(b.text == "begin" for b in e5.findall(".//" + lib._q(ns, "beam")))
assert any(b.text == "end" for b in f5.findall(".//" + lib._q(ns, "beam")))
starts = {i: t for i, t in lib._staff_timed_leader_starts(m, ns, "1")}
assert starts[1] == starts[2], starts
print("link parallel beam order ok", pitches)
