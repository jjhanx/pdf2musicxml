import sys
sys.path.append('scripts')
from fix_audiveris_mxl import _voice_groups, _is_plain_eighth_group, _note_duration
import xml.etree.ElementTree as ET

def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]

tree = ET.parse('test-out3.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')

divisions = 6
for (staff, voice), groups in _voice_groups(meas, '').items():
    print(f'V{voice} S{staff} len(groups)={len(groups)}')
    if len(groups) == 4:
        for i, g in enumerate(groups):
            print(f'Group {i}: is_plain_eighth={_is_plain_eighth_group(g[0], "", divisions)}')
