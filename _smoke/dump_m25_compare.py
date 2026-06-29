#!/usr/bin/env python3
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
FIXED = "_smoke/reg_check.mxl"


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def dump(path, label):
    root = load(path)
    ns = fix.mxl_ns_uri(root)
    for pi, name in [(2, "T"), (3, "B"), (4, "PR")]:
        part = root.findall(".//" + fix.qname(ns, "part"))[pi]
        for measure, div, exp in fix._iter_measures_with_timing(part, ns):
            if measure.get("number") != "24":
                continue
            print(f"\n=== {label} {name} m24 exp={exp} ===")
            for i, g in enumerate(fix._iter_chord_groups(measure, ns)):
                n = g[0]
                rest = fix._is_rest(n, ns)
                beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
                print(
                    i,
                    fix._note_type_text(n, ns),
                    "d=" + str(fix._note_duration(n, ns)),
                    "rest=" + str(rest),
                    "v=" + g[3],
                    "b=" + str(beams),
                    "x=" + str(n.get("default-x")),
                )


if __name__ == "__main__":
    fix.fix_mxl_file(RAW, FIXED)
    dump(RAW, "RAW")
    dump(FIXED, "FIXED")
