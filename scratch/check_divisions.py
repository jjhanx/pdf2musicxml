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

    # Find divisions at or before measure 43
    divisions = None
    for m in piano.findall(q('measure')):
        attr = m.find(q('attributes'))
        if attr is not None:
            div = attr.find(q('divisions'))
            if div is not None:
                divisions = int(div.text)
        if m.get('number') == '43':
            print(f"Measure 43 divisions: {divisions}")
            # print all notes in staff 2 (PL)
            for idx, note in enumerate(m.findall(q('note'))):
                staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
                if staff == '2':
                    p = note.find(q('pitch'))
                    step = p.find(q('step')).text if p is not None else 'Rest'
                    octave = p.find(q('octave')).text if p is not None else ''
                    dur = note.find(q('duration')).text if note.find(q('duration')) is not None else ''
                    ntype = note.find(q('type')).text if note.find(q('type')) is not None else ''
                    tm = note.find(q('time-modification')) is not None
                    tup = note.find(q('notations')) is not None and note.find(q('notations')).find(q('tuplet')) is not None
                    print(f"[{idx}] {step}{octave} dur:{dur} type:{ntype} has_tm:{tm} has_tuplet:{tup}")

inspect('omr-work-9a237756/audiveris_raw.xml')
