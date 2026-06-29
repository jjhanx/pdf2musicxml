#!/usr/bin/env python3
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from test_fix_audiveris import pl_m42_triplet_pitches, load_root, q

p = Path("_smoke/omr-work-6855d546-full/test_fixed.mxl")
root = load_root(p)
ns = root.tag[1 : root.tag.index("}")]
part = [x for x in root.findall(q(ns, "part")) if x.get("id") == "P5"][0]
m = part.find(f".//{q(ns, 'measure')}[@number='42']")
groups = []
chord = []
for n in m.findall(q(ns, "note")):
    st = n.find(q(ns, "staff"))
    if st is not None and (st.text or "1") != "2":
        continue
    if n.find(q(ns, "chord")) is None:
        if chord:
            groups.append(chord)
        chord = [n]
    else:
        chord.append(n)
if chord:
    groups.append(chord)
for i, g in enumerate(groups[:6]):
    ps = sorted(
        pe.find(q(ns, "step")).text + pe.find(q(ns, "octave")).text
        for x in g
        if (pe := x.find(q(ns, "pitch"))) is not None
    )
    print(i + 1, ps)
print(pl_m42_triplet_pitches(p))
