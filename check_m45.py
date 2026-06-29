import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/review.xml')
m45 = tree.find('.//part[@id="P5"]/measure[@number="45"]')
for n in m45.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '2':
        v = n.find('voice').text if n.find('voice') is not None else '?'
        p = n.find('pitch')
        if p is not None:
            step = p.find('step').text
            octave = p.find('octave').text
            dur = n.find('duration').text if n.find('duration') is not None else '?'
            c = 'C' if n.find('chord') is not None else ' '
            print(f'V{v} {step}{octave}{c} dur={dur}')
