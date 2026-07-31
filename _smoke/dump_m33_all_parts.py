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

for pi, part in enumerate(root.findall(q("part"))):
    for meas in part.findall(q("measure")):
        if meas.get("number") != "33":
            continue
        print(f"=== {part.get('id')} m33 ===")
        for el in meas:
            t = lt(el)
            if t == "attributes":
                for c in el:
                    ct = lt(c)
                    if ct == "clef":
                        sign = c.find(q("sign"))
                        print("  clef", sign.text if sign is not None else "?")
                    elif ct == "key":
                        f = c.find(q("fifths"))
                        print("  key", f.text if f is not None else "?")
            elif t == "note":
                rest = el.find(q("rest"))
                typ = el.find(q("type"))
                if rest is not None:
                    ds = rest.find(q("display-step"))
                    print("  rest", typ.text if typ is not None else "?", "disp", ds.text if ds is not None else "")
                else:
                    pitch = el.find(q("pitch"))
                    print("  note", pitch.find(q("step")).text + pitch.find(q("octave")).text, typ.text if typ is not None else "")
