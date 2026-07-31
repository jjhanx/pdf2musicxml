"""Dump m17 PR note onsets and types after play order apply."""
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

def pitch(n):
    p = n.find("{http://www.musicxml.org/ns/partwise}pitch") or n.find("pitch")
    if p is None:
        return "rest"
    step = (p.find("{http://www.musicxml.org/ns/partwise}step") or p.find("step")).text
    oct = (p.find("{http://www.musicxml.org/ns/partwise}octave") or p.find("octave")).text
    alter = p.find("{http://www.musicxml.org/ns/partwise}alter") or p.find("alter")
    acc = "b" if alter is not None and alter.text == "-1" else ""
    return f"{step}{acc}{oct}"

part = [p for p in root if local(p) == "part" and p.get("id") == "P5"][0]
m17 = [c for c in part if local(c) == "measure" and c.get("number") == "17"][0]

# voice cursor onset
voice_cursor = {}
last_v = "1"
for el in m17:
    tag = local(el)
    if tag == "forward":
        v = (el.find("{http://www.musicxml.org/ns/partwise}voice") or el.find("voice"))
        v = v.text if v is not None else last_v
        dur = int((el.find("{http://www.musicxml.org/ns/partwise}duration") or el.find("duration")).text)
        voice_cursor[v] = voice_cursor.get(v, 0) + dur
    elif tag == "backup":
        v = (el.find("{http://www.musicxml.org/ns/partwise}voice") or el.find("voice"))
        v = v.text if v is not None else last_v
        dur = int((el.find("{http://www.musicxml.org/ns/partwise}duration") or el.find("duration")).text)
        voice_cursor[v] = max(0, voice_cursor.get(v, 0) - dur)
    elif tag == "note":
        st = el.find("{http://www.musicxml.org/ns/partwise}staff") or el.find("staff")
        if st is not None and st.text != "1":
            continue
        if el.find("{http://www.musicxml.org/ns/partwise}chord") or el.find("chord"):
            continue
        v = (el.find("{http://www.musicxml.org/ns/partwise}voice") or el.find("voice")).text
        last_v = v
        onset = voice_cursor.get(v, 0)
        typ = (el.find("{http://www.musicxml.org/ns/partwise}type") or el.find("type"))
        typ = typ.text if typ is not None else "?"
        dur = (el.find("{http://www.musicxml.org/ns/partwise}duration") or el.find("duration")).text
        po = el.get("data-hitl-play-order")
        beam = el.find("{http://www.musicxml.org/ns/partwise}beam") or el.find("beam")
        b = beam.text if beam is not None else ""
        print(f"{pitch(el):4} v={v} onset={onset} dur={dur} type={typ:7} po={po} beam={b}")
        voice_cursor[v] = onset + int(dur)
