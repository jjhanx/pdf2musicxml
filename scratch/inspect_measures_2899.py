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

    # 1. Inspect slurs in XML measures 6, 7, 8, 30, 31, 32
    for m_num in ('6', '7', '8', '30', '31', '32'):
        measure = piano.find(f".//{q('measure')}[@number='{m_num}']")
        if measure is None:
            continue
        # Check notes in staff 1
        has_slurs = False
        notes_info = []
        for idx, note in enumerate(measure.findall(q('note'))):
            staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
            if staff != '1':
                continue
            pitch_el = note.find(q('pitch'))
            step = pitch_el.find(q('step')).text if pitch_el is not None else 'Rest'
            octave = pitch_el.find(q('octave')).text if pitch_el is not None else ''
            ch = 'Chord' if note.find(q('chord')) is not None else '     '
            slurs = []
            notations = note.find(q('notations'))
            if notations is not None:
                for s in notations.findall(q('slur')):
                    slurs.append(f"{s.get('type')},{s.get('number')},{s.get('placement')}")
                    has_slurs = True
            notes_info.append(f"  [{idx}] {ch} {step}{octave} slurs: {slurs}")
        if has_slurs:
            print(f"\n--- XML Measure {m_num} has slurs: ---")
            for info in notes_info:
                if 'slurs: []' not in info or 'Chord' in info or 'Rest' not in info:
                    print(info)

    # 2. Inspect tuplets in XML measures 44, 45, 46
    for m_num in ('44', '45', '46'):
        measure = piano.find(f".//{q('measure')}[@number='{m_num}']")
        if measure is None:
            continue
        has_tuplets = False
        notes_info = []
        for idx, note in enumerate(measure.findall(q('note'))):
            staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
            if staff != '2': # PL
                continue
            pitch_el = note.find(q('pitch'))
            step = pitch_el.find(q('step')).text if pitch_el is not None else 'Rest'
            octave = pitch_el.find(q('octave')).text if pitch_el is not None else ''
            ch = 'Chord' if note.find(q('chord')) is not None else '     '
            tms = []
            notations = note.find(q('notations'))
            if notations is not None:
                for t in notations.findall(q('tuplet')):
                    tms.append(f"tuplet:{t.get('type')},num:{t.get('number')}")
                    has_tuplets = True
            tm_el = note.find(q('time-modification'))
            if tm_el is not None:
                an = tm_el.find(q('actual-notes')).text if tm_el.find(q('actual-notes')) is not None else ''
                nn = tm_el.find(q('normal-notes')).text if tm_el.find(q('normal-notes')) is not None else ''
                tms.append(f"tm:{an}/{nn}")
                has_tuplets = True
            notes_info.append(f"  [{idx}] {ch} {step}{octave} {tms}")
        if has_tuplets:
            print(f"\n--- XML Measure {m_num} has tuplets in PL: ---")
            for info in notes_info:
                print(info)

inspect('test-out.xml')
