import xml.etree.ElementTree as ET

def inspect_range(filepath):
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

    for m_num in range(48, 55):
        measure = piano.find(f".//{q('measure')}[@number='{str(m_num)}']")
        if measure is None:
            continue
        print(f"\n--- Measure {m_num} ---")
        
        # Group notes
        groups = []
        cur_group = []
        for note in measure.findall(q('note')):
            voice = note.find(q('voice')).text if note.find(q('voice')) is not None else '1'
            staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
            if staff != '1':
                continue
            
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
                notes_info.append(f"{pitch}(Acc:{acc})")
            print(f"  Chord {g_idx+1}: {', '.join(notes_info)}")

inspect_range('omr-work-ec9f6685/audiveris_raw.xml')
inspect_range('omr-work-ec9f6685/review.xml')
