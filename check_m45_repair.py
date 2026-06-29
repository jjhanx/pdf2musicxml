import sys
sys.path.append('scripts')
from fix_audiveris_mxl import _repair_three_eighths_as_triplet, _iter_measures_with_timing, qname
import xml.etree.ElementTree as ET

tree = ET.parse('omr-work-10ce5694/raw.xml')
ns = 'http://www.musicxml.org/elements'
for part in tree.findall('.//' + qname(ns, 'part')):
    for measure, divisions, expected in _iter_measures_with_timing(part, ns):
        if measure.get('number') == '45':
            fixed = _repair_three_eighths_as_triplet(measure, ns, 1)
            print('M45 fixed?', fixed)
