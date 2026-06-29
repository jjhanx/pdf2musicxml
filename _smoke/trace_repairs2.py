#!/usr/bin/env python3
"""Trace which repairs change each reported measure."""
import copy
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"

REPAIRS = [
    ("overfull", lambda p, ns: fix._repair_overfull_eighth(p, ns)),
    ("dotted", lambda p, ns: fix._repair_dotted_quarter_misread(p, ns)),
    ("pickup", lambda p, ns: (
        sum(
            fix._repair_leading_pickup_eighth_misread(m, ns, d or 0, e or 0)
            for m, d, e in (
                list(fix._iter_measures_with_timing(p, ns))
            )
        ),
        0,
    )),
    ("leading_qq_staff", lambda p, ns: sum(
        fix._repair_leading_quarter_pair_on_staff(m, ns, d or 0, e or 0)
        for m, d, e in fix._iter_measures_with_timing(p, ns)
    )),
    ("swap", lambda p, ns: sum(
        fix._repair_swap_leading_qq_with_beamed_pair(m, ns, d or 0, e or 0)
        for m, d, e in fix._iter_measures_with_timing(p, ns)
    )),
    ("tri2", lambda p, ns: sum(
        fix._repair_two_collapsed_triplet_spans(m, ns, fix._max_staff_in_part(p, ns), d or 0, e or 0)
        for m, d, e in fix._iter_measures_with_timing(p, ns)
    )),
]

TARGETS = {
    "18": [(1, "S"), (2, "A"), (3, "T"), (4, "B")],
    "24": [(1, "S"), (2, "A"), (3, "T"), (4, "B")],
    "41": [(1, "S"), (2, "A"), (3, "T"), (4, "B"), (4, "PR")],
    "44": [(4, "PR"), (4, "PL")],
}


def load():
    with zipfile.ZipFile(RAW) as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        return ET.parse(io.BytesIO(z.read(m.group(1)))).getroot()


def sig(part, mnum, pi):
    ns = fix.mxl_ns_uri(part)
    if not isinstance(part, ET.Element):
        root = part
        ns = fix.mxl_ns_uri(root)
        part = root.findall(".//" + fix.qname(ns, "part"))[pi]
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mnum:
            continue
        bits = []
        for g in fix._iter_chord_groups(measure, ns):
            n = g[0]
            t = fix._note_type_text(n, ns) or "?"
            if fix._is_rest(n, ns):
                bits.append(f"R{t[0]}")
            else:
                bits.append(f"{t[0]}{fix._pitch_label(n, ns) or '?'}")
        return "|".join(bits)
    return "?"


root = load()
ns = fix.mxl_ns_uri(root)

for name, fn in REPAIRS:
    r = copy.deepcopy(root)
    total = 0
    for part in r.findall(fix.qname(ns, "part")):
        out = fn(part, ns)
        if isinstance(out, tuple):
            total += out[0] + out[1]
        else:
            total += out
    if total == 0:
        continue
    print(f"\n=== after {name} (+{total}) ===")
    for mnum, parts in TARGETS.items():
        for pi, label in parts:
            before = sig(root, mnum, pi)
            after = sig(r, mnum, pi)
            if before != after:
                print(f"  mxl{mnum} {label}: {before}")
                print(f"            -> {after}")
