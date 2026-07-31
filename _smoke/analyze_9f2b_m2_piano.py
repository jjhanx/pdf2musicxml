#!/usr/bin/env python3
"""Analyze piano m2 note timeline in omr-work-9f2b6020."""
import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ZIP = Path(r"D:/pdf2musicxml/omr-work-9f2b6020.zip")

with zipfile.ZipFile(ZIP) as z:
    data = z.read("audiveris_raw.mxl")

with zipfile.ZipFile(io.BytesIO(data)) as z:
    xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])

root = ET.fromstring(xml)

def local(t):
    return t.split("}")[-1]

# part list
for sp in root.findall(".//{*}part-list/{*}score-part"):
    print(sp.get("id"), (sp.find("{*}part-name") or sp.find(".//{*}part-name")))
    if sp.find("{*}part-name") is not None:
        print(" ", sp.find("{*}part-name").text)

parts = [p for p in root if local(p.tag) == "part"]
print("parts", [p.get("id") for p in parts])

# find piano part (2 staves)
for part in parts:
    pid = part.get("id")
    max_staff = 1
    for el in part.iter():
        if local(el.tag) == "staves" and el.text:
            max_staff = max(max_staff, int(el.text))
        if local(el.tag) == "staff" and el.text:
            max_staff = max(max_staff, int(el.text))
    if max_staff >= 2:
        print("piano-like", pid, "staves", max_staff)
        for mn in (1, 2):
            meas = next(m for m in part if local(m.tag) == "measure" and int(m.get("number") or 0) == mn)
            print(f"\n=== {pid} m{mn} ===")
            t = 0
            idx = 0
            for child in meas:
                tag = local(child.tag)
                if tag == "attributes":
                    div = child.find("{*}divisions")
                    if div is not None:
                        print(" divisions", div.text)
                if tag == "backup":
                    d = child.find("{*}duration")
                    dur = int(d.text) if d is not None and d.text else 0
                    t -= dur
                    print(f"  backup dur={dur} t->{t}")
                elif tag == "forward":
                    d = child.find("{*}duration")
                    dur = int(d.text) if d is not None and d.text else 0
                    t += dur
                    print(f"  forward dur={dur} t->{t}")
                elif tag == "note":
                    idx += 1
                    d = child.find("{*}duration")
                    dur = int(d.text) if d is not None and d.text else 0
                    staff = child.find("{*}staff")
                    sn = staff.text if staff is not None else "1"
                    voice = child.find("{*}voice")
                    vn = voice.text if voice is not None else "1"
                    chord = child.find("{*}chord") is not None
                    rest = child.find("{*}rest") is not None
                    pitch = child.find("{*}pitch")
                    pname = "rest" if rest else "?"
                    if pitch is not None:
                        step = pitch.find("{*}step")
                        oct = pitch.find("{*}octave")
                        alter = pitch.find("{*}alter")
                        a = alter.text if alter is not None else ""
                        pname = f"{step.text if step is not None else '?'}{a}{oct.text if oct is not None else '?'}"
                    dx = child.get("default-x", "")
                    if not chord:
                        print(f"  #{idx} t={t} staff={sn} v={vn} dur={dur} dx={dx} {pname}")
                        t += dur
                    else:
                        print(f"  #{idx} t={t} staff={sn} v={vn} CHORD dur={dur} dx={dx} {pname}")
