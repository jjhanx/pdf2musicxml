import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('test-out2.xml')
strip_ns(tree)
for meas in tree.findall('.//part[@id="P5"]/measure'):
    num = meas.get('number')
    for n in meas.findall('note'):
        st = n.find('staff').text if n.find('staff') is not None else '?'
        if st == '1':
            p = n.find('pitch')
            if p is not None and p.find('step').text == 'E':
                acc = n.find('accidental')
                if acc is not None and acc.text == 'natural':
                    print(f'M{num} PR E natural found!')
