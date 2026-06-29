#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

path = sys.argv[1]
mn = sys.argv[2]
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
    for measure in part.findall(q("measure")):
        if measure.get("number") != mn:
            continue
        div = beats = bt = None
        for attr in measure.findall(q("attributes")):
            d = attr.find(q("divisions"))
            if d is not None and d.text:
                div = int(d.text)
            t = attr.find(q("time"))
            if t is not None:
                beats = int(t.find(q("beats")).text)
                bt = int(t.find(q("beat-type")).text)
        exp = div * beats * 4 // bt if div and beats and bt else None
        print(f"divisions={div} expected={exp}")
        by_voice = {}
        for n in measure.findall(q("note")):
            if n.find(q("chord")) is not None:
                continue
            st = n.find(q("staff"))
            st = st.text if st is not None else "1"
            if st != "2":
                continue
            v = n.find(q("voice"))
            v = v.text if v is not None else "1"
            dur = n.find(q("duration"))
            dur = int(dur.text) if dur is not None and dur.text else 0
            typ = n.find(q("type"))
            typ = typ.text if typ is not None else "?"
            rest = n.find(q("rest")) is not None
            pitch = "R" if rest else "N"
            if not rest:
                p = n.find(q("pitch"))
                pitch = p.find(q("step")).text + p.find(q("octave")).text
            by_voice.setdefault(v, []).append((pitch, typ, dur))
        for v, items in sorted(by_voice.items()):
            total = sum(x[2] for x in items)
            print(f" voice {v} total={total}/{exp}: {items}")
