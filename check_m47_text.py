import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
for direction in meas.findall('.//direction'):
    words = direction.findall('.//words')
    for w in words:
        print(f"Text found: '{w.text}'")
