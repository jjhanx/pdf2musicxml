"""Dump m16 timeline elements and after preview merge."""
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
    if p is None:
        return "rest"
    s = p.find(lib._q(ns, "step")).text
    o = p.find(lib._q(ns, "octave")).text
    a = p.find(lib._q(ns, "alter"))
    acc = "b" if a is not None and a.text == "-1" else ""
    ch = "*" if n.find(lib._q(ns, "chord")) is not None else ""
    return f"{s}{acc}{o}{ch}"


root = load()
ns = lib._ns(root)
m = lib.find_measure(lib.find_part(root, ns, "P5"), ns, "16")
print("=== raw timeline (staff 1 notes + fwd/bak) ===")
for el in m:
    tag = el.tag.split("}")[-1]
    if tag == "note":
        n = el
        st = lib._note_voice_staff(n, ns)[1]
        if st != "1":
            continue
        typ = n.find(lib._q(ns, "type"))
        beams = lib._note_beams(n, ns)
        print(f"  note {pitch(n, ns)} type={typ.text if typ is not None else ''} beam={beams}")
    elif tag in ("forward", "backup"):
        v = el.find(lib._q(ns, "voice"))
        d = el.find(lib._q(ns, "duration"))
        print(f"  {tag} v={v.text if v is not None else ''} d={d.text if d is not None else ''}")

# apply link like user might: F4 Bb4 D5 + E5 from m17 pattern - or check if fixes exist
root2 = load()
lib.apply_fixes_to_root(root2, [{
    "kind": "linkParallelOnsets",
    "partId": "P5",
    "measureMxl": "16",
    "staff": 1,
    "parallelNoteIndices": [0, 1, 2, 3],
}])
m2 = lib.find_measure(lib.find_part(root2, lib._ns(root2), "P5"), lib._ns(root2), "16")
print("\n=== after link [0,1,2,3] ===")
for el in m2:
    tag = el.tag.split("}")[-1]
    if tag == "note":
        n = el
        if lib._note_voice_staff(n, lib._ns(root2))[1] != "1":
            continue
        typ = n.find(lib._q(lib._ns(root2), "type"))
        beams = lib._note_beams(n, lib._ns(root2))
        print(f"  note {pitch(n, lib._ns(root2))} type={typ.text if typ is not None else ''} beam={beams}")
    elif tag in ("forward", "backup"):
        v = el.find(lib._q(lib._ns(root2), "voice"))
        d = el.find(lib._q(lib._ns(root2), "duration"))
        print(f"  {tag} v={v.text if v is not None else ''} d={d.text if d is not None else ''}")
