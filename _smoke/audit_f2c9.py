#!/usr/bin/env python3
"""Compare raw vs fixed vs review for f2c9d2c6 reported measures."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-f2c9d2c6/audiveris_raw.mxl"
REV = "_smoke/omr-work-f2c9d2c6/review.mxl"
OUT = "_smoke/f2c9_fixed.mxl"

CASES = [
    (2, "PR", 4, "1", "m3 PR"),
    (18, "S", 1, None, "m19 S"),
    (18, "A", 2, None, "m19 A"),
    (18, "T", 3, None, "m19 T"),
    (18, "B", 4, None, "m19 B"),
    (24, "S", 1, None, "m25 S"),
    (24, "A", 2, None, "m25 A"),
    (24, "T", 3, None, "m25 T"),
    (24, "B", 4, None, "m25 B"),
    (24, "PR", 4, "1", "m25 PR"),
    (24, "PL", 4, "2", "m25 PL"),
    (41, "S", 1, None, "m42 S"),
    (41, "A", 2, None, "m42 A"),
    (41, "T", 3, None, "m42 T"),
    (41, "B", 4, None, "m42 B"),
    (41, "PR", 4, "1", "m42 PR"),
    (41, "PL", 4, "2", "m42 PL"),
    (44, "PR", 4, "1", "m45 PR"),
    (44, "PL", 4, "2", "m45 PL"),
]


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def dump_groups(root, part_idx, mnum, staff=None, label=""):
    ns = fix.mxl_ns_uri(root)
    part = root.findall(".//" + fix.qname(ns, "part"))[part_idx]
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != str(mnum):
            continue
        print(f"\n--- {label} mxl{mnum} exp={exp} ---")
        gi = 0
        for g in fix._iter_chord_groups(measure, ns):
            if staff and g[2] != staff:
                continue
            n = g[0]
            if fix._is_rest(n, ns):
                p = "R-" + (fix._note_type_text(n, ns) or "?")
            elif len(g[1]) > 1:
                p = "+".join(sorted(fix._pitch_label(x, ns) or "?" for x in g[1]))
            else:
                p = fix._pitch_label(n, ns) or "?"
            tm = n.find(fix.qname(ns, "time-modification")) is not None
            tup = ""
            if tm:
                notations = n.find(fix.qname(ns, "notations"))
                if notations is not None and notations.find(fix.qname(ns, "tuplet")) is not None:
                    tup = " T3"
            beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
            stem = n.find(fix.qname(ns, "stem"))
            st = stem.text if stem is not None else "?"
            t = fix._note_type_text(n, ns) or "?"
            d = fix._note_duration(n, ns)
            ds = d if d is not None else 0
            print(
                f" g{gi:2d} v{g[3]} {t:8s} d={ds:2d} stem={st:4s} "
                f"{p:16s}{tup} b={beams} x={n.get('default-x','?')}"
            )
            gi += 1


def main():
    import subprocess
    subprocess.run(
        [sys.executable, "scripts/fix_audiveris_mxl.py", RAW, OUT],
        check=True,
    )
    for path, tag in [(RAW, "RAW"), (OUT, "FIX"), (REV, "REV")]:
        root = load(path)
        print(f"\n======== {tag} ========")
        for mnum, _p, pidx, staff, label in CASES:
            dump_groups(root, pidx, mnum, staff, f"{tag} {label}")


if __name__ == "__main__":
    main()
