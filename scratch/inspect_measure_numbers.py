import xml.etree.ElementTree as ET

def inspect_numbers(filepath):
    tree = ET.parse(filepath)
    root = tree.getroot()
    ns = ''
    t = root.tag
    if t.startswith("{"):
        ns = t[1 : t.index("}")]

    def q(local):
        return f"{{{ns}}}{local}" if ns else local

    piano = None
    for part in root.findall(q('part')):
        if part.get('id') == 'P5':
            piano = part
            break

    measures = piano.findall(q('measure'))
    numbers = [m.get('number') for m in measures]
    print(f"Total measures: {len(measures)}")
    print(f"Measure numbers in XML: {numbers}")

inspect_numbers('omr-work-2899bf35/audiveris_raw.xml')
