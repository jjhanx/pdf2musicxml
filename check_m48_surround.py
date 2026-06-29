import xml.etree.ElementTree as ET
tree = ET.parse('omr-work-10ce5694/raw.xml')
for m in ['47', '48', '49', '50']:
    meas = tree.find(f'.//part[@id="P5"]/measure[@number="{m}"]')
    notes = meas.findall('note')
    pr_chords = []
    current_chord = []
    for n in notes:
        st = n.find('staff').text if n.find('staff') is not None else '?'
        if st == '1':
            p = n.find('pitch')
            if p is not None:
                step = p.find('step').text
                c = 'C' if n.find('chord') is not None else ' '
                if c == ' ' and current_chord:
                    pr_chords.append(current_chord)
                    current_chord = []
                current_chord.append(step)
    if current_chord:
        pr_chords.append(current_chord)
    print(f'M{m} PR has {len(pr_chords)} chords: {pr_chords}')
