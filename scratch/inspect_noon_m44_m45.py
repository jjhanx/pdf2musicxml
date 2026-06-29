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
            print(f"[{idx}] {ch} {step}{octave} dur:{dur}")

inspect('noon.xml')
