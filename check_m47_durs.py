import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
chord_count = 0
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if st == '1':
        if n.find('chord') is None:
            chord_count += 1
        dur = n.find('duration').text if n.find('duration') is not None else '?'
        typ = n.find('type').text if n.find('type') is not None else '?'
        print(f'Chord {chord_count} V{v} dur={dur} type={typ}')
