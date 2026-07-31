#!/usr/bin/env python3
import zipfile, xml.etree.ElementTree as ET
from pathlib import Path

p = Path("_smoke/_a760/audiveris_raw.mxl")
with zipfile.ZipFile(p) as z:
    name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
    root = ET.fromstring(z.read(name))
ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""
q = lambda t: f"{{{ns}}}{t}"
lt = lambda el: el.tag.split("}")[-1]

part = next(p for p in root.findall(q("part")) if p.get("id") == "P4")
for mn in ["32", "33", "34"]:
    meas = next(m for m in part.findall(q("measure")) if m.get("number") == mn)
    print(f"\n=== P4 m{mn} ===")
    for el in meas:
        t = lt(el)
        if t == "attributes":
            for c in el:
                print(" ", ET.tostring(c, encoding="unicode").strip()[:120])
        elif t == "note":
            rest = el.find(q("rest"))
            staff = el.find(q("staff"))
            st = staff.text if staff is not None else "1"
            if rest is not None:
                print(f"  rest staff={st}")
            else:
                pitch = el.find(q("pitch"))
                if pitch is not None:
                    print(f"  {pitch.find(q('step')).text}{pitch.find(q('octave')).text} staff={st}")

# clef before m33 for P4 staff 1 and 2
def clef_before(part, mnum, staff_n):
    sign = "G"
    for meas in part.findall(q("measure")):
        mn = int(meas.get("number") or 0)
        if mn >= mnum:
            break
        for attr in meas.findall(q("attributes")):
            for clef in attr.findall(q("clef")):
                num = clef.get("number")
                sn = int(num) if num and num.isdigit() else 1
                if sn == staff_n:
                    s = clef.find(q("sign"))
                    if s is not None:
                        sign = s.text
    return sign

print("\nclef before m33 P4 staff1", clef_before(part, 33, 1))
print("clef before m33 P4 staff2", clef_before(part, 33, 2))
