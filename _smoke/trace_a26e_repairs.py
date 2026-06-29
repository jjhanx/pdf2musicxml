#!/usr/bin/env python3
import importlib.util, copy, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

def part_p5(root):
    ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
    return ns, [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]

def show_groups(measure, ns, staff):
    for (_, v), groups in fix._voice_groups(measure, ns).items():
        print(f" voice {v}")
        for i, g in enumerate(groups):
            if g[2] != staff:
                continue
            n = g[0]
            pitches = [fix._pitch_label(x, ns) or "R" for x in g[1]]
            tm = n.find(fix.qname(ns, "time-modification")) is not None
            stem = fix._stem_from_note(n, ns)
            beams = [b.text for b in n.findall(fix.qname(ns, "beam"))]
            print(f"  {i}: {pitches} {fix._note_type_text(n,ns)}{'T' if tm else ''} stem={stem} beam={beams} dur={fix._note_duration(n,ns)}")

root = load("_smoke/omr-work-a26ecec0-full/audiveris_raw.mxl")
ns, part = part_p5(root)
max_staff = fix._max_staff_in_part(part, ns)
for mn in ("41", "42", "44"):
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mn:
            continue
        print(f"\n=== RAW m{mn} before fixes div={div} exp={exp}")
        show_groups(measure, ns, "1")
        show_groups(measure, ns, "2")
        m = copy.deepcopy(measure)
        for name, fn in [
            ("quarter_pair_eighth", lambda: fix._repair_quarter_pair_before_eighths(m, ns, div, exp)),
            ("quarter_pair_after_beam", lambda: fix._repair_quarter_pair_after_beam_run(m, ns, div, exp)),
            ("general_resolve", lambda: fix._general_resolve_overfull_measure(m, ns, max_staff, div, exp)),
            ("three_eighth", lambda: fix._repair_three_eighths_as_triplet(m, ns, max_staff, div)),
            ("quarter_chord_triplet", lambda: fix._repair_quarter_chords_before_triplet_run(m, ns, max_staff, div)),
        ]:
            n = fn()
            if n:
                print(f"  {name} -> {n}")
                show_groups(m, ns, "1")
                show_groups(m, ns, "2")
