import xml.etree.ElementTree as ET

def inspect(filepath):
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

    # Inspect PL (staff 2) of XML measures 44 and 45
    for m_num in ('44', '45'):
        measure = piano.find(f".//{q('measure')}[@number='{m_num}']")
        if measure is None:
            continue
        print(f"\n--- XML Measure {m_num} PL Notes ---")
        for idx, note in enumerate(measure.findall(q('note'))):
            staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
            if staff != '2':
                continue
            pitch_el = note.find(q('pitch'))
            step = pitch_el.find(q('step')).text if pitch_el is not None else 'Rest'
            octave = pitch_el.find(q('octave')).text if pitch_el is not None else ''
            ch = 'Chord' if note.find(q('chord')) is not None else '     '
            dur = note.find(q('duration')).text if note.find(q('duration')) is not None else ''
            ntype = note.find(q('type')).text if note.find(q('type')) is not None else ''
            
            tms = []
            notations = note.find(q('notations'))
            if notations is not None:
                for t in notations.findall(q('tuplet')):
                    tms.append(f"tuplet:{t.get('type')},num:{t.get('number')}")
            tm_el = note.find(q('time-modification'))
            if tm_el is not None:
                an = tm_el.find(q('actual-notes')).text if tm_el.find(q('actual-notes')) is not None else ''
                nn = tm_el.find(q('normal-notes')).text if tm_el.find(q('normal-notes')) is not None else ''
                tms.append(f"tm:{an}/{nn}")
            
            print(f"[{idx}] {ch} {step}{octave} dur:{dur} type:{ntype} {tms}")

inspect('omr-work-9a237756/audiveris_raw.xml')
