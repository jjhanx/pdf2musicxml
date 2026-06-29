#!/usr/bin/env python3
"""Dump m6/m30 staff1 (printed 7/31 PR) and m44 staff1/2 (printed 45 PR/PL)."""
import importlib.util, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

def dump_mxl(path, label):
    z = zipfile.ZipFile(path)
    c = z.read("META-INF/container.xml").decode()
    rf = re.search(r'full-path="([^"]+)"', c).group(1)
    root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    ns = fix.mxl_ns_uri(root)
    part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
    for xml_m in ("6", "30", "44"):
        for measure, div, exp in fix._iter_measures_with_timing(part, ns):
            if measure.get("number") != xml_m:
                continue
            print(f"\n=== {label} XML m{xml_m} div={div} exp={exp} ===")
            for staff in ("1", "2"):
                print(f"  staff{staff}:")
                for (st, voice), groups in fix._voice_groups(measure, ns).items():
                    if st != staff:
                        continue
                    total = sum(fix._note_duration(g[0], ns) or 0 for g in groups)
                    print(f"    voice {voice} groups={len(groups)} total={total}")
                    for i, g in enumerate(groups):
                        sig = fix._chord_pitch_signature(g, ns)
                        typ = fix._note_type_text(g[0], ns)
                        dur = fix._note_duration(g[0], ns)
                        stem = fix._stem_from_note(g[0], ns)
                        slurs = []
                        for n in g[1]:
                            for notations in n.findall(fix.qname(ns, "notations")):
                                for s in notations.findall(fix.qname(ns, "slur")):
                                    slurs.append((s.get("number"), s.get("type"), s.get("placement"), s.get("orientation"), s.get("{http://www.w3.org/XML/1998/namespace}default-y") or s.get("default-y")))
                        print(f"      g{i}: {sig} {typ} dur={dur} stem={stem} slurs={slurs}")

raw = Path("_smoke/omr-work-6855d546-full/audiveris_raw.mxl")
fixed = Path("_smoke/omr-work-6855d546-full/test_fixed.mxl")
if raw.is_file():
    dump_mxl(raw, "RAW")
if fixed.is_file():
    dump_mxl(fixed, "FIXED")
