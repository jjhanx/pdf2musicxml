import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('test-out2.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
chord_count = 0
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '1':
        if n.find('chord') is None:
            chord_count += 1
        p = n.find('pitch')
        step = p.find('step').text if p is not None else 'R'
        c = 'C' if n.find('chord') is not None else ' '
        beams = [b.text for b in n.findall('beam')]
        print(f'Chord {chord_count} {step}{c} beams={beams}')
