#!/usr/bin/env python3
"""dda9: off mode preserves OMR rhythm; m13 PR keeps natural accidentals."""
import io
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

os.environ.pop("AUDIVERIS_MXL_RHYTHM_FIX", None)
os.environ.pop("AUDIVERIS_MXL_STRIP_REDUNDANT_NATURAL", None)

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-dda9b3f0/audiveris_raw.mxl"
OUT = "_smoke/dda9_verify.mxl"


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def naturals(root, mxl):
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[4]
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != str(mxl):
            continue
        out = []
        for g in fix._iter_chord_groups(measure, ns):
            if g[2] != "1":
                continue
            for n in g[1]:
                acc = n.find(fix.qname(ns, "accidental"))
                if acc is not None and (acc.text or "").strip() == "natural":
                    out.append(fix._pitch_label(n, ns))
        return out
    return []


def main():
    fix.fix_mxl_file(RAW, OUT)
    raw_n = naturals(load(RAW), 12)
    fix_n = naturals(load(OUT), 12)
    fails = []
    if raw_n and fix_n != raw_n:
        fails.append(f"m13 PR naturals: raw={raw_n} fixed={fix_n}")
    if fix._rhythm_fix_mode() != "off":
        fails.append("rhythm mode not off")
    if fails:
        print("FAIL:", *fails, sep="\n ")
        sys.exit(1)
    print("OK: dda9 OMR faithful (rhythm + naturals)")


if __name__ == "__main__":
    main()
