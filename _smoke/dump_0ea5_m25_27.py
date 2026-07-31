"""Dump P1/P5 m25-27 structure from 0ea5 review.mxl"""
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path("청산에 살리라 F/_inspect_0ea5/review.mxl")
with zipfile.ZipFile(mxl) as z:
    xml_name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n)
    root = ET.fromstring(z.read(xml_name))

def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag

def dump_part(pid, mn):
    for p in root.iter():
        if local(p.tag) != "part" or p.get("id") != pid:
            continue
        for m in p:
            if local(m.tag) != "measure" or m.get("number") != str(mn):
                continue
            print(f"\n=== {pid} m{mn} children ===")
            for i, c in enumerate(m):
                tag = local(c.tag)
                if tag == "note":
                    st = c.findtext("staff") or "1"
                    step = c.findtext(".//step") or "rest"
                    octv = c.findtext(".//octave") or ""
                    dur = c.findtext("duration") or "?"
                    print(f"  [{i}] note staff={st} {step}{octv} dur={dur}")
                elif tag in ("backup", "forward"):
                    print(f"  [{i}] {tag} dur={c.findtext('duration')}")
                elif tag == "print":
                    attrs = " ".join(f"{k}={v}" for k, v in c.attrib.items())
                    print(f"  [{i}] print {attrs}")
                elif tag == "attributes":
                    print(f"  [{i}] attributes")
                else:
                    print(f"  [{i}] {tag}")

for mn in (25, 26, 27):
    dump_part("P1", mn)
dump_part("P5", 26)
