import xml.etree.ElementTree as ET

def verify():
    print("==================== RUNNING PROGRAMMATIC VERIFICATION ====================")
    tree = ET.parse('test-out.xml')
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

    if piano is None:
        raise ValueError("Piano part P5 not found!")

    # 1. Verification of M7 and M31 PR Slurs (XML Measure 6 and 30)
    for m_num in ('6', '30'):
        measure = piano.find(f".//{q('measure')}[@number='{m_num}']")
        if measure is None:
            raise ValueError(f"Measure {m_num} not found!")
        
        # Group notes in PR (staff 1)
        groups = []
        cur_group = []
        for note in measure.findall(q('note')):
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

        # In both XML M6 and M30, we target the 4th and 5th chords (index 3 and 4)
        c4, c5 = groups[3], groups[4]
        
        # Check c4 notes for start slurs
        # bottom note c4[0] should have slur type=start number=1 placement=below
        # top note c4[-1] should have slur type=start number=2 placement=above
        bot_slurs_start = [s for s in c4[0].findall(f".//{q('slur')}") if s.get('type') == 'start']
        top_slurs_start = [s for s in c4[-1].findall(f".//{q('slur')}") if s.get('type') == 'start']
        
        # Check c5 notes for stop slurs
        bot_slurs_stop = [s for s in c5[0].findall(f".//{q('slur')}") if s.get('type') == 'stop']
        top_slurs_stop = [s for s in c5[-1].findall(f".//{q('slur')}") if s.get('type') == 'stop']

        print(f"\n--- XML Measure {m_num} PR Slur Check ---")
        print(f"Chord 4 bottom slur start: {[s.attrib for s in bot_slurs_start]}")
        print(f"Chord 4 top slur start: {[s.attrib for s in top_slurs_start]}")
        print(f"Chord 5 bottom slur stop: {[s.attrib for s in bot_slurs_stop]}")
        print(f"Chord 5 top slur stop: {[s.attrib for s in top_slurs_stop]}")
        
        assert any(s.get('number') == '1' and s.get('placement') == 'below' for s in bot_slurs_start), "Missing bottom start slur"
        assert any(s.get('number') == '2' and s.get('placement') == 'above' for s in top_slurs_start), "Missing top start slur"
        assert any(s.get('number') == '1' and s.get('placement') == 'below' for s in bot_slurs_stop), "Missing bottom stop slur"
        assert any(s.get('number') == '2' and s.get('placement') == 'above' for s in top_slurs_stop), "Missing top stop slur"
        print(f"-> XML Measure {m_num} PR Slurs: PASSED")

    # 2. Verification of PL Tuplet Renumbering (XML Measures 44 and 45)
    for m_num in ('44', '45'):
        measure = piano.find(f".//{q('measure')}[@number='{m_num}']")
        if measure is None:
            raise ValueError(f"Measure {m_num} not found!")
        
        tuplet_numbers = []
        for note in measure.findall(q('note')):
            staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
            if staff != '2': # PL
                continue
            if note.find(q('chord')) is not None:
                continue
            notations = note.find(q('notations'))
            if notations is not None:
                for tuplet in notations.findall(q('tuplet')):
                    tuplet_numbers.append(tuplet.get('number'))
                    
        print(f"\n--- XML Measure {m_num} PL Tuplet Number Check ---")
        print(f"Tuplet numbers: {tuplet_numbers}")
        # XML M44 has 2 triplets (numbers 1, 1, 2, 2)
        # XML M45 has 4 triplets (numbers 1, 1, 2, 2, 3, 3, 4, 4)
        if m_num == '44':
            assert tuplet_numbers == ['1', '1', '2', '2'], f"Incorrect tuplet numbers in M{m_num} PL"
        else:
            assert tuplet_numbers == ['1', '1', '2', '2', '3', '3', '4', '4'], f"Incorrect tuplet numbers in M{m_num} PL"
        print(f"-> XML Measure {m_num} PL Tuplets: PASSED")

    # 3. Verification of M48 (XML Measure 47) PR Eighth Notes
    m47 = piano.find(f".//{q('measure')}[@number='47']")
    if m47 is None:
        raise ValueError("Measure 47 not found!")
    
    # Let's count notes in staff 1 (PR)
    print("\n--- Measure 47 PR Eighth Note / Triplet Check ---")
    pr_notes = []
    for note in m47.findall(q('note')):
        staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
        if staff != '1':
            continue
        if note.find(q('chord')) is not None:
            continue
        dur = note.find(q('duration')).text if note.find(q('duration')) is not None else ''
        ntype = note.find(q('type')).text if note.find(q('type')) is not None else ''
        tm = note.find(q('time-modification')) is not None
        pr_notes.append((dur, ntype, tm))
    
    # We expect:
    # Note 1: dur 9, quarter, no tm (dotted quarter)
    # Note 2: dur 3, eighth, no tm (plain eighth)
    # Note 3: dur 3, eighth, no tm (plain eighth)
    # Note 4: dur 3, eighth, no tm (plain eighth)
    # Note 5: dur 3, eighth, no tm (plain eighth)
    # Note 6: dur 3, eighth, no tm (plain eighth)
    print(f"PR Notes (dur, type, has_tm): {pr_notes}")
    # Expected note lengths
    expected_notes = [('9', 'quarter', False), ('3', 'eighth', False), ('3', 'eighth', False), ('3', 'eighth', False), ('3', 'eighth', False), ('3', 'eighth', False)]
    assert pr_notes == expected_notes, "Eighth notes were incorrectly converted to a triplet in Measure 47 PR!"
    print("-> M47 PR Eighth Notes: PASSED")

    # 4. Verification of M51 (XML Measure 50) PR Chord 1 & 2 Accidentals
    m50 = piano.find(f".//{q('measure')}[@number='50']")
    if m50 is None:
        raise ValueError("Measure 50 not found!")
    
    # Group notes in PR (staff 1)
    groups = []
    cur_group = []
    for note in m50.findall(q('note')):
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

    print("\n--- Measure 50 PR Chords & Accidentals Check ---")
    
    # Chord 1 notes
    c1_notes = []
    for n in groups[0]:
        pitch_el = n.find(q('pitch'))
        step = pitch_el.find(q('step')).text if pitch_el is not None else ''
        acc = n.find(q('accidental')).text if n.find(q('accidental')) is not None else ''
        c1_notes.append(f"{step}(Acc:{acc})")
    print(f"Chord 1: {', '.join(c1_notes)}")
    
    # Chord 2 notes
    c2_notes = []
    for n in groups[1]:
        pitch_el = n.find(q('pitch'))
        step = pitch_el.find(q('step')).text if pitch_el is not None else ''
        acc = n.find(q('accidental')).text if n.find(q('accidental')) is not None else ''
        c2_notes.append(f"{step}(Acc:{acc})")
    print(f"Chord 2: {', '.join(c2_notes)}")

    # We expect:
    # Chord 1 should have B, D, G, B (no F and no D#). None of them should have accidental.
    # Chord 2 should have A, D, A. None of them should have accidental (specifically no natural on D).
    # Chord 1: B4, D#5, F#5, B5
    for n in groups[0]:
        pitch_el = n.find(q('pitch'))
        step = pitch_el.find(q('step')).text
        alter_el = pitch_el.find(q('alter'))
        alter = int(alter_el.text) if alter_el is not None else 0
        acc_el = n.find(q('accidental'))
        acc = acc_el.text if acc_el is not None else None
        
        assert step in ('B', 'D', 'F'), f"Unexpected note {step} in B Major Chord 1"
        if step == 'D':
            assert alter == 1, "D note should have alter=1 (D#)"
            assert acc == 'sharp', f"D note should have sharp accidental, got {acc}"
        elif step == 'F':
            assert alter == 1, "F note should have alter=1 (F#)"
            assert acc is None, f"F note should have no accidental, got {acc}"
        elif step == 'B':
            assert alter == 0, "B note should have alter=0"
            assert acc is None, f"B note should have no accidental, got {acc}"

    # Chord 2: A4, D5 (natural), A5
    for n in groups[1]:
        pitch_el = n.find(q('pitch'))
        step = pitch_el.find(q('step')).text
        alter_el = pitch_el.find(q('alter'))
        alter = int(alter_el.text) if alter_el is not None else 0
        acc_el = n.find(q('accidental'))
        acc = acc_el.text if acc_el is not None else None
        
        assert step in ('A', 'D'), f"Unexpected note {step} in Chord 2"
        if step == 'D':
            assert alter == 0, "D note should have alter=0 (D-natural)"
            assert acc == 'natural', f"D note should have natural accidental to cancel the sharp, got {acc}"
        elif step == 'A':
            assert alter == 0, "A note should have alter=0"
            assert acc is None, f"A note should have no accidental, got {acc}"

    print("-> M50 PR Chords & Accidentals: PASSED")
    print("\n==================== ALL CHECKS PASSED SUCCESSFULLY! ====================")

if __name__ == '__main__':
    verify()
