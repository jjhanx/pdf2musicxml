"""linkParallelOnsets — eighth + quarter different stems at same onset."""
import importlib
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import omr_hitl_lib as lib

importlib.reload(lib)

xml = """<score-partwise version="3.1">
<part id="P5"><measure number="16">
<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
<note default-x="100"><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>up</stem><staff>1</staff><beam number="1">begin</beam></note>
<note default-x="200"><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><stem>down</stem><staff>1</staff></note>
<note default-x="150"><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><stem>up</stem><staff>1</staff><beam number="1">end</beam></note>
</measure></part></score-partwise>"""
root = ET.fromstring(xml)
stats = lib.apply_fixes_to_root(
    root,
    [
        {
            "kind": "linkParallelOnsets",
            "partId": "P5",
            "measureMxl": "16",
            "staff": 1,
            "parallelNoteIndices": [0, 1],
        }
    ],
)
assert stats["applied"] == 1, stats
measure = root.find(".//{*}measure")
ns = lib._ns(root)
notes = lib.list_note_elements(measure, ns)
by_pitch = {}
for i, n in enumerate(notes):
    step = n.find(lib._q(ns, "pitch")).find(lib._q(ns, "step")).text
    octv = n.find(lib._q(ns, "pitch")).find(lib._q(ns, "octave")).text
    by_pitch[f"{step}{octv}"] = lib._note_voice_staff(n, ns)[0]
assert by_pitch["E5"] != by_pitch["E4"], by_pitch
starts = lib._staff_timed_leader_starts(measure, ns, "1")
e5_i = next(i for i, n in enumerate(notes) if "E" in (n.find(lib._q(ns, "pitch")).find(lib._q(ns, "step")).text or "") and n.find(lib._q(ns, "pitch")).find(lib._q(ns, "octave")).text == "5" and n.find(lib._q(ns, "chord")) is None)
e4_i = next(i for i, n in enumerate(notes) if n.find(lib._q(ns, "pitch")).find(lib._q(ns, "step")).text == "E" and n.find(lib._q(ns, "pitch")).find(lib._q(ns, "octave")).text == "4")
by_idx = {i: t for i, t in starts}
assert by_idx.get(e5_i) == by_idx.get(e4_i), by_idx
print("link parallel onsets ok")
