import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]

def _renumber_tuplets(measure):
    tuplet_count = 0
    active = False
    for n in measure.findall('note'):
        for tup in n.findall('.//tuplet'):
            if tup.get('type') == 'start':
                tuplet_count += 1
                tup.set('number', str(tuplet_count))
            elif tup.get('type') == 'stop':
                tup.set('number', str(tuplet_count))

tree = ET.parse('test-out2.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="45"]')
_renumber_tuplets(meas)

for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    if st == '2':
        for tup in n.findall('.//tuplet'):
            print(f"{tup.get('type')} number={tup.get('number')}")
