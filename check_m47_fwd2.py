import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('test-out2.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
time = 0
for el in meas:
    if el.tag in ('backup', 'forward'):
        dur = int(el.find('duration').text)
        if el.tag == 'backup': time -= dur
        else: time += dur
        print(f'{el.tag} {dur} -> time={time}')
    elif el.tag == 'note':
        v = el.find('voice').text if el.find('voice') is not None else '?'
        if el.find('chord') is None:
            dur = int(el.find('duration').text)
            time += dur
            print(f'note V{v} dur={dur} -> time={time}')
