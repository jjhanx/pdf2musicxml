import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/raw.xml')
meas = tree.find('.//part[@id="P5"]/measure[@number="47"]')
total = 0
for n in meas.findall('note'):
    st = n.find('staff').text if n.find('staff') is not None else '?'
    v = n.find('voice').text if n.find('voice') is not None else '?'
    if st == '1' and v == '1':
        dur = n.find('duration')
        if dur is not None and n.find('chord') is None:
            total += int(dur.text)
print(f'M47 total dur={total}')
