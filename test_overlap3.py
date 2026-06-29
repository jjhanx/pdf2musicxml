import xml.etree.ElementTree as ET

def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]

tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)

def _do_voices_overlap(measure: ET.Element, target_staff: str) -> bool:
    current_time = 0
    intervals = []
    for el in measure:
        if el.tag == 'note':
            st = el.find('staff')
            s = st.text if st is not None else '1'
            dur_el = el.find('duration')
            dur = int(dur_el.text) if dur_el is not None else 0
            if s == target_staff and el.find('chord') is None and dur > 0:
                intervals.append((current_time, current_time + dur))
            if el.find('chord') is None:
                current_time += dur
        elif el.tag == 'backup':
            dur_el = el.find('duration')
            if dur_el is not None:
                current_time -= int(dur_el.text)
        elif el.tag == 'forward':
            dur_el = el.find('duration')
            if dur_el is not None:
                current_time += int(dur_el.text)
    
    intervals.sort()
    for i in range(len(intervals) - 1):
        if intervals[i][1] > intervals[i+1][0]:
            return True
    return False

for part in tree.findall('.//part[@id="P5"]'):
    for measure in part.findall('measure'):
        if measure.get('number') == '47':
            print('M47 S1 overlaps:', _do_voices_overlap(measure, '1'))
            print('M47 S2 overlaps:', _do_voices_overlap(measure, '2'))
