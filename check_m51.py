import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('test-out3.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="51"]')
chord_count = 0
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '1':
        if n.find('chord') is None:
            chord_count += 1
        p = n.find('pitch')
        if p is not None:
            step = p.find('step').text
            octave = p.find('octave').text
            alt = p.find('alter')
            alt_txt = alt.text if alt is not None else '0'
            acc = n.find('accidental')
            acc_txt = acc.text if acc is not None else ''
            print(f'Chord {chord_count} {step}{octave} alt={alt_txt} acc={acc_txt}')
