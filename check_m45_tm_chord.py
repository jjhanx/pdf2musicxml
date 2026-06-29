import xml.etree.ElementTree as ET
tree = ET.parse('test-out2.xml')
meas = tree.find('.//part[@id="P5"]/measure[@number="45"]')
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '2':
        p = n.find('pitch')
        step = p.find('step').text if p is not None else 'R'
        c = 'C' if n.find('chord') is not None else ' '
        tm = 'Y' if n.find('time-modification') is not None else 'N'
        print(f'{step}{c} tm={tm}')
