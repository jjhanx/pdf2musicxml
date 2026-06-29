import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]

def _measure_max_time(measure: ET.Element, ns: str) -> int:
    time = 0
    max_time = 0
    for el in measure:
        if el.tag == 'note':
            if el.find('chord') is None:
                d = el.find('duration')
                if d is not None and d.text:
                    time += int(d.text)
                    if time > max_time: max_time = time
        elif el.tag == 'backup':
            d = el.find('duration')
            if d is not None and d.text:
                time -= int(d.text)
        elif el.tag == 'forward':
            d = el.find('duration')
            if d is not None and d.text:
                time += int(d.text)
    return max_time

tree = ET.parse('test-out2.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
print(f"Max time: {_measure_max_time(meas, '')}")
