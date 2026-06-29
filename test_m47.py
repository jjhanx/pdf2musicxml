import sys
sys.path.append('scripts')
from fix_audiveris_mxl import _flatten_underfull_voices_in_measure, _general_resolve_overfull_measure, qname, _iter_measures_with_timing
import xml.etree.ElementTree as ET

tree = ET.parse('omr-work-10ce5694/raw.xml')
ns = 'http://www.musicxml.org/elements'
for part in tree.findall('.//' + qname(ns, 'part') + '[@id="P5"]'):
    for measure, divisions, expected in _iter_measures_with_timing(part, ns):
        if measure.get('number') == '47':
            print("Before flatten:")
            for n in measure.findall(qname(ns, 'note')):
                if n.find(qname(ns, 'staff')).text == '1':
                    p = n.find(qname(ns, 'pitch'))
                    v = n.find(qname(ns, 'voice'))
                    v = v.text if v is not None else '?'
                    if p is not None:
                        c = 'C' if n.find(qname(ns, 'chord')) is not None else ' '
                        print(f"V{v} {p.find(qname(ns, 'step')).text}{c} {n.find(qname(ns, 'duration')).text}")
            _flatten_underfull_voices_in_measure(measure, ns, expected)
            print("After flatten:")
            for n in measure.findall(qname(ns, 'note')):
                if n.find(qname(ns, 'staff')).text == '1':
                    p = n.find(qname(ns, 'pitch'))
                    v = n.find(qname(ns, 'voice'))
                    v = v.text if v is not None else '?'
                    if p is not None:
                        c = 'C' if n.find(qname(ns, 'chord')) is not None else ' '
                        print(f"V{v} {p.find(qname(ns, 'step')).text}{c} {n.find(qname(ns, 'duration')).text}")
            
            _general_resolve_overfull_measure(measure, ns, 1, divisions, expected)
            print("After resolve:")
            for n in measure.findall(qname(ns, 'note')):
                if n.find(qname(ns, 'staff')).text == '1':
                    p = n.find(qname(ns, 'pitch'))
                    if p is not None:
                        c = 'C' if n.find(qname(ns, 'chord')) is not None else ' '
                        tup = n.find('.//' + qname(ns, 'tuplet'))
                        tup = tup.get('type') if tup is not None else ''
                        print(f"{p.find(qname(ns, 'step')).text}{c} {tup}")

