"""Dump PR m16 staff-1 notes from 6cbf review for parallel link repro."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib

ZIP = ROOT / "omr-work-6cbf1add.zip"
PART_ID = "P4"


def load_mxl(path: Path) -> ET.Element:
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if any(n.endswith(".mxl") for n in names):
            data = z.read([n for n in names if n.endswith(".mxl")][0])
            with zipfile.ZipFile(io.BytesIO(data)) as inner:
                xml_name = [n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0]
                return ET.fromstring(inner.read(xml_name))
        xml_name = [n for n in names if n.endswith(".xml") and "META" not in n.upper()][0]
        return ET.fromstring(z.read(xml_name))


def pitch(n, ns):
    p = n.find(lib._q(ns, "pitch"))
    if p is None:
        return "rest"
    step = p.find(lib._q(ns, "step")).text
    octv = p.find(lib._q(ns, "octave")).text
    alt = p.find(lib._q(ns, "alter"))
    acc = ""
    if alt is not None and alt.text:
        acc = { "-2": "bb", "-1": "b", "1": "#", "2": "##" }.get(alt.text.strip(), alt.text)
    return f"{step}{acc}{octv}"


root = load_mxl(ZIP)
ns = lib._ns(root)
part = lib.find_part(root, ns, PART_ID)
m = lib.find_measure(part, ns, "16")
notes = lib.list_note_elements(m, ns)
print(f"m16 all notes: {len(notes)}")
for i, n in enumerate(notes):
    st = lib._note_voice_staff(n, ns)[1]
    beams = lib._note_beams(n, ns)
    beam = ",".join(beams) if beams else ""
    chord = " chord" if n.find(lib._q(ns, "chord")) is not None else ""
    typ = n.find(lib._q(ns, "type"))
    dur = n.find(lib._q(ns, "duration"))
    print(
        f"  #{i} staff={st} {pitch(n, ns):8}{chord} "
        f"type={typ.text if typ is not None else ''} dur={dur.text if dur is not None else ''} "
        f"x={n.get('default-x', '')} beam={beam}"
    )

pr_notes = [n for n in notes if lib._note_voice_staff(n, ns)[1] == "1"]
print(f"\nPR staff-1 only: {len(pr_notes)} notes")

for a, b in [(10, 11), (15, 16), (16, 17)]:
    if max(a, b) >= len(notes):
        continue
    r = load_mxl(ZIP)
    ns2 = lib._ns(r)
    m2 = lib.find_measure(lib.find_part(r, ns2, PART_ID), ns2, "16")
    before = [pitch(n, ns2) for n in lib.list_note_elements(m2, ns2)]
    lib.apply_fixes_to_root(
        r,
        [{
            "kind": "linkParallelOnsets",
            "partId": PART_ID,
            "measureMxl": "16",
            "staff": 1,
            "parallelNoteIndices": [a, b],
        }],
    )
    notes2 = lib.list_note_elements(m2, ns2)
    print(f"\nAfter link indices [{a},{b}] (UI #{a},#{b}):")
    for i, n in enumerate(notes2):
        st = lib._note_voice_staff(n, ns2)[1]
        if st != "1":
            continue
        if n.find(lib._q(ns2, "chord")) is not None:
            continue
        print(f"  PR #{i} {pitch(n, ns2)} v={lib._note_voice_staff(n, ns2)[0]} beam={lib._note_beams(n, ns2)}")
    starts = lib._staff_timed_leader_starts(m2, ns2, "1")
    by_i = {i: t for i, t in starts}
    if a < len(notes2) and b < len(notes2):
        print(f"  start #{a}={by_i.get(a)} #{b}={by_i.get(b)}")
