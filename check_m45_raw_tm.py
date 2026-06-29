import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="45"]')
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if st == '2' and v == '5':
        p = n.find('pitch')
        step = p.find('step').text if p is not None else 'R'
        c = 'C' if n.find('chord') is not None else ' '
        tm = 'Y' if n.find('time-modification') is not None else 'N'
        tup = n.find('.//tuplet')
        tup_type = tup.get('type') if tup is not None else 'none'
        print(f'{step}{c} tm={tm} tup={tup_type}')
