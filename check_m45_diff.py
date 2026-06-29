import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree1 = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree1)
meas1 = tree1.find('.//part[@id="P5"]/measure[@number="45"]')
s1 = ET.tostring(meas1, encoding='unicode')

tree2 = ET.parse('test-out2.xml')
strip_ns(tree2)
meas2 = tree2.find('.//part[@id="P5"]/measure[@number="45"]')
s2 = ET.tostring(meas2, encoding='unicode')

if s1 == s2:
    print('Identical!')
else:
    print('Different! Lengths:', len(s1), len(s2))
    with open('m45_1.xml', 'w') as f: f.write(s1)
    with open('m45_2.xml', 'w') as f: f.write(s2)
