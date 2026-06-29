import sys
sys.path.append('scripts')
from fix_audiveris_mxl import _iter_measures_with_timing, qname
import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/raw.xml')
ns = 'http://www.musicxml.org/elements'
for part in tree.findall(f'.//{qname(ns, "part")}[@id="P5"]'):
    for measure, divisions, expected in _iter_measures_with_timing(part, ns):
        if measure.get('number') == '47':
            print(f'M47 divisions={divisions} expected={expected}')
