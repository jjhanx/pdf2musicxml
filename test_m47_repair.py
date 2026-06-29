import sys
sys.path.append('scripts')
from fix_audiveris_mxl import _iter_chord_groups, _note_duration, _is_rest, _is_plain_eighth_group
import xml.etree.ElementTree as ET

def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]

tree = ET.parse('test-out2.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
groups = list(_iter_chord_groups(meas, ''))
for i, grp in enumerate(groups):
    leader = grp[0]
    st = leader.find('staff').text if leader.find('staff') is not None else '?'
    if st == '1':
        print(f"Chord {i} dur={_note_duration(leader, '')} type={leader.find('type').text if leader.find('type') is not None else '?'}")
