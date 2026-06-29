import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
for el in meas:
    if el.tag in ('backup', 'forward'):
        dur = el.find('duration').text if el.find('duration') is not None else '?'
        print(f'{el.tag} {dur}')
    elif el.tag == 'note':
        v = el.find('voice').text if el.find('voice') is not None else '?'
        if el.find('chord') is None:
            p = el.find('pitch/step').text if el.find('pitch') is not None else 'R'
            print(f'note V{v} {p}')
