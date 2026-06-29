#!/usr/bin/env python3
import io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path
import importlib.util
spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

path = Path("_smoke/omr-work-6855d546-full/audiveris_raw.mxl")
z = zipfile.ZipFile(path)
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = fix.mxl_ns_uri(root)
part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
for measure, div, exp in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "44":
        continue
    print(f"div={div} exp={exp}")
    for note in measure.findall(fix.qname(ns, "note")):
        staff = note.find(f"{fix.qname(ns,'staff')}")
        if staff is not None and staff.text != "2":
            continue
        if note.find(fix.qname(ns, "rest")) is not None:
            continue
        pitch = note.find(fix.qname(ns, "pitch"))
        step = pitch.find(fix.qname(ns, "step")).text
        octv = pitch.find(fix.qname(ns, "octave")).text
        alt = pitch.find(fix.qname(ns, "alter"))
        acc = alt.text if alt is not None else ""
        dur = note.find(fix.qname(ns, "duration")).text
        typ = note.find(f".//{fix.qname(ns,'type')}")
        typ = typ.text if typ is not None else "?"
        stem = note.find(fix.qname(ns, "stem"))
        stem = stem.text if stem is not None else "?"
        chord = note.find(fix.qname(ns, "chord")) is not None
        tm = note.find(fix.qname(ns, "time-modification")) is not None
        print(f"  {step}{octv}{'#' if acc=='1' else 'b' if acc=='-1' else ''} dur={dur} type={typ} stem={stem} chord={chord} tm={tm}")
