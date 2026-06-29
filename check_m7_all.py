import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/review.xml')
m7 = tree.find('.//part[@id="P5"]/measure[@number="7"]')
for n in m7.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    v = n.find('voice').text if n.find('voice') is not None else '?'
    p = n.find('pitch')
    if p is not None:
        step = p.find('step').text
        octave = p.find('octave').text
        c = 'C' if n.find('chord') is not None else ' '
        slurs = []
        ties = []
        notations = n.find('notations')
        if notations is not None:
            for s in notations.findall('slur'):
                slurs.append(s.get('type') + ',' + str(s.get('number')) + ',' + str(s.get('placement')))
            for t in notations.findall('tied'):
                ties.append(t.get('type'))
        if slurs or ties:
            print(f'S{st} V{v} {step}{octave}{c} slurs:{slurs} ties:{ties}')
