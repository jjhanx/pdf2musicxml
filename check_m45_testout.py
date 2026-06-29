import zipfile
import xml.etree.ElementTree as ET
with zipfile.ZipFile('test-out2.mxl', 'r') as z:
    for name in z.namelist():
        if name.endswith('.xml') and name != 'META-INF/container.xml':
            with open('test-out2.xml', 'wb') as f:
                f.write(z.read(name))
            break
tree = ET.parse('test-out2.xml')
meas = tree.find('.//part[@id="P5"]/measure[@number="45"]')
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if st == '2':
        p = n.find('pitch')
        step = p.find('step').text if p is not None else 'R'
        dur = n.find('duration').text if n.find('duration') is not None else '?'
        c = 'C' if n.find('chord') is not None else ' '
        type_tag = n.find('type')
        t = type_tag.text if type_tag is not None else '?'
        tm = 'Y' if n.find('time-modification') is not None else 'N'
        tup = n.find('.//tuplet')
        tup_type = tup.get('type') if tup is not None else 'none'
        print(f'{step}{c} dur={dur} type={t} tm={tm} tup={tup_type}')
