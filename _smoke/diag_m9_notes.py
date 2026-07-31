#!/usr/bin/env python3
import io, re, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
sys_path = ROOT / "scripts"
import sys
sys.path.insert(0, str(sys_path))
from inject_ocr import mxl_ns_uri, qname, list_attachable_notes_in_measure

with zipfile.ZipFile(ROOT / "omr-work-f7b18c9d.zip") as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    data = z.read(rf)
root = ET.parse(io.BytesIO(data)).getroot()
ns = mxl_ns_uri(root)

for pi in (1, 2):
    part = root.findall(qname(ns, "part"))[pi - 1]
    for meas in part.findall(qname(ns, "measure")):
        if meas.get("number") != "9":
            continue
        notes = list_attachable_notes_in_measure(meas, ns)
        print(f"P{pi} m9: {len(notes)} notes")
        for i, n in enumerate(notes):
            d = n.find(qname(ns, "duration"))
            print(f"  n{i}: dur={d.text if d is not None else '?'}")
