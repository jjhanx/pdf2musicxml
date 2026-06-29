#!/usr/bin/env python3
import copy
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
import traceback

sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fix

RAW = "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"

with zipfile.ZipFile(RAW) as z:
    root_bytes = z.read(re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1))

TARGETS = {(2, "24"), (4, "24")}  # part_idx, measure number


def mnum(measure):
    return measure.get("number")


def in_target(part_idx, measure):
    return (part_idx, mnum(measure)) in TARGETS


def describe(notes, ns):
    n = notes[0]
    t = fix._note_type_text(n, ns)
    r = fix._is_rest(n, ns)
    return f"{t}{'(rest)' if r else ''} x={n.get('default-x')}"


orig_set_q = fix._set_group_to_quarter
orig_halve = fix._halve_group_to_eighth
orig_set_e8 = fix._set_group_to_plain_eighth


def wrap(fn, name):
    def inner(*args, **kwargs):
        notes = args[0]
        ns = args[1]
        # find measure context via stack is hard; log all for m24 parts
        print(f"  {name}: {describe(notes, ns)}")
        return fn(*args, **kwargs)
    return inner


fix._set_group_to_quarter = wrap(orig_set_q, "SET_QUARTER")
fix._set_group_to_plain_eighth = wrap(orig_set_e8, "SET_E8")

# wrap repair functions to log when they touch target measures
for fname in [
    "_repair_swap_leading_qq_with_beamed_pair",
    "_repair_leading_quarter_pair",
    "_repair_leading_quarter_pair_on_staff",
]:
    orig = getattr(fix, fname)

    def make(f, o):
        def wrapped(measure, ns, *a, **kw):
            r = o(measure, ns, *a, **kw)
            if r and mnum(measure) == "24":
                print(f"FIRED {f} on m24 r={r}")
            return r
        return wrapped

    setattr(fix, fname, make(fname, orig))

out, stats = fix.fix_score_xml(root_bytes)
root2 = ET.fromstring(out)
ns = fix.mxl_ns_uri(root2)

for pi, label in [(2, "T"), (4, "PR")]:
    part = root2.findall(".//" + fix.qname(ns, "part"))[pi]
    for measure, _, _ in fix._iter_measures_with_timing(part, ns):
        if mnum(measure) != "24":
            continue
        print(f"\n=== {label} AFTER ===")
        for g in fix._iter_chord_groups(measure, ns):
            if pi == 4 and not (g[2] == "1" and g[3] == "1"):
                continue
            n = g[0]
            t = fix._note_type_text(n, ns)
            if fix._is_rest(n, ns):
                t = "R-" + t
            beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
            print(f" v{g[3]} {t} b={beams} x={n.get('default-x')}")
