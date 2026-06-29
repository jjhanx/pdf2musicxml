import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="45"]')
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if st == '2':
        p = n.find('pitch/step').text if n.find('pitch') is not None else 'R'
        c = 'C' if n.find('chord') is not None else ' '
        stem = n.find('stem').text if n.find('stem') is not None else 'none'
        print(f'{p}{c} stem={stem}')
