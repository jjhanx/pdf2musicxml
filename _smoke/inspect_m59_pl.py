#!/usr/bin/env python3
import xml.etree.ElementTree as ET
from pathlib import Path

p = Path("_smoke/_staff_timeline/6cbf_fixed/clean_score_only.xml")
root = ET.parse(p).getroot()
parts = root.findall(".//{*}part")
print("parts", len(parts))
for pi, part in enumerate(parts):
    pid = part.get("id")
    for m in part.findall("{*}measure"):
        if m.get("number") != "59":
            continue
        notes = [n for n in m if n.tag.endswith("note")]
        if not notes:
            continue
        print("part idx", pi, "id", pid, "note count", len(notes))
        for i, n in enumerate(notes):
            typ_el = n.find("{*}type")
            dur_el = n.find("{*}duration")
            staff_el = n.find("{*}staff")
            typ = (typ_el.text or "") if typ_el is not None else ""
            dur = (dur_el.text or "") if dur_el is not None else ""
            staff = (staff_el.text or "") if staff_el is not None else ""
            pitch = n.find("{*}pitch")
            rest = n.find("{*}rest")
            if pitch is not None:
                nm = pitch.find("{*}step").text + str(pitch.find("{*}octave").text)
            elif rest is not None:
                nm = "rest"
            else:
                nm = "?"
            tm = n.find("{*}time-modification")
            tup = ""
            if tm is not None:
                an = tm.find("{*}actual-notes")
                nn = tm.find("{*}normal-notes")
                nt = tm.find("{*}normal-type")
                tup = f" tm={an.text if an is not None else '?'}:{nn.text if nn is not None else '?'} {nt.text if nt is not None else ''}"
            print(f"  #{i} staff={staff} {typ} dur={dur} {nm}{tup}")
        print()
