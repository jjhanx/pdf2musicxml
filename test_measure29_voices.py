import xml.etree.ElementTree as ET
import sys
sys.path.insert(0, 'd:/pdf2musicxml/scripts')
from fix_audiveris_mxl import _iter_measures_with_timing, mxl_ns_uri, _voice_groups, _note_duration
tree = ET.parse('d:/pdf2musicxml/omr-work-0ef63451/audiveris_raw.xml')
ns = mxl_ns_uri(tree.getroot())
for p in tree.getroot().findall('part'):
    if p.get('id') != 'P5': continue
    for m, div, exp in _iter_measures_with_timing(p, ns):
        if m.get('number') == '29':
            for (staff, voice), groups in _voice_groups(m, ns).items():
                if staff == '2':
                    print(f'Staff 2 Voice {voice}:')
                    for g in groups:
                        print(f'  Dur: {_note_duration(g[0], ns)}')

