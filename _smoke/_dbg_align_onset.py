"""Debug m17 play order onset align."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib

ZIP = ROOT / "omr-work-0ea5ea52.zip"
with zipfile.ZipFile(ZIP) as z:
    data = z.read("review.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as inner:
    xml = inner.read(
        [n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0]
    )
root = ET.fromstring(xml)
lib.apply_fixes_to_root(
    root,
    [
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 0, "playOrder": 2, "staff": 1},
        {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 3, "playOrder": 2, "staff": 1},
    ],
)

def local(t):
    return t.tag.split("}")[-1]

part = [p for p in root if local(p) == "part" and p.get("id") == "P5"][0]
m17 = [c for c in part if local(c) == "measure" and c.get("number") == "17"][0]
print("=== staff 1 notes with play order ===")
for i, c in enumerate(m17):
    if local(c) != "note":
        continue
    st = c.find("{http://www.musicxml.org/ns/partwise}staff") or c.find("staff")
    if st is not None and st.text != "1":
        continue
    v = c.find("{http://www.musicxml.org/ns/partwise}voice") or c.find("voice")
    po = c.get("data-hitl-play-order")
    pitch = c.find("{http://www.musicxml.org/ns/partwise}pitch") or c.find("pitch")
    if pitch is not None:
        step = pitch.find("{http://www.musicxml.org/ns/partwise}step") or pitch.find("step")
        oct = pitch.find("{http://www.musicxml.org/ns/partwise}octave") or pitch.find("octave")
        alter = pitch.find("{http://www.musicxml.org/ns/partwise}alter") or pitch.find("alter")
        acc = "b" if alter is not None and alter.text == "-1" else ""
        p = f"{step.text}{acc}{oct.text}"
    else:
        p = "rest"
    chord = c.find("{http://www.musicxml.org/ns/partwise}chord") or c.find("chord")
    print(f"  idx={i} {p} v={v.text if v is not None else '?'} po={po} {'chord' if chord is not None else 'leader'}")
