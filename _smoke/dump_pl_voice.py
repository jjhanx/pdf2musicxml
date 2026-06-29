#!/usr/bin/env python3
import io, re, zipfile, xml.etree.ElementTree as ET
import sys
sys.path.insert(0, "scripts")
from fix_audiveris_mxl import (
    _voice_groups, _note_duration, _note_type_text, _stem_from_note, _pitch_label, qname
)

def load(p):
    with zipfile.ZipFile(p) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        root = ET.parse(io.BytesIO(z.read(rf))).getroot()
    ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
    return root, ns

for mn in (42, 43, 44):
    for label, p in [
        ("raw", "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"),
        ("fix", "_smoke/omr-work-6855d546-full/test_fixed.mxl"),
    ]:
        root, ns = load(p)
        part = [x for x in root.findall(f"{{{ns}}}part") if x.get("id") == "P5"][0]
        m = part.find(f".//{{{ns}}}measure[@number='{mn}']")
        print(f"--- {label} m{mn} staff2 ---")
        for key, groups in _voice_groups(m, ns).items():
            staff, vo = key
            if staff != "2":
                continue
            total = sum(_note_duration(g[0], ns) or 0 for g in groups)
            print(f" voice {vo} total={total} groups={len(groups)}")
            for i, g in enumerate(groups[:8]):
                l = g[0]
                pitches = sorted({_pitch_label(n, ns) for n in g[1] if _pitch_label(n, ns)})
                tm = "T" if l.find(qname(ns, "time-modification")) is not None else ""
                print(
                    f"  g{i+1} {pitches} {_note_type_text(l, ns)}{tm} "
                    f"dur={_note_duration(l, ns)} stem={_stem_from_note(l, ns)}"
                )
