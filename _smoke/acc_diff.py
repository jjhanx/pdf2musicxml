#!/usr/bin/env python3
"""Count accidental changes raw->fixed per measure."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


def acc_map(path, pid):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    m = re.match(r"\{(.*)\}", root.tag)
    ns = m.group(1) if m else ""
    q = lambda t: f"{{{ns}}}{t}" if ns else t
    out = {}
    for part in root.findall(q("part")):
        if part.get("id") != pid:
            continue
        for measure in part.findall(q("measure")):
            mnum = measure.get("number")
            notes = []
            for el in measure.findall(q("note")):
                p = el.find(q("pitch"))
                if p is None:
                    continue
                s = p.find(q("step")).text
                o = p.find(q("octave")).text
                a = p.find(q("alter"))
                alt = a.text if a is not None else ""
                acc = el.find(q("accidental"))
                ac = acc.text if acc is not None else ""
                notes.append(f"{s}{alt}{o}:{ac}")
            out[mnum] = notes
    return out


raw, fixed, pid = sys.argv[1], sys.argv[2], sys.argv[3]
r = acc_map(raw, pid)
f = acc_map(fixed, pid)
changed = []
for m in sorted(r.keys(), key=int):
    if r.get(m) != f.get(m):
        changed.append(m)
print(f"P{pid} measures with accidental/pitch changes: {len(changed)}")
if changed:
    print(" ", ", ".join(changed[:30]), ("..." if len(changed) > 30 else ""))
