#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


def dump(path, mn, staff="2"):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    m = re.match(r"\{(.*)\}", root.tag)
    ns = m.group(1) if m else ""
    q = lambda t: f"{{{ns}}}{t}" if ns else t
    for part in root.findall(q("part")):
        if part.get("id") != "P5":
            continue
        for meas in part.findall(q("measure")):
            if meas.get("number") != mn:
                continue
            items = []
            for n in meas.findall(q("note")):
                st = n.find(q("staff"))
                st = st.text if st is not None else "1"
                if st != staff:
                    continue
                ch = "+" if n.find(q("chord")) is not None else " "
                typ = n.find(q("type"))
                typ = typ.text if typ is not None else "?"
                dur = n.find(q("duration"))
                dur = dur.text if dur is not None else "?"
                tm = "T" if n.find(q("time-modification")) is not None else ""
                bracket = ""
                notations = n.find(q("notations"))
                if notations is not None:
                    t = notations.find(q("tuplet"))
                    if t is not None:
                        bracket = (
                            f"br={t.get('bracket')} sb={t.get('show-bracket')} "
                            f"sn={t.get('show-number')}"
                        )
                p = n.find(q("pitch"))
                if p is None:
                    pitch = "R"
                else:
                    s = p.find(q("step")).text
                    o = p.find(q("octave")).text
                    a = p.find(q("alter"))
                    alt = {"1": "#", "-1": "b"}.get(a.text if a is not None else "", "")
                    pitch = f"{s}{alt}{o}"
                items.append(f"{ch}{pitch}:{typ}{tm}({dur}){bracket}")
            print(path, f"m{mn}s{staff}:", " ".join(items))


path = sys.argv[1]
for mn in sys.argv[2:]:
    dump(path, mn)
