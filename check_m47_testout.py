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
    if v == '2':
        p = n.find('pitch')
        if p is not None:
            step = p.find('step').text
            dur = n.find('duration').text
            typ = n.find('type').text if n.find('type') is not None else '?'
            beams = [b.text for b in n.findall('beam')]
            tm = 'tm' if n.find('time-modification') is not None else ''
            print(f'V2 {step} dur={dur} type={typ} beams={beams} {tm}')
