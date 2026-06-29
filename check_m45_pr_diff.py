import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree1 = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree1)
meas1 = tree1.find('.//part[@id="P5"]/measure[@number="45"]')

tree2 = ET.parse('test-out2.xml')
strip_ns(tree2)
meas2 = tree2.find('.//part[@id="P5"]/measure[@number="45"]')

s1 = ''.join([ET.tostring(n, encoding='unicode') for n in meas1 if n.tag in ('note','backup','forward') and (n.find('staff') is None or n.find('staff').text == '1')])
s2 = ''.join([ET.tostring(n, encoding='unicode') for n in meas2 if n.tag in ('note','backup','forward') and (n.find('staff') is None or n.find('staff').text == '1')])

if s1 == s2:
    print('PR Identical!')
else:
    print('PR Different!')
    import difflib
    diff = list(difflib.unified_diff(s1.splitlines(), s2.splitlines()))
    for line in diff:
        if 'tuplet' in line or 'duration' in line or 'type' in line or 'beam' in line:
            print(line.strip())
