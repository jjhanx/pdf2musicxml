import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/review.xml')
m7 = tree.find('.//part[@id="P5"]/measure[@number="7"]')
for n in m7.findall('note'):
    st = n.find('staff')
    if st is not None and st.text == '1':
        p = n.find('pitch')
        v = n.find('voice')
        if p is not None:
            step = p.find('step').text
            octave = p.find('octave').text
            voice = v.text if v is not None else '?'
            slurs = []
            notations = n.find('notations')
            if notations is not None:
                for s in notations.findall('slur'):
                    slurs.append(s.get('type') + ',' + str(s.get('number')) + ',' + str(s.get('placement')))
            print(f'V{voice} {step}{octave} slurs: {slurs}')
