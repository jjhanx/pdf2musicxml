import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('f65_raw.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="50"]')
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '1':
        p = n.find('pitch')
        if p is not None:
            step = p.find('step').text
            oct = p.find('octave').text
            acc = n.find('accidental')
            acc_text = acc.text if acc is not None else 'NONE'
            c = 'C' if n.find('chord') is not None else ' '
            print(f'M50 PR {step}{oct}{c} acc={acc_text}')
