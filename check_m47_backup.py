import sys
import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
for el in meas:
    if el.tag in ('note', 'backup', 'forward'):
        st = el.find('staff').text if el.find('staff') is not None else '?'
        if el.tag == 'note' and st != '1': continue
        if el.tag == 'note':
            print(el.tag, el.find('pitch/step').text if el.find('pitch') is not None else 'R', el.find('duration').text)
        else:
            print(el.tag, el.find('duration').text)
