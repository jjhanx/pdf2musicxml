import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/review.xml')
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
notes = meas.findall('note')
for n in notes:
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '1':
        p = n.find('pitch')
        if p is not None:
            step = p.find('step').text
            c = 'C' if n.find('chord') is not None else ' '
            beams = [b.text for b in n.findall('beam')]
            tuplets = []
            notations = n.find('notations')
            if notations is not None:
                for t in notations.findall('tuplet'):
                    tuplets.append(t.get('type'))
            print(f'{step}{c} beams:{beams} tuplets:{tuplets}')
