import sys
sys.path.append('scripts')
from fix_audiveris_mxl import qname
import xml.etree.ElementTree as ET

tree = ET.parse('omr-work-10ce5694/raw.xml')
ns = 'http://www.musicxml.org/elements'
def _do_voices_overlap(measure: ET.Element, ns: str, target_staff: str) -> bool:
    current_time = 0
    intervals = []
    for el in measure:
        if el.tag == qname(ns, 'note'):
            st = el.find(qname(ns, 'staff'))
            s = st.text if st is not None else '1'
            dur_el = el.find(qname(ns, 'duration'))
            dur = int(dur_el.text) if dur_el is not None else 0
            if s == target_staff and el.find(qname(ns, 'chord')) is None and dur > 0:
                intervals.append((current_time, current_time + dur))
            if el.find(qname(ns, 'chord')) is None:
                current_time += dur
        elif el.tag == qname(ns, 'backup'):
            dur_el = el.find(qname(ns, 'duration'))
            if dur_el is not None:
                current_time -= int(dur_el.text)
        elif el.tag == qname(ns, 'forward'):
            dur_el = el.find(qname(ns, 'duration'))
            if dur_el is not None:
                current_time += int(dur_el.text)
    
    intervals.sort()
    for i in range(len(intervals) - 1):
        if intervals[i][1] > intervals[i+1][0]:
            return True
    return False

for part in tree.findall('.//' + qname(ns, 'part') + '[@id="P5"]'):
    for measure in part.findall(qname(ns, 'measure')):
        if measure.get('number') == '47':
            print('M47 S1 overlaps:', _do_voices_overlap(measure, ns, '1'))
            print('M47 S2 overlaps:', _do_voices_overlap(measure, ns, '2'))
