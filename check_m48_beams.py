import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('test-out2.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="48"]')
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '1':
        p = n.find('pitch')
        if p is not None:
            step = p.find('step').text
            c = 'C' if n.find('chord') is not None else ' '
            beams = [b.text for b in n.findall('beam')]
            tm = 'tm' if n.find('time-modification') is not None else ''
            print(f'{step}{c} beams={beams} {tm}')
