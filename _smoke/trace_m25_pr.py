#!/usr/bin/env python3
import copy
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import fix_audiveris_mxl as fix  # noqa: E402


def load_mxl(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        root = ET.fromstring(z.read(m.group(1)))
    return root, fix.mxl_ns_uri(root)


def group_summary(measure, ns):
    lines = []
    for (staff, voice), groups in fix._voice_groups(measure, ns).items():
        parts = []
        for g in groups:
            d = fix._note_duration(g[0], ns)
            t = fix._note_type_text(g[0], ns)
            dot = g[0].find(fix.qname(ns, "dot")) is not None
            tm = g[0].find(fix.qname(ns, "time-modification")) is not None
            nch = len(g[1])
            parts.append(f"{t}{'.' if dot else ''}{'T' if tm else ''}:{d}/n{nch}")
        lines.append(f"  s{staff} v{voice}: " + " ".join(parts))
    return lines


def trace_part(part_idx, mnum="25"):
    root, ns = load_mxl(ROOT / "_smoke/omr-work-6855d546-full/audiveris_raw.mxl")
    part = root.findall(f".//{fix.qname(ns, 'part')}")[part_idx]
    measure = None
    div = exp = None
    for m, d, e in fix._iter_measures_with_timing(part, ns):
        if m.get("number") == mnum:
            measure, div, exp = m, d, e
            break
    max_staff = fix._max_staff_in_part(part, ns)
    print(f"Part {part_idx+1} m{mnum} div={div} exp={exp}")
    print("BEFORE:")
    for line in group_summary(measure, ns):
        print(line)
    repairs = [
        ("general_overfull", lambda m: fix._general_resolve_overfull_measure(m, ns, max_staff, div, exp)),
        ("qeq_lost", lambda m: fix._repair_quarter_eighth_quarter_lost_final(m, ns, div, exp)),
        ("qq_before_8", lambda m: fix._repair_quarter_pair_before_eighths(m, ns, div, exp)),
        ("q_before_triplet", lambda m: fix._repair_quarter_chords_before_triplet_run(m, ns, max_staff, div, exp)),
    ]
    m = copy.deepcopy(measure)
    for name, fn in repairs:
        n = fn(m)
        if n:
            print(f"HIT {name} x{n}")
    print("AFTER rhythm repairs:")
    for line in group_summary(m, ns):
        print(line)
    mf = copy.deepcopy(m)
    part_copy = copy.deepcopy(part)
    # dotted runs on part - apply to copy's measure only via part repair
    dotted, _ = fix._repair_dotted_quarter_misread(part, ns)
    print(f"dotted on whole part (side effect on trace part): {dotted}")


if __name__ == "__main__":
    for pi in [0, 1, 4]:
        trace_part(pi)
        print()
