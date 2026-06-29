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
        print(f"=== {p.name} m{mnum} ===")
        for el in meas:
            tag = el.tag.split("}")[-1]
            if tag == "backup":
                d = int(el.find(q("duration")).text)
                pos -= d
                print(f"  BACKUP {d} -> pos={pos}")
            elif tag == "forward":
                d = int(el.find(q("duration")).text)
                pos += d
                print(f"  FORWARD {d} -> pos={pos}")
            elif tag == "note":
                s = el.find(q("staff"))
                v = el.find(q("voice"))
                if s is None or s.text != "2":
                    continue
                chord = el.find(q("chord")) is not None
                d = int(el.find(q("duration")).text)
                pitch = el.find(q("pitch"))
                ptxt = "R"
                if pitch is not None:
                    ptxt = pitch.find(q("step")).text + pitch.find(q("octave")).text
                vo = v.text if v is not None else "?"
                if not chord:
                    print(f"  pos={pos} +{d} {ptxt} v={vo}")
                    pos += d
                else:
                    print(f"  pos={pos} +chord {ptxt} v={vo}")
        print(f"  final pos={pos}")
