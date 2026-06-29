import xml.etree.ElementTree as ET

def inspect_m45(filepath):
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

    measure = piano.find(f".//{q('measure')}[@number='45']")
    if measure is None:
        print("Measure 45 not found")
        return

    # print divisions and time signature
    attr = measure.find(q('attributes'))
    divisions = 'none'
    time_sig = 'none'
    if attr is not None:
        div = attr.find(q('divisions'))
        if div is not None:
            divisions = div.text
        time = attr.find(q('time'))
        if time is not None:
            b = time.find(q('beats')).text
            bt = time.find(q('beat-type')).text
            time_sig = f"{b}/{bt}"
    print(f"Divisions: {divisions}, Time signature: {time_sig}")

    voices = {}
    for note in measure.findall(q('note')):
        ch = note.find(q('chord')) is not None
        v = note.find(q('voice')).text if note.find(q('voice')) is not None else '1'
        s = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
        dur = int(note.find(q('duration')).text) if note.find(q('duration')) is not None else 0
        
        # pitch
        pitch_el = note.find(q('pitch'))
        if pitch_el is not None:
            step = pitch_el.find(q('step')).text
            octave = pitch_el.find(q('octave')).text
            pitch = f"{step}{octave}"
        else:
            pitch = "Rest" if note.find(q('rest')) is not None else "Unknown"

        key = (s, v)
        if key not in voices:
            voices[key] = []
        voices[key].append((pitch, dur, ch))

    for (s, v), notes in sorted(voices.items()):
        print(f"Staff {s}, Voice {v}:")
        total_dur = 0
        chord_notes = []
        for idx, (pitch, dur, ch) in enumerate(notes):
            if ch:
                chord_notes.append(pitch)
            else:
                if chord_notes:
                    print(f"  Chord: {chord_notes}")
                chord_notes = [pitch]
                total_dur += dur
        if chord_notes:
            print(f"  Chord: {chord_notes}")
        print(f"  Voice Total Duration: {total_dur}")

inspect_m45('omr-work-ec9f6685/audiveris_raw.xml')
inspect_m45('omr-work-ec9f6685/review.xml')
