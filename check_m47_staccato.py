import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('test-out2.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
for n in meas.findall('note'):
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if v == '2':
        notations = n.find('notations')
        if notations is not None:
            for art in notations.findall('.//staccato'):
                print(f'V2 Staccato found!')
