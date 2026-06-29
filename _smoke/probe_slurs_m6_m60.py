#!/usr/bin/env python3
"""Probe slurs on m6/m30 (printed 7/31 PR) and m59 (printed 60?)."""
import importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

def load(path):
    z = zipfile.ZipFile(path)
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    return ET.parse(io.BytesIO(z.read(rf))).getroot()

def dump_slurs(root, measures=("6", "30", "59", "60")):
    ns = fix.mxl_ns_uri(root)
    part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
    for mno in measures:
        for m in part.findall(fix.qname(ns, "measure")):
            if m.get("number") != mno:
                continue
            print(f"\n=== XML m{mno} (printed ~{int(mno)+1}) staff1 slurs ===")
            for note in m.findall(fix.qname(ns, "note")):
                st = note.find(fix.qname(ns, "staff"))
                if st is not None and st.text != "1":
                    continue
                pitch = note.find(fix.qname(ns, "pitch"))
                if pitch is None:
                    continue
                lab = pitch.find(fix.qname(ns, "step")).text + pitch.find(fix.qname(ns, "octave")).text
                ch = note.find(fix.qname(ns, "chord")) is not None
                if ch:
                    continue
                slurs = []
                for n in note.findall(fix.qname(ns, "notations")):
                    for s in n.findall(fix.qname(ns, "slur")):
                        slurs.append({
                            "num": s.get("number"),
                            "type": s.get("type"),
                            "plc": s.get("placement"),
                            "dy": s.get("default-y"),
                            "orient": s.get("orientation"),
                        })
                if slurs:
                    print(f"  {lab}: {slurs}")

for job in ["omr-work-6855d546-full", "omr-work-a26ecec0-full", "omr-work-d08a7450-full"]:
    raw = Path(f"_smoke/{job}/audiveris_raw.mxl")
    if not raw.is_file():
        continue
    print(f"\n######## {job} RAW ########")
    dump_slurs(load(raw))
    fixed = Path(f"_smoke/{job}/audiveris_raw.mxl")
    # run fix in memory
    import tempfile, os, shutil
    fd, tmp = tempfile.mkstemp(suffix=".mxl")
    os.close(fd)
    try:
        fix.fix_mxl_file(raw, tmp)
        print(f"\n######## {job} FIXED ########")
        dump_slurs(load(tmp))
    finally:
        os.unlink(tmp)
