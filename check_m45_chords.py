import xml.etree.ElementTree as ET
tree = ET.parse('test-out2.xml')
meas = tree.find('.//part[@id="P5"]/measure[@number="45"]')
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if st == '2':
        p = n.find('pitch')
        if p is not None:
            step = p.find('step').text
            octave = p.find('octave').text
            c = 'C' if n.find('chord') is not None else ' '
            print(f'{step}{octave}{c}')
