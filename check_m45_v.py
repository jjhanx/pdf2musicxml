import xml.etree.ElementTree as ET
tree = ET.parse('test-out2.xml')
meas = tree.find('.//part[@id="P5"]/measure[@number="45"]')
voices = set()
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if st == '2':
        voices.add(v)
print("M45 PL voices:", voices)
