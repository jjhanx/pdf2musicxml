import xml.etree.ElementTree as ET
def strip_ns(tree):
    for el in tree.iter():
        if '}' in el.tag:
            el.tag = el.tag.split('}', 1)[1]
tree = ET.parse('omr-work-10ce5694/raw.xml')
strip_ns(tree)
beats, beat_type = 0, 0
for m in tree.findall('.//part[@id="P5"]/measure'):
    num = int(m.get('number', 0))
    attrs = m.find('attributes')
    if attrs is not None:
        time = attrs.find('time')
        if time is not None:
            beats = int(time.find('beats').text)
            beat_type = int(time.find('beat-type').text)
    if num == 47:
        print(f'M47 time={beats}/{beat_type}')
