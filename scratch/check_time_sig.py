import xml.etree.ElementTree as ET

def check_time_sig(filepath):
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

    # check first measure
    first_measure = piano.find(q('measure'))
    attr = first_measure.find(q('attributes'))
    divisions = 'none'
    time_sig = 'none'
    if attr is not None:
        div = attr.find(q('divisions'))
        if div is not None:
            divisions = div.text
        time = attr.find(q('time'))
        if time is not None:
            b = time.find(q('beats')).text
            bt = time.find(q('beat-type')).text
            time_sig = f"{b}/{bt}"
    print(f"File: {filepath}")
    print(f"First measure divisions: {divisions}, Time signature: {time_sig}")

check_time_sig('omr-work-ec9f6685/audiveris_raw.xml')
check_time_sig('omr-work-ec9f6685/review.xml')
