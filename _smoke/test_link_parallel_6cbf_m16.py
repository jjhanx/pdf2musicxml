"""Real 6cbf PR m16: link #16+#17 — document order unchanged, x aligned only."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib

ZIP = ROOT / "omr-work-6cbf1add.zip"
PART = "P4"


def load():
    with zipfile.ZipFile(ZIP) as z:
        data = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as inner:
        xml = inner.read([n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])
    return ET.fromstring(xml)


def pitch(n, ns):
    p = n.find(lib._q(ns, "pitch"))
    if p is None:
        return "rest"
    s = p.find(lib._q(ns, "step")).text
    o = p.find(lib._q(ns, "octave")).text
    a = p.find(lib._q(ns, "alter"))
    acc = { "-1": "b", "1": "#" }.get(a.text.strip(), "") if a is not None and a.text else ""
    ch = " chord" if n.find(lib._q(ns, "chord")) is not None else ""
    return f"{s}{acc}{o}{ch}"


root = load()
ns = lib._ns(root)
m = lib.find_measure(lib.find_part(root, ns, PART), ns, "16")
notes = lib.list_note_elements(m, ns)
before = [pitch(n, ns) for n in notes]

lib.apply_fixes_to_root(
    root,
    [{"kind": "linkParallelOnsets", "partId": PART, "measureMxl": "16", "staff": 1, "parallelNoteIndices": [16, 17]}],
)

notes2 = lib.list_note_elements(m, ns)
after = [pitch(n, ns) for n in notes2]
assert after == before, (before[14:20], after[14:20])

e5 = notes2[16]
e4 = notes2[17]
left_x = e5.get("default-x")
assert e4.get("default-x") == left_x, (left_x, e4.get("default-x"))
starts = dict(lib._staff_timed_leader_starts(m, ns, "1"))
assert starts[15] == starts[17], (starts.get(15), starts.get(17))
pl = [lib._note_voice_staff(n, ns) for n in notes2 if lib._note_voice_staff(n, ns)[1] == "2"]
assert pl and all(st == "2" for _, st in pl)
print("6cbf m16 E5+E4 link ok")
