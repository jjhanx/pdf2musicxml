"""Dump P5 m16 PR staff-1 notes from 0ea5."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib

ZIP = ROOT / "omr-work-0ea5ea52.zip"


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
    ch = " chord" if n.find(lib._q(ns, "chord")) is not None else ""
    return f"{s}{acc}{o}{ch}"


root = load()
ns = lib._ns(root)
m = lib.find_measure(lib.find_part(root, ns, "P5"), ns, "16")
notes = lib.list_note_elements(m, ns)
print("m16 P5 all notes:")
for i, n in enumerate(notes):
    v, st = lib._note_voice_staff(n, ns)
    typ = n.find(lib._q(ns, "type"))
    dur = n.find(lib._q(ns, "duration"))
    beams = lib._note_beams(n, ns)
    stem = n.find(lib._q(ns, "stem"))
    print(
        f"  #{i} staff={st} v={v} {pitch(n, ns):8} "
        f"type={typ.text if typ is not None else ''} dur={dur.text if dur is not None else ''} "
        f"stem={stem.text if stem is not None else ''} beam={beams} x={n.get('default-x','')}"
    )

starts = dict(lib._staff_timed_leader_starts(m, ns, "1"))
print("\nPR leader starts:", {i: starts.get(i) for i in range(min(15, len(notes))) if lib._note_voice_staff(notes[i], ns)[1] == "1" and notes[i].find(lib._q(ns, "chord")) is None})
