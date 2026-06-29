import xml.etree.ElementTree as ET
tree = ET.parse('d:/pdf2musicxml/noon.xml')
for p in tree.getroot().findall('part'):
    if p.get('id') != 'P5': continue
    for m in p.findall('measure'):
        if m.get('number') == '29':
            for n in m.findall('note'):
                staff = n.find('staff').text if n.find('staff') is not None else ''
                if staff != '2': continue
                beams = [b.text for b in n.findall('beam')]
                step = n.find('pitch/step').text if n.find('pitch') is not None else 'REST'
                oct = n.find('pitch/octave').text if n.find('pitch') is not None else ''
                print(step+oct, beams)

