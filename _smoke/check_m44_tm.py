#!/usr/bin/env python3
import io, re, sys, zipfile, xml.etree.ElementTree as ET

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

def q(ns, t):
    return f"{{{ns}}}{t}"

path = sys.argv[1]
root = load(path)
m = re.match(r"\{(.*)\}", root.tag)
ns = m.group(1) if m else ""
for part in root.findall(q(ns, "part")):
    if part.get("id") != "P5":
        continue
    for measure in part.findall(q(ns, "measure")):
        if measure.get("number") != "44":
            continue
        groups = []
        cur = None
        for child in measure:
            tag = child.tag.split("}")[-1]
            if tag != "note":
                continue
            if child.find(q(ns, "chord")) is not None and cur:
                cur.append(child)
                continue
            cur = [child]
            groups.append(cur)
        print(f"{path}: {len(groups)} chord groups, total dur", sum(int(g[0].find(q(ns, "duration")).text) for g in groups))
        for i, g in enumerate(groups, 1):
            n = g[0]
            tm = n.find(q(ns, "time-modification"))
            tm_s = ""
            if tm is not None:
                parts = []
                for tag in ("actual-notes", "normal-notes", "normal-type"):
                    el = tm.find(q(ns, tag))
                    if el is not None:
                        parts.append(f"{tag}={el.text}")
                tm_s = " [" + " ".join(parts) + "]"
            print(f"  {i}: type={n.find(q(ns, 'type')).text} dur={n.find(q(ns, 'duration')).text}{tm_s}")
