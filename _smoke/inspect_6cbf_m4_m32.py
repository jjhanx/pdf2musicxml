#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
zpath = ROOT / "너에게 난 나에게 넌" / "omr-work-6cbf1add.zip"
if not zpath.exists():
    zpath = ROOT / "omr-work-0a5a7d84.zip"

with zipfile.ZipFile(zpath) as z:
    mxl = next(n for n in z.namelist() if n.endswith("review.mxl") or (n.endswith(".mxl") and "review" in n))
    data = z.read(mxl)
    if mxl.endswith(".mxl"):
        with zipfile.ZipFile(io.BytesIO(data)) as mz:
            c = mz.read("META-INF/container.xml").decode()
            rf = re.search(r'full-path="([^"]+)"', c).group(1)
            xml = mz.read(rf)
    else:
        xml = data

root = ET.fromstring(xml)
ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""


def q(t):
    return f"{{{ns}}}{t}" if ns else t


def dump_part(part_idx, mnums):
    parts = root.findall(q("part"))
    p = parts[part_idx]
    print(f"=== part {p.get('id')} idx {part_idx} ===")
    for meas in p.findall(q("measure")):
        m = meas.get("number")
        if m not in mnums:
            continue
        print(f" m{m}:")
        for el in meas:
            tag = el.tag.split("}")[-1]
            if tag == "attributes":
                bits = []
                for c in el:
                    ct = c.tag.split("}")[-1]
                    if ct == "clef":
                        sign = c.find(q("sign"))
                        line = c.find(q("line"))
                        bits.append(
                            f"clef#{c.get('number') or '1'}:{sign.text if sign is not None else '?'}"
                            + (f"L{line.text}" if line is not None else "")
                        )
                    elif ct == "key":
                        f = c.find(q("fifths"))
                        bits.append(f"key:{f.text if f is not None else '?'}")
                    elif ct == "time":
                        bits.append("time")
                    elif ct == "staves":
                        bits.append(f"staves={c.text}")
                if bits:
                    print("   ATTR", " ".join(bits))
            elif tag == "note":
                rest = el.find(q("rest"))
                typ = el.find(q("type"))
                dur = el.find(q("duration"))
                voice = el.find(q("voice"))
                staff = el.find(q("staff"))
                if rest is not None:
                    print(
                        "   rest",
                        typ.text if typ is not None else "?",
                        "dur",
                        dur.text if dur is not None else "?",
                        "v",
                        voice.text if voice is not None else "",
                        "st",
                        staff.text if staff is not None else "",
                    )
                else:
                    pitch = el.find(q("pitch"))
                    step = pitch.find(q("step")).text
                    octv = pitch.find(q("octave")).text
                    chord = el.find(q("chord"))
                    print(
                        "   note",
                        step + octv,
                        typ.text if typ is not None else "?",
                        "dur",
                        dur.text if dur is not None else "?",
                        "v",
                        voice.text if voice is not None else "",
                        "st",
                        staff.text if staff is not None else "",
                        "chord" if chord is not None else "",
                    )
            elif tag in ("backup", "forward"):
                dur = el.find(q("duration"))
                voice = el.find(q("voice"))
                print(f"   {tag}", dur.text if dur is not None else "?", "v", voice.text if voice is not None else "")


parts = root.findall(q("part"))
for i, p in enumerate(parts):
    print(i, p.get("id"), "measures", len(p.findall(q("measure"))))

for i, p in enumerate(parts):
    dump_part(i, ["4", "32", "33"])
