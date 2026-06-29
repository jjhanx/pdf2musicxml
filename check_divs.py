import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/raw.xml')
for m in tree.findall('.//part[@id="P5"]/measure'):
    attrs = m.find('attributes')
    if attrs is not None:
        divs = attrs.find('divisions')
        if divs is not None:
            print(f'M{m.get("number")} divisions={divs.text}')
