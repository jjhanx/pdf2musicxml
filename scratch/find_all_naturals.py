import xml.etree.ElementTree as ET

def find_all_naturals(filepath):
    print(f"\n==================== {filepath} ====================")
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

    for measure in piano.findall(q('measure')):
        m_num = measure.get('number')
        # Group notes in the measure by chord
        groups = []
        cur_group = []
        for note in measure.findall(q('note')):
            voice = note.find(q('voice')).text if note.find(q('voice')) is not None else '1'
            staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
            if staff != '1':
                continue # only PR
            
            ch = note.find(q('chord')) is not None
            if not ch:
                if cur_group:
                    groups.append(cur_group)
                cur_group = [note]
            else:
                cur_group.append(note)
        if cur_group:
            groups.append(cur_group)

        for g_idx, g in enumerate(groups):
            for n_idx, n in enumerate(g):
                acc = n.find(q('accidental'))
                if acc is not None and acc.text == 'natural':
                    pitch_el = n.find(q('pitch'))
                    step = pitch_el.find(q('step')).text if pitch_el is not None else 'Rest'
                    octave = pitch_el.find(q('octave')).text if pitch_el is not None else ''
                    print(f"Measure {m_num}, Chord {g_idx+1}, Note {n_idx+1}: {step}{octave} has natural sign")

find_all_naturals('omr-work-ec9f6685/audiveris_raw.xml')
find_all_naturals('omr-work-ec9f6685/review.xml')
