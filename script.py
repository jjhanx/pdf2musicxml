import xml.etree.ElementTree as ET
tree = ET.parse('d:/pdf2musicxml/omr-work-0ef63451/audiveris_raw.xml')
for p in tree.getroot().findall('part'):
    if p.get('id') != 'P5': continue
    for m in p.findall('measure'):
        div = m.find('attributes/divisions')
        if div is not None:
            print('Measure', m.get('number'), 'divisions=', div.text)

