import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
for m in tree.findall('.//part[@id="P5"]/measure'):
    num = int(m.get('number', 0))
    attrs = m.find('attributes')
    if attrs is not None:
        time = m.find('.//time')
        if time is not None:
            beats = int(time.find('beats').text)
            beat_type = int(time.find('beat-type').text)
            print(f'M{num} time changed to {beats}/{beat_type}')
