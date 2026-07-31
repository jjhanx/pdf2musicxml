#!/usr/bin/env python3
import re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

for label, mxl in [
    ("raw", Path("_smoke/_6cbf_final/audiveris_raw.mxl")),
    ("fixed", Path("_smoke/6cbf_full_fixed.mxl")),
]:
    with zipfile.ZipFile(mxl) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.fromstring(z.read(rf))
    ns = root.tag.split("}")[0].strip("{") if "}" in root.tag else ""
    q = lambda t: f"{{{ns}}}{t}"
    lt = lambda el: el.tag.split("}")[-1]
    print(f"\n======== {label} ========")
    for mn in ["4", "18", "32", "33", "34"]:
        print(f"--- m{mn} ---")
        for part in root.findall(q("part")):
            pid = part.get("id")
            meas = next((m for m in part.findall(q("measure")) if m.get("number") == mn), None)
            if meas is None:
                continue
            bits = []
            for el in meas:
                if lt(el) != "attributes":
                    continue
                for c in el:
                    ct = lt(c)
                    if ct == "clef":
                        sign = c.find(q("sign"))
                        bits.append(f"clef={sign.text if sign is not None else '?'}")
                    elif ct == "key":
                        f = c.find(q("fifths"))
                        bits.append(f"key={f.text if f is not None else '?'}")
            notes = []
            for el in meas:
                if lt(el) != "note":
                    continue
                rest = el.find(q("rest"))
                if rest is not None:
                    continue
                pitch = el.find(q("pitch"))
                if pitch is not None:
                    notes.append(pitch.find(q("step")).text + pitch.find(q("octave")).text)
            if bits or (pid == "P4" and mn in ("4", "18")) or (pid == "P1" and mn == "33"):
                print(f"  {pid}", " ".join(bits), "notes:", notes[:6])
