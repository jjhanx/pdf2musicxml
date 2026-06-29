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


def load():
    with zipfile.ZipFile(ROOT / "_smoke/omr-work-6855d546-full/audiveris_raw.mxl") as z:
        c = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', c)
        root = ET.fromstring(z.read(m.group(1)))
    return root, fix.mxl_ns_uri(root)


def s1_voices(part, ns, mnum="25"):
    for m, div, exp in fix._iter_measures_with_timing(part, ns):
        if m.get("number") != mnum:
            continue
        out = {}
        for (staff, voice), groups in fix._voice_groups(m, ns).items():
            if staff != "1":
                continue
            out[voice] = [
                (
                    fix._note_type_text(g[0], ns),
                    g[0].find(fix.qname(ns, "dot")) is not None,
                    fix._note_duration(g[0], ns),
                    len(g[1]),
                )
                for g in groups
            ]
        return m, div, exp, out
    return None, None, None, {}


def show(label, voices):
    print(label)
    for v, grps in sorted(voices.items()):
        print(f"  v{v}: {grps}")


root, ns = load()
part = root.findall(f".//{fix.qname(ns, 'part')}")[4]
part = copy.deepcopy(part)
max_staff = fix._max_staff_in_part(part, ns)

m, div, exp, voices = s1_voices(part, ns)
show("raw", voices)

# mirror fix order for one measure inside part
for measure, divisions, expected in fix._iter_measures_with_timing(part, ns):
    if measure.get("number") != "25":
        continue
    steps = [
        ("flatten", lambda: fix._flatten_underfull_voices_in_measure(measure, ns, expected or 0)),
        ("general_overfull", lambda: fix._general_resolve_overfull_measure(measure, ns, max_staff, divisions or 0, expected or 0)),
        ("swap_qq", lambda: fix._repair_swap_leading_qq_with_beamed_pair(measure, ns, divisions or 0, expected or 0)),
        ("leading_qq", lambda: fix._repair_leading_quarter_pair(measure, ns, divisions or 0, expected or 0)),
        ("qeq", lambda: fix._repair_quarter_eighth_quarter_lost_final(measure, ns, divisions or 0, expected or 0)),
        ("qq_before_8", lambda: fix._repair_quarter_pair_before_eighths(measure, ns, divisions or 0, expected or 0)),
        ("qq_after_beam", lambda: fix._repair_quarter_pair_after_beam_run(measure, ns, divisions or 0, expected or 0)),
        ("q_before_rest", lambda: fix._repair_quarter_chord_before_rest(measure, ns, divisions or 0, expected or 0)),
        ("two_q_8", lambda: fix._repair_two_quarter_voice_as_eighths(measure, ns, divisions or 0, expected or 0)),
        ("three_8_t", lambda: fix._repair_three_eighths_as_triplet(measure, ns, max_staff, divisions or 0, expected or 0)),
        ("rest_8_t", lambda: fix._repair_eighth_rest_plus_two_eighths_triplet(measure, ns, max_staff, divisions or 0, expected or 0)),
        ("collapsed", lambda: fix._repair_two_collapsed_triplet_spans(measure, ns, max_staff, divisions or 0, expected or 0)),
        ("q_before_t", lambda: fix._repair_quarter_chords_before_triplet_run(measure, ns, max_staff, divisions or 0, expected or 0)),
    ]
    for name, fn in steps:
        n = fn()
        if n:
            _, _, _, voices = s1_voices(part, ns)
            show(f"  HIT {name} x{n}", voices)

d, _ = fix._repair_dotted_quarter_misread(part, ns)
if d:
    _, _, _, voices = s1_voices(part, ns)
    show(f"  HIT dotted x{d}", voices)
