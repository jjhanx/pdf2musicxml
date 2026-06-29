import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('test-out2.xml')
strip_ns(tree)
for meas in tree.findall('.//part[@id="P5"]/measure'):
    num = meas.get('number')
    chord_count = 0
    beams_by_chord = []
    for n in meas.findall('note'):
        st = n.find('staff').text if n.find('staff') is not None else '?'
        if st == '1':
            if n.find('chord') is None:
                chord_count += 1
                b = n.findall('beam')
                if b:
                    beams_by_chord.append(b[0].text)
                else:
                    beams_by_chord.append('none')
    if chord_count >= 6:
        print(f'M{num} PR chords: {chord_count}, beams: {beams_by_chord[:6]}')
