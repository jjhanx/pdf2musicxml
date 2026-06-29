import zipfile, xml.etree.ElementTree as ET

def dump_xml_structure(mxl_path):
    print(f"=== XML DETAILS FOR {mxl_path} ===")
    try:
        with zipfile.ZipFile(mxl_path) as z:
            name = [x for x in z.namelist() if x.endswith('.xml') and not x.startswith('META-INF')][0]
            root = ET.fromstring(z.read(name))
    except Exception as e:
        print(f"Error: {e}")
        return
    ns = ""
    if root.tag.startswith('{'):
        ns = root.tag[1:root.tag.index('}')]
    q = lambda tag: f'{{{ns}}}{tag}' if ns else tag
    
    for part in root.findall(q('part')):
        if part.get('id') != 'P5':
            continue
        m = part.find(f'./{q("measure")}[@number="41"]')
        if m is None:
            print("Measure 41 not found")
            continue
        for idx, n in enumerate(m.findall(q('note'))):
            staff = n.find(q('staff'))
            if staff is not None and staff.text == '2':
                pitch_el = n.find(q('pitch'))
                rest = n.find(q('rest')) is not None
                chord = n.find(q('chord')) is not None
                dur_el = n.find(q('duration'))
                dur = dur_el.text if dur_el is not None else '?'
                voice = n.find(q('voice')).text if n.find(q('voice')) is not None else '?'
                
                pitch_str = ""
                if pitch_el is not None:
                    step = pitch_el.find(q('step')).text
                    octave = pitch_el.find(q('octave')).text
                    alter = pitch_el.find(q('alter'))
                    alter_str = f"({alter.text})" if alter is not None else ""
                    pitch_str = f"{step}{octave}{alter_str}"
                elif rest:
                    pitch_str = "Rest"
                
                tmod_str = ""
                tmod = n.find(q('time-modification'))
                if tmod is not None:
                    act = tmod.find(q('actual-notes')).text
                    norm = tmod.find(q('normal-notes')).text
                    tmod_str = f"tmod={act}/{norm}"
                    
                notations = n.find(q('notations'))
                tup_str = []
                if notations is not None:
                    for tup in notations.findall(q('tuplet')):
                        tup_str.append(f"tuplet={tup.get('type')}")
                
                chord_mark = " [CHORD]" if chord else ""
                print(f"Note {idx:2}: {pitch_str:8} Dur={dur:3} Voice={voice:2} Staff={staff.text}{chord_mark} {tmod_str} {','.join(tup_str)}")

if __name__ == '__main__':
    import os
    paths = [
        'noon.mxl',
        'noon_fixed.mxl',
        r'C:\Users\jjhan\.gemini\antigravity-ide\brain\6a7ff7c1-5510-4b4a-9349-3e2fa4be2604\scratch\older_output.mxl',
        r'C:\Users\jjhan\.gemini\antigravity-ide\brain\6a7ff7c1-5510-4b4a-9349-3e2fa4be2604\scratch\prev_output.mxl',
        r'C:\Users\jjhan\.gemini\antigravity-ide\brain\6a7ff7c1-5510-4b4a-9349-3e2fa4be2604\scratch\omr-work-0ef63451\prev_fixed_from_raw.mxl',
        r'C:\Users\jjhan\.gemini\antigravity-ide\brain\6a7ff7c1-5510-4b4a-9349-3e2fa4be2604\scratch\omr-work-0ef63451\test_fixed.mxl'
    ]
    for p in paths:
        if os.path.exists(p):
            dump_xml_structure(p)
        else:
            print(f"Path does not exist: {p}")
