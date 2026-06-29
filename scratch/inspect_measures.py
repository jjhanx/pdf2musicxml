import xml.etree.ElementTree as ET
import sys

def inspect_xml(filepath, label, out):
    out.write(f"\n==================== INSPECTING {label}: {filepath} ====================\n")
    tree = ET.parse(filepath)
    root = tree.getroot()
    ns = ''
    t = root.tag
    if t.startswith("{"):
        ns = t[1 : t.index("}")]

    def q(local):
        return f"{{{ns}}}{local}" if ns else local

    def note_info(note):
        pitch_el = note.find(q('pitch'))
        if pitch_el is not None:
            step = pitch_el.find(q('step')).text
            octave = pitch_el.find(q('octave')).text
            alter_el = pitch_el.find(q('alter'))
            alter = f"({alter_el.text})" if alter_el is not None else ""
            pitch = f"{step}{alter}{octave}"
        else:
            pitch = "Rest" if note.find(q('rest')) is not None else "Unknown"

        voice = note.find(q('voice')).text if note.find(q('voice')) is not None else 'None'
        staff = note.find(q('staff')).text if note.find(q('staff')) is not None else 'None'
        dur = note.find(q('duration')).text if note.find(q('duration')) is not None else 'None'
        ntype = note.find(q('type')).text if note.find(q('type')) is not None else 'None'
        chord = "Chord" if note.find(q('chord')) is not None else "     "
        
        acc = note.find(q('accidental')).text if note.find(q('accidental')) is not None else ''
        acc_str = f" Acc:{acc}" if acc else ""

        beams = [b.text for b in note.findall(q('beam'))]
        beam_str = f" Beams:{beams}" if beams else ""

        slurs = []
        ties = []
        tuplets = []
        notations = note.find(q('notations'))
        if notations is not None:
            for s in notations.findall(q('slur')):
                slurs.append(f"Slur({s.get('type')},{s.get('number')})")
            for t in notations.findall(q('tied')):
                ties.append(f"Tied({t.get('type')})")
            for tup in notations.findall(q('tuplet')):
                tuplets.append(f"Tuplet({tup.get('type')},{tup.get('number')})")
        
        notations_str = ""
        if slurs: notations_str += f" Slurs:{slurs}"
        if ties: notations_str += f" Ties:{ties}"
        if tuplets: notations_str += f" Tuplets:{tuplets}"

        tm = note.find(q('time-modification'))
        tm_str = ""
        if tm is not None:
            act = tm.find(q('actual-notes')).text if tm.find(q('actual-notes')) is not None else '?'
            nrm = tm.find(q('normal-notes')).text if tm.find(q('normal-notes')) is not None else '?'
            tm_str = f" TM:{act}/{nrm}"

        return f"{chord} Pitch:{pitch:<8} Voice:{voice:<2} Staff:{staff:<2} Dur:{dur:<3} Type:{ntype:<8}{acc_str}{beam_str}{notations_str}{tm_str}"

    piano_part = None
    for part in root.findall(q('part')):
        pid = part.get('id')
        if pid == 'P5':
            piano_part = part
            break

    if piano_part is None:
        out.write("Error: Piano part P5 not found!\n")
        return

    # Check key signature
    fifths_val = "unknown"
    for measure in piano_part.findall(q('measure')):
        attr = measure.find(q('attributes'))
        if attr is not None:
            key = attr.find(q('key'))
            if key is not None:
                fifths = key.find(q('fifths'))
                if fifths is not None:
                    fifths_val = fifths.text
                    break
    out.write(f"Piano Part Key Fifths: {fifths_val}\n")

    target_measures = ['7', '31', '45', '47', '48', '51']
    for m_num in target_measures:
        measure = piano_part.find(f".//{q('measure')}[@number='{m_num}']")
        if measure is None:
            out.write(f"Measure {m_num} not found\n")
            continue
        out.write(f"\n--- Measure {m_num} ---\n")
        notes = measure.findall(q('note'))
        out.write(f"Total notes: {len(notes)}\n")
        for idx, note in enumerate(notes):
            out.write(f"[{idx:2d}] {note_info(note)}\n")

with open('scratch/inspect_results.txt', 'w', encoding='utf-8') as out:
    inspect_xml('omr-work-ec9f6685/audiveris_raw.xml', 'RAW AUDIVERIS', out)
    inspect_xml('omr-work-ec9f6685/review.xml', 'REVIEW XML (CURRENT)', out)
