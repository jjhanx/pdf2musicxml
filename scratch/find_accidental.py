import xml.etree.ElementTree as ET

def find_natural(filepath):
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
        # We only care about measures around 48-53
        if m_num not in [str(x) for x in range(48, 55)]:
            continue
        
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
            has_natural = False
            notes_info = []
            for n in g:
                pitch_el = n.find(q('pitch'))
                if pitch_el is not None:
                    step = pitch_el.find(q('step')).text
                    octave = pitch_el.find(q('octave')).text
                    pitch = f"{step}{octave}"
                else:
                    pitch = "Rest"
                acc = n.find(q('accidental')).text if n.find(q('accidental')) is not None else ''
                if acc == 'natural':
                    has_natural = True
                notes_info.append(f"{pitch}(Acc:{acc})")
            if has_natural:
                print(f"Measure {m_num}, Chord {g_idx+1}: {', '.join(notes_info)}")

find_natural('omr-work-ec9f6685/audiveris_raw.xml')
find_natural('omr-work-ec9f6685/review.xml')
