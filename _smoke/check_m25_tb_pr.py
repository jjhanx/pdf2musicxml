#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def dump_part(path, part_idx, mnum, staff=None):
    root = load(path)
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    print(f"\n=== part{part_idx+1} mxl {mnum} ({path}) ===")
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != str(mnum):
            continue
        print(f"div={div} exp={exp}")
        gi = 0
        for g in fix._iter_chord_groups(measure, ns):
            if staff and g[2] != staff:
                continue
            n = g[0]
            beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
            tm = n.find(fix.qname(ns, "time-modification")) is not None
            print(
                f" g{gi:2d} v{g[3]} st{g[2]} x={n.get('default-x','?'):>4} "
                f"{fix._note_type_text(n,ns)} d={fix._note_duration(n,ns)} b={beams}{'T' if tm else ''}"
            )
            gi += 1


if __name__ == "__main__":
    m = "24"
    dump_part(RAW, 2, m)  # T
    dump_part(RAW, 3, m)  # B
    dump_part(RAW, 4, m, "1")  # PR staff1

    fix.fix_mxl_file(RAW, "_smoke/_m25_tb_pr.mxl")
    dump_part("_smoke/_m25_tb_pr.mxl", 2, m)
    dump_part("_smoke/_m25_tb_pr.mxl", 3, m)
    dump_part("_smoke/_m25_tb_pr.mxl", 4, m, "1")
