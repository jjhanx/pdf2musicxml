import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/review.xml')
m45 = tree.find('.//part[@id="P5"]/measure[@number="45"]')
for n in m45.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '2':
        tm = n.find('time-modification')
        has_tm = 'Y' if tm is not None else 'N'
        p = n.find('pitch')
        step = p.find('step').text if p is not None else 'R'
        c = 'C' if n.find('chord') is not None else ' '
        tuplet = []
        notations = n.find('notations')
        if notations is not None:
            for t in notations.findall('tuplet'):
                tuplet.append(t.get('type'))
        print(f'{step}{c} tm={has_tm} tuplet={tuplet}')
