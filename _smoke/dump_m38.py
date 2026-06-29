import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

p = Path(sys.argv[1])
with zipfile.ZipFile(p) as z:
    xml = z.read([n for n in z.namelist() if n.endswith(".xml")][0])
root = ET.fromstring(xml)
ns_uri = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""


def q(t):
    return f"{{{ns_uri}}}{t}" if ns_uri else t


for part in root.findall(q("part")):
    if part.get("id") != "P5":
        continue
    for meas in part.findall(q("measure")):
        if meas.get("number") != "38":
            continue
        print(f"=== {p.name} m38 ===")
        for el in meas:
            tag = el.tag.split("}")[-1]
            if tag == "note":
                chord = " +chord" if el.find(q("chord")) is not None else ""
                pitch = el.find(q("pitch"))
                if pitch is not None:
                    step = pitch.find(q("step")).text
                    oct_ = pitch.find(q("octave")).text
                    alter = pitch.find(q("alter"))
                    a = alter.text if alter is not None else ""
                    ptxt = f"{step}{a}{oct_}"
                else:
                    ptxt = "R"
                staff = el.find(q("staff"))
                voice = el.find(q("voice"))
                dur = el.find(q("duration"))
                tm = el.find(q("time-modification"))
                print(
                    f"  {ptxt}{chord} s={staff.text if staff is not None else '?'} "
                    f"v={voice.text if voice is not None else '?'} "
                    f"d={dur.text if dur is not None else '?'} tm={'Y' if tm is not None else 'N'}"
                )
            elif tag in ("backup", "forward"):
                dur = el.find(q("duration"))
                print(f"  {tag.upper()} {dur.text if dur is not None else '?'}")
