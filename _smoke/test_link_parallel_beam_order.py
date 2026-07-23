"""linkParallelOnsets must not move E4 to measure start or break E5-F5 beam."""
import importlib
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import omr_hitl_lib as lib

importlib.reload(lib)

# prefix quarter + parallel pair (E5-F5 beam) + E4 quarter wrongly between beam
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
# G4=0, E5=1, E4=2, F5=3 — link 1 and 2 (E5 + E4)
lib.apply_fixes_to_root(
    root,
    [{"kind": "linkParallelOnsets", "partId": "P5", "measureMxl": "16", "staff": 1, "parallelNoteIndices": [1, 2]}],
)
notes = lib.list_note_elements(m, ns)
pitches = []
for n in notes:
    p = n.find(lib._q(ns, "pitch"))
    pitches.append(p.find(lib._q(ns, "step")).text + p.find(lib._q(ns, "octave")).text)

# prefix notes keep document order; linked pair must not jump ahead of earlier beams
assert pitches.index("E5") > pitches.index("G4"), pitches
assert pitches.index("F5") > pitches.index("G4"), pitches
# E5 before F5 (beam intact in same voice layer)
e5_i = pitches.index("E5")
f5_i = pitches.index("F5")
assert e5_i < f5_i, pitches
# beam tags preserved
e5 = notes[e5_i]
f5 = notes[f5_i]
assert any(b.text == "begin" for b in e5.findall(".//" + lib._q(ns, "beam")))
assert any(b.text == "end" for b in f5.findall(".//" + lib._q(ns, "beam")))
# E4 not at index 0
assert pitches.index("E4") > 0, pitches
# parallel onset same timeline
starts = lib._staff_timed_leader_starts(m, ns, "1")
by_pitch_start = {}
for i, n in enumerate(notes):
    if n.find(lib._q(ns, "chord")) is not None:
        continue
    p = n.find(lib._q(ns, "pitch"))
    name = p.find(lib._q(ns, "step")).text + p.find(lib._q(ns, "octave")).text
    for ni, t in starts:
        if ni == i:
            by_pitch_start[name] = t
assert by_pitch_start.get("E5") == by_pitch_start.get("E4"), by_pitch_start
print("link parallel beam order ok", pitches)
