import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/raw.xml')
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if st == '1' and v == '1':
        p = n.find('pitch')
        if p is not None:
            step = p.find('step').text
            dur = n.find('duration').text if n.find('duration') is not None else '?'
            type_el = n.find('type')
            t = type_el.text if type_el is not None else '?'
            c = 'C' if n.find('chord') is not None else ' '
            print(f'{step}{c} dur={dur} type={t}')
