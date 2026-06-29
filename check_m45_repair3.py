import sys
sys.path.append('scripts')
from fix_audiveris_mxl import _repair_three_eighths_as_triplet, _iter_measures_with_timing, qname
import xml.etree.ElementTree as ET

def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]

tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
for part in tree.findall('.//part[@id="P5"]'):
    for measure in part.findall('measure'):
        if measure.get('number') == '45':
            fixed = _repair_three_eighths_as_triplet(measure, '', 1, 6)
            print('M45 fixed?', fixed)
