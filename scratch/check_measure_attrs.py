import xml.etree.ElementTree as ET

def inspect(filepath):
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

    divisions = None
    for m in piano.findall(q('measure')):
        m_num = m.get('number')
        attr = m.find(q('attributes'))
        if attr is not None:
            div = attr.find(q('divisions'))
            if div is not None:
                divisions = int(div.text)
        if m_num in ('43', '44', '45', '46', '47'):
            # calculate total duration in PL (staff 2)
            pl_notes = []
            total_dur = 0
            for note in m.findall(q('note')):
                staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
                if staff == '2' and note.find(q('chord')) is None:
                    dur_el = note.find(q('duration'))
                    dur = int(dur_el.text) if dur_el is not None and dur_el.text else 0
                    total_dur += dur
            print(f"XML Measure {m_num}: divisions={divisions}, expected_dur={divisions*4 if divisions else 0}, PL total_dur={total_dur}")

inspect('test-out.xml')
