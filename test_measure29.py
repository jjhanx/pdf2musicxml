import xml.etree.ElementTree as ET
import sys
sys.path.insert(0, 'd:/pdf2musicxml/scripts')
from fix_audiveris_mxl import _general_resolve_overfull_measure, _iter_measures_with_timing, mxl_ns_uri
tree = ET.parse('d:/pdf2musicxml/omr-work-0ef63451/audiveris_raw.xml')
ns = mxl_ns_uri(tree.getroot())
for p in tree.getroot().findall('part'):
    if p.get('id') != 'P5': continue
    for m, div, exp in _iter_measures_with_timing(p, ns):
        if m.get('number') == '29':
            print('Measure 29 div=', div, 'exp=', exp)
            res = _general_resolve_overfull_measure(m, ns, 2, div, exp)
            print('res=', res)

