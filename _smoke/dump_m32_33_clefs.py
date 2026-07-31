#!/usr/bin/env python3
import io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "_smoke" / "_6cbf_final" / "audiveris_raw.mxl"

with zipfile.ZipFile(RAW) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.fromstring(z.read(rf))
ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""
q = lambda t: f"{{{ns}}}{t}" if ns else t
lt = lambda el: el.tag.split("}")[-1]

for mn in ["32", "33"]:
    print(f"\n==== measure {mn} ====")
    for part in root.findall(q("part")):
        pid = part.get("id")
        meas = next((m for m in part.findall(q("measure")) if m.get("number") == mn), None)
        if meas is None:
            continue
        attrs = []
        for el in meas:
            if lt(el) == "attributes":
                for c in el:
                    ct = lt(c)
                    if ct == "clef":
                        sign = c.find(q("sign"))
                        attrs.append(f"clef={sign.text if sign is not None else '?'}")
                    elif ct == "key":
                        f = c.find(q("fifths"))
                        attrs.append(f"key={f.text if f is not None else '?'}")
        if attrs:
            print(f"  {pid}: " + ", ".join(attrs))

# count half/whole rests with display-step
from collections import Counter
c = Counter()
for note in root.iter():
    if lt(note) != "note":
        continue
    rest = note.find(q("rest"))
    if rest is None:
        continue
    typ = note.find(q("type"))
    tval = typ.text if typ is not None else "?"
    ds = rest.find(q("display-step"))
    if ds is not None and ds.text:
        c[f"{tval}:{ds.text.strip()}"] += 1
print("\nrest display-step counts:", dict(c))
