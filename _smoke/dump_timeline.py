import sys
import zipfile
import xml.etree.ElementTree as ET
import re
from pathlib import Path

p = Path(sys.argv[1])
mnum = sys.argv[2]
with zipfile.ZipFile(p) as z:
    xml = z.read([n for n in z.namelist() if n.endswith(".xml")][0])
root = ET.fromstring(xml)
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""


def q(t):
    return f"{{{ns}}}{t}" if ns else t


for part in root.findall(q("part")):
    if part.get("id") != "P5":
        continue
    for meas in part.findall(q("measure")):
        if meas.get("number") != mnum:
            continue
        pos = 0
        print(f"=== {p.name} m{mnum} staff2 v5 timeline ===")
        for el in meas:
            tag = el.tag.split("}")[-1]
            if tag == "backup":
                pos -= int(el.find(q("duration")).text)
                print(f"  BACKUP -> pos={pos}")
            elif tag == "forward":
                pos += int(el.find(q("duration")).text)
                print(f"  FORWARD -> pos={pos}")
            elif tag == "note":
                v_el = el.find(q("voice"))
                s_el = el.find(q("staff"))
                v = v_el.text if v_el is not None else "?"
                s = s_el.text if s_el is not None else "?"
                d = int(el.find(q("duration")).text)
                chord = el.find(q("chord")) is not None
                pitch = el.find(q("pitch"))
                if pitch is not None:
                    ptxt = pitch.find(q("step")).text + pitch.find(q("octave")).text
                else:
                    ptxt = "R"
                if s == "2" and v == "5":
                    if not chord:
                        print(f"  pos={pos} +{d} {ptxt}")
                        pos += d
                    else:
                        print(f"  pos={pos} +chord {ptxt}")
        print(f"  final pos={pos} (expected 24 for 4/4 div6)")
