import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/raw.xml')
m48 = tree.find('.//part[@id="P5"]/measure[@number="48"]')
for n in m48.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if st == '1':
        p = n.find('pitch')
        step = p.find('step').text if p is not None else 'R'
        dur = n.find('duration').text if n.find('duration') is not None else '?'
        c = 'C' if n.find('chord') is not None else ' '
        print(f'V{v} {step}{c} dur={dur}')
