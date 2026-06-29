import xml.etree.ElementTree as ET

tree = ET.parse('noon.xml')
root = tree.getroot()
ns = ''
t = root.tag
if t.startswith("{"):
    ns = t[1 : t.index("}")]

def q(local):
    return f"{{{ns}}}{local}" if ns else local

piano = None
for part in root.findall(q('part')):
    pid = part.get('id')
    pname = ''
    score_part = root.find(f".//{q('score-part')}[@id='{pid}']")
    if score_part is not None:
        name_el = score_part.find(q('part-name'))
        if name_el is not None:
            pname = name_el.text
    if 'piano' in pname.lower() or pid in ('P5', 'P6', 'P'):
        piano = part
        break

measure = piano.find(f".//{q('measure')}[@number='48']")
print("--- Reference Measure 48 Notes ---")
for idx, note in enumerate(measure.findall(q('note'))):
    staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
    if staff != '1':
        continue
    pitch_el = note.find(q('pitch'))
    step = pitch_el.find(q('step')).text if pitch_el is not None else 'Rest'
    octave = pitch_el.find(q('octave')).text if pitch_el is not None else ''
    alter_el = pitch_el.find(q('alter'))
    alter = f"({alter_el.text})" if alter_el is not None else ""
    acc = note.find(q('accidental')).text if note.find(q('accidental')) is not None else ''
    ch = 'Chord' if note.find(q('chord')) is not None else '     '
    print(f"[{idx}] {ch} Pitch:{step}{alter}{octave:<2} Acc:{acc}")
