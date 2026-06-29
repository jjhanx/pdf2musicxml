import xml.etree.ElementTree as ET

def inspect_m50(filepath):
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

    measure = piano.find(f".//{q('measure')}[@number='50']")
    print(f"\n--- {filepath} Measure 50 ---")
    for idx, note in enumerate(measure.findall(q('note'))):
        staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
        if staff != '1':
            continue
        pitch_el = note.find(q('pitch'))
        step = pitch_el.find(q('step')).text if pitch_el is not None else 'Rest'
        octave = pitch_el.find(q('octave')).text if pitch_el is not None else ''
        acc = note.find(q('accidental')).text if note.find(q('accidental')) is not None else ''
        ch = 'Chord' if note.find(q('chord')) is not None else '     '
        print(f"[{idx}] {ch} {step}{octave} Acc:{acc}")

inspect_m50('omr-work-ec9f6685/audiveris_raw.xml')
inspect_m50('omr-work-ec9f6685/review.xml')
