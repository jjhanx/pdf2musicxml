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
        print(f"=== {p.name} m{mnum} all events ===")
        for el in meas:
            tag = el.tag.split("}")[-1]
            if tag == "note":
                pitch = el.find(q("pitch"))
                ptxt = "R"
                if pitch is not None:
                    ptxt = pitch.find(q("step")).text + pitch.find(q("octave")).text
                chord = "+ch" if el.find(q("chord")) is not None else ""
                v = el.find(q("voice")).text
                s = el.find(q("staff")).text
                d = el.find(q("duration")).text
                print(f"  note {ptxt}{chord} s={s} v={v} d={d}")
            elif tag in ("backup", "forward"):
                print(f"  {tag} d={el.find(q('duration')).text}")
