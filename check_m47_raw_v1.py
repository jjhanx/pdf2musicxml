import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
for n in meas.findall('note'):
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if v == '1':
        p = n.find('pitch')
        step = p.find('step').text if p is not None else 'R'
        st = n.find('staff').text if n.find('staff') is not None else '?'
        dur = n.find('duration').text
        c = 'C' if n.find('chord') is not None else ' '
        print(f'V{v} S{st} {step}{c} dur={dur}')
