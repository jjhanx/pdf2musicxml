import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
key = tree.find('.//key')
if key is not None:
    fifths = key.find('fifths').text
    print('Key fifths:', fifths)
