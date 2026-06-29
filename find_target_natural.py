import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('test-out2.xml')
strip_ns(tree)
for meas in tree.findall('.//part[@id="P5"]/measure'):
    num = meas.get('number')
    chord_notes = []
    chord_idx = 1
    for el in meas:
        if el.tag == 'note':
            st = el.find('staff').text if el.find('staff') is not None else '?'
            if st != '1': continue
            
            if el.find('chord') is None:
                chord_idx += 1
                chord_notes = [el]
            else:
                chord_notes.append(el)
            
            acc = el.find('accidental')
            if acc is not None and acc.text == 'natural':
                if len(chord_notes) == 2:
                    p = el.find('pitch')
                    step = p.find('step').text if p is not None else 'R'
                    print(f'Found M{num} PR Chord {chord_idx-1} Note {len(chord_notes)} is {step} natural!')
