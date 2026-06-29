#!/usr/bin/env python3
import copy
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import fix_audiveris_mxl as fix  # noqa: E402


def load_part5():
    with zipfile.ZipFile(ROOT / "_smoke/omr-work-6855d546-full/audiveris_raw.mxl") as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        root = ET.fromstring(z.read(m.group(1)))
    ns = fix.mxl_ns_uri(root)
    part = root.findall(f".//{fix.qname(ns, 'part')}")[4]
    return copy.deepcopy(part), ns


def show_m25(part, ns):
    for m, d, e in fix._iter_measures_with_timing(part, ns):
        if m.get("number") != "25":
            continue
        print(f"m25 exp={e}")
        for (staff, voice), groups in fix._voice_groups(m, ns).items():
            if staff != "1":
                continue
            parts = []
            for g in groups:
                t = fix._note_type_text(g[0], ns)
                dot = g[0].find(fix.qname(ns, "dot")) is not None
                d = fix._note_duration(g[0], ns)
                parts.append(f"{t}{'.' if dot else ''}:{d}/n{len(g[1])}")
            print(f"  s{staff} v{voice}: " + " ".join(parts))


part, ns = load_part5()
print("BEFORE dotted repair:")
show_m25(part, ns)
n, r = fix._repair_dotted_quarter_misread(part, ns)
print(f"dotted_fixed={n} rest={r}")
print("AFTER:")
show_m25(part, ns)
