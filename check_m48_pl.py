import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="48"]')
chord_count = 0
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '2':
        if n.find('chord') is None:
            chord_count += 1
        p = n.find('pitch')
        if p is not None:
            step = p.find('step').text
            c = 'C' if n.find('chord') is not None else ' '
            print(f'Chord {chord_count}: {step}{c}')
