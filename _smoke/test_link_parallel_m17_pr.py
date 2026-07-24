"""m17 PR: F4 + Bb4 (quarter) + E5 (eighth beamed to unselected F5) — beam·order·PL intact."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib

ZIP = ROOT / "omr-work-0ea5ea52.zip"
if not ZIP.is_file():
    print("skip: omr-work-0ea5ea52.zip not found")
    raise SystemExit(0)


def load():
    with zipfile.ZipFile(ZIP) as z:
        data = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as inner:
        xml = inner.read([n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])
    return ET.fromstring(xml)


def pitch(n, ns):
    p = n.find(lib._q(ns, "pitch"))
    s = p.find(lib._q(ns, "step")).text
    o = p.find(lib._q(ns, "octave")).text
    a = p.find(lib._q(ns, "alter"))
    acc = "b" if a is not None and a.text == "-1" else ""
    return f"{s}{acc}{o}"


root = load()
ns = lib._ns(root)
m = lib.find_measure(lib.find_part(root, ns, "P5"), ns, "17")
before = [pitch(n, ns) for n in lib.list_note_elements(m, ns)]

root2 = load()
ns2 = lib._ns(root2)
m2 = lib.find_measure(lib.find_part(root2, ns2, "P5"), ns2, "17")
lib.apply_fixes_to_root(
    root2,
    [{
        "kind": "linkParallelOnsets",
        "partId": "P5",
        "measureMxl": "17",
        "staff": 1,
        "parallelNoteIndices": [0, 1, 3],
    }],
)
notes = lib.list_note_elements(m2, ns2)
after = [pitch(n, ns) for n in notes]
assert after == before, after[:6]

f4, bb, d5, e5, f5 = notes[0], notes[1], notes[2], notes[3], notes[4]
assert f4.get("default-x") == e5.get("default-x"), (f4.get("default-x"), e5.get("default-x"))
assert bb.find(lib._q(ns2, "chord")) is not None
assert lib._note_voice_staff(e5, ns2)[0] == lib._note_voice_staff(f5, ns2)[0]
assert lib._note_beams(e5, ns2) == ["begin"] and lib._note_beams(f5, ns2) == ["end"]
starts = dict(lib._staff_timed_leader_starts(m2, ns2, "1"))
assert starts[0] == starts[3], starts
assert d5.get("default-x") != f4.get("default-x"), "unselected D5 stays at earlier onset (t=0)"
print("m17 PR parallel link ok")
