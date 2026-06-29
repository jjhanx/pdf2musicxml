import sys
sys.path.append('scripts')
from fix_audiveris_mxl import _note_duration, qname
import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
time = 0
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if st == '1':
        p = n.find('pitch')
        step = p.find('step').text if p is not None else 'R'
        dur = n.find('duration')
        d = int(dur.text) if dur is not None else 0
        c = 'C' if n.find('chord') is not None else ' '
        print(f'V{v} {step}{c} dur={d}')
