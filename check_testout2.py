import zipfile
import xml.etree.ElementTree as ET
with zipfile.ZipFile('test-out2.mxl', 'r') as z:
    for name in z.namelist():
        if name.endswith('.xml') and name != 'META-INF/container.xml':
            with open('test-out2.xml', 'wb') as f:
                f.write(z.read(name))
            break
tree = ET.parse('test-out2.xml')
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '1':
        p = n.find('pitch')
        step = p.find('step').text if p is not None else 'R'
        c = 'C' if n.find('chord') is not None else ' '
        tuplets = []
        notations = n.find('notations')
        if notations is not None:
            for t in notations.findall('tuplet'):
                tuplets.append(t.get('type'))
        print(f'{step}{c} tuplets={tuplets}')
