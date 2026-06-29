import zipfile, xml.etree.ElementTree as ET

def inspect_all_parts(mxl_path):
    print(f"=== ALL PARTS IN {mxl_path} MEASURE 56 (Printed 57) ===")
    with zipfile.ZipFile(mxl_path) as z:
        name = [x for x in z.namelist() if x.endswith('.xml') and not x.startswith('META-INF')][0]
        root = ET.fromstring(z.read(name))
    ns = ""
    if root.tag.startswith('{'):
        ns = root.tag[1:root.tag.index('}')]
    q = lambda tag: f'{{{ns}}}{tag}' if ns else tag
    
    for part in root.findall(q('part')):
        part_id = part.get('id')
        m = part.find(f'./{q("measure")}[@number="56"]')
        if m is None:
            continue
        print(f"  Part: {part_id}")
        notes_by_staff_voice = {}
        for n in m.findall(q('note')):
            staff = n.find(q('staff'))
            staff_txt = staff.text if staff is not None else '1'
            voice = n.find(q('voice'))
            voice_txt = voice.text if voice is not None else '1'
            key = (staff_txt, voice_txt)
            if key not in notes_by_staff_voice:
                notes_by_staff_voice[key] = []
            notes_by_staff_voice[key].append(n)
            
        for (staff, voice), notes in sorted(notes_by_staff_voice.items()):
            print(f"    Staff: {staff}, Voice: {voice}")
            total_dur = 0
            for idx, n in enumerate(notes):
                pitch = n.find(q('pitch'))
                rest = n.find(q('rest')) is not None
                chord = n.find(q('chord')) is not None
                dur_el = n.find(q('duration'))
                dur = int(dur_el.text) if dur_el is not None and dur_el.text else 0
                if not chord:
                    total_dur += dur
                
                desc = "Rest" if rest else (f"{pitch.find(q('step')).text}{pitch.find(q('octave')).text}" if pitch is not None else "Chord")
                chord_str = " [CHORD]" if chord else ""
                tmod = n.find(q('time-modification'))
                tmod_str = " tmod" if tmod is not None else ""
                print(f"      [{idx}] {desc:6} Dur={dur:2}{chord_str}{tmod_str}")
            print(f"      Total voice duration: {total_dur}")

if __name__ == '__main__':
    inspect_all_parts('noon_fixed.mxl')
