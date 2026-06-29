import sys
sys.path.append('scripts')
from fix_audiveris_mxl import _iter_measures_with_timing, qname
import xml.etree.ElementTree as ET

def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]

tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
# Wait, _iter_measures_with_timing needs ns!
# I will just write the logic here.
for part in tree.findall('.//part[@id="P5"]'):
    divisions = 0
    expected = 0
    for measure in part.findall('measure'):
        attrs = measure.find('attributes')
        if attrs is not None:
            div = attrs.find('divisions')
            if div is not None: divisions = int(div.text)
            time = attrs.find('time')
            if time is not None:
                beats = int(time.find('beats').text)
                beat_type = int(time.find('beat-type').text)
                expected = beats * (divisions * 4) // beat_type
        if measure.get('number') == '47':
            print(f'M47 divisions={divisions} expected={expected}')
