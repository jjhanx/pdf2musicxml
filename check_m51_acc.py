import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('test-out2.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="51"]')
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '1':
        acc = n.find('accidental')
        if acc is not None:
            p = n.find('pitch')
            step = p.find('step').text if p is not None else 'R'
            octave = p.find('octave').text if p is not None else '?'
            print(f'{step}{octave} acc={acc.text}')
