import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/review.xml')
m7 = tree.find('.//part[@id="P5"]/measure[@number="7"]')
for n in m7.findall('note'):
    st = n.find('staff')
    if st is not None and st.text == '1':
        p = n.find('pitch')
        if p is not None:
            step = p.find('step').text
            octave = p.find('octave').text
            c = 'C' if n.find('chord') is not None else ' '
            slurs = []
            notations = n.find('notations')
            if notations is not None:
                for s in notations.findall('slur'):
                    slurs.append(s.get('type') + ',' + str(s.get('number')) + ',' + str(s.get('placement')))
            print(step + octave + c + ' slurs: ' + str(slurs))
