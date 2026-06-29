import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('test-out3.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
for n in meas.findall('note'):
    v = n.find('voice').text if n.find('voice') is not None else '?'
    p = n.find('pitch/step').text if n.find('pitch') is not None else 'R'
    dur = n.find('duration').text
    tup = n.find('time-modification') is not None
    print(f'V{v} {p} dur={dur} tup={tup}')
