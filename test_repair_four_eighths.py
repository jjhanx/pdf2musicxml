import sys
sys.path.append('scripts')
from fix_audiveris_mxl import _note_duration, _is_rest, _is_plain_eighth_group, _halve_group_to_eighth, qname
import xml.etree.ElementTree as ET

def _repair_four_eighths_as_triplet_plus_eighth(measure: ET.Element, ns: str, divisions: int) -> int:
    eighth = divisions // 2
    if eighth <= 0: return 0

    from fix_audiveris_mxl import _voice_groups
    vgroups = _voice_groups(measure, ns)
    
    for (staff, voice), groups in vgroups.items():
        if len(groups) != 4:
            continue
        g0, g1, g2, g3 = groups
        if not (_is_plain_eighth_group(g0[0], ns, divisions) and 
                _is_plain_eighth_group(g1[0], ns, divisions) and 
                _is_plain_eighth_group(g2[0], ns, divisions) and 
                _is_plain_eighth_group(g3[0], ns, divisions)):
            continue
        print(f"Found exactly 4 plain eighths in M{measure.get('number')} V{voice}!")

def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]

tree = ET.parse('test-out2.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
_repair_four_eighths_as_triplet_plus_eighth(meas, '', 6)
