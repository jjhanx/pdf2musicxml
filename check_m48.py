import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/review.xml')
m48 = tree.find('.//part[@id="P5"]/measure[@number="48"]')
for n in m48.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '1':
        p = n.find('pitch')
        step = p.find('step').text if p is not None else 'R'
        dur = n.find('duration').text if n.find('duration') is not None else '?'
        c = 'C' if n.find('chord') is not None else ' '
        tm = n.find('time-modification')
        has_tm = 'Y' if tm is not None else 'N'
        tuplet = []
        notations = n.find('notations')
        if notations is not None:
            for t in notations.findall('tuplet'):
                tuplet.append(t.get('type'))
        print(f'{step}{c} dur={dur} tm={has_tm} tuplet={tuplet}')
