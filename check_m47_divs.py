import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/raw.xml')
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
attrs = meas.find('attributes')
if attrs is not None:
    divs = attrs.find('divisions')
    if divs is not None:
        print(f'M47 divisions={divs.text}')
    time = attrs.find('time')
    if time is not None:
        print(f'M47 time={time.find("beats").text}/{time.find("beat-type").text}')
