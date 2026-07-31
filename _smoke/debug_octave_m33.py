#!/usr/bin/env python3
import sys
import zipfile
import re
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from fix_audiveris_mxl import (
    _median_pitch_on_staff_in_measure,
    _median_pitch_on_staff_before,
    _octaves_to_restore_after_f_clef_misread,
    qname,
    mxl_ns_uri,
)

p = Path("_smoke/_6cbf_final/audiveris_raw.mxl")
with zipfile.ZipFile(p) as z:
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.fromstring(z.read(rf))
ns = mxl_ns_uri(root)
for i, part in enumerate(root.findall(qname(ns, "part"))):
    if part.get("id") != "P1":
        continue
    meas = next(m for m in part.findall(qname(ns, "measure")) if m.get("number") == "33")
    cur = _median_pitch_on_staff_in_measure(meas, ns, "1")
    prev = _median_pitch_on_staff_before(part, 33, "1", ns)
    oct = _octaves_to_restore_after_f_clef_misread(part, meas, "1", ns)
    print("P1 m33 cur", cur, "prev", prev, "oct", oct)
