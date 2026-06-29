import zipfile, xml.etree.ElementTree as ET

with zipfile.ZipFile('noon_fixed.mxl') as z:
    name = [x for x in z.namelist() if x.endswith('.xml') and not x.startswith('META-INF')][0]
    root = ET.fromstring(z.read(name))
ns = ""
if root.tag.startswith('{'):
    ns = root.tag[1:root.tag.index('}')]
q = lambda tag: f'{{{ns}}}{tag}' if ns else tag

for part in root.findall(q('part')):
    if part.get('id') != 'P5':
        continue
    m = part.find(f'./{q("measure")}[@number="40"]')
    if m is not None:
        ET.indent(m)
        with open('_smoke/measure40_fixed.xml', 'w', encoding='utf-8') as f:
            f.write(ET.tostring(m, encoding='utf-8').decode('utf-8'))
        print("Wrote _smoke/measure40_fixed.xml")
