import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/raw.xml')
ns = 'http://www.musicxml.org/elements'
meas = tree.find('.//measure[@number="47"]')  # any measure 47
for meas in tree.findall('.//part[@id="P5"]/measure[@number="47"]'):
    for n in meas.findall('note'):
        st = n.find('staff').text if n.find('staff') is not None else '?'
        if st == '1':
            p = n.find('pitch')
            step = p.find('step').text if p is not None else 'R'
            c = 'C' if n.find('chord') is not None else ' '
            stac = 'Y' if n.find('.//staccato') is not None else 'N'
            print(f'{step}{c} staccato={stac}')
