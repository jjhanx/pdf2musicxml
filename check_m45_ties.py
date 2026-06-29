import xml.etree.ElementTree as ET
tree = ET.parse('test-out2.xml')
meas = tree.find('.//part[@id="P5"]/measure[@number="45"]')
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '2':
        p = n.find('pitch')
        step = p.find('step').text if p is not None else 'R'
        ties = [t.get('type') for t in n.findall('tie')]
        print(f'{step} ties={ties}')
