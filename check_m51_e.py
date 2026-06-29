import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="51"]')
for n in meas.findall('note'):
    p = n.find('pitch')
    if p is not None and p.find('step').text == 'E':
        print(ET.tostring(n, encoding='unicode'))
