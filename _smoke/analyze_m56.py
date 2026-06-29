import sys
sys.path.insert(0, "scripts")
import fix_audiveris_mxl as fam
from fix_audiveris_mxl import qname, local_tag
_iter_measures_with_timing = fam._iter_measures_with_timing
_voice_groups = fam._voice_groups
_note_duration = fam._note_duration
_pitch_label = fam._pitch_label
_is_rest = fam._is_rest
_is_plain_quarter_group = fam._is_plain_quarter_group
_is_plain_eighth_group = fam._is_plain_eighth_group
_is_eighth_rest_group = fam._is_eighth_rest_group
import xml.etree.ElementTree as ET
import zipfile


def load_part(mxl, part_idx):
    with zipfile.ZipFile(mxl) as z:
        names = [n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()]
        root = ET.fromstring(z.read(names[0]))
    ns = root.tag.split("}")[0] + "}" if "}" in root.tag else ""
    parts = root.findall(".//" + qname(ns, "part"))
    return parts[part_idx - 1], ns


mxl = "_smoke/omr-work-2e86a8e0/audiveris_raw.mxl"
for pid, m in [(1, 56), (3, 56), (5, 56), (1, 55), (3, 55), (4, 51), (4, 53)]:
    part, ns = load_part(mxl, pid)
    for measure, div, exp in _iter_measures_with_timing(part, ns):
        num = measure.find(qname(ns, "number"))
        if num is not None and int(num.text) == m:
            print(f"P{pid} m{m} div={div} exp={exp}")
            for (st, v), grps in _voice_groups(measure, ns).items():
                total = sum(_note_duration(g[0], ns) or 0 for g in grps)
                print(f"  staff={st} voice={v} n={len(grps)} total={total}")
                for i, g in enumerate(grps):
                    ld = g[0]
                    print(
                        f"    {i}: dur={_note_duration(ld, ns)} pitch={_pitch_label(ld, ns)} "
                        f"rest={_is_rest(ld, ns)} dotted={ld.find(qname(ns, 'dot')) is not None} "
                        f"plain_q={_is_plain_quarter_group(ld, ns, div)} "
                        f"plain_e={_is_plain_eighth_group(ld, ns, div)} "
                        f"eighth_rest={_is_eighth_rest_group(ld, ns, div)}"
                    )
            break
