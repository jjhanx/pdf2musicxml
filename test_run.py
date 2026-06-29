import sys
sys.path.append('scripts')
from fix_audiveris_mxl import _repair_four_eighths_as_triplet_plus_eighth
import xml.etree.ElementTree as ET

def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]

tree = ET.parse('test-out2.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
fixed = _repair_four_eighths_as_triplet_plus_eighth(meas, '', 6)
print(f'Fixed: {fixed}')
for n in meas.findall('note'):
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if v == '2':
        print('dur:', n.find('duration').text)
