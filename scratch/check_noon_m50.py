import xml.etree.ElementTree as ET
import zipfile
import re
import io

def inspect_m50_ref(filepath):
    print(f"\n==================== REFERENCE: {filepath} ====================")
    if filepath.endswith('.mxl'):
        with zipfile.ZipFile(filepath, 'r') as z:
            container_xml = z.read("META-INF/container.xml").decode("utf-8")
            match = re.search(r'full-path="([^"]+)"', container_xml)
            root_file = match.group(1)
            xml_data = z.read(root_file)
            tree = ET.parse(io.BytesIO(xml_data))
    else:
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
        # Usually it's the last part or contains Piano/P
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
    
    if piano is None:
        # fallback to the last part
        piano = root.findall(q('part'))[-1]

    # Find measure 50 or 51 (check both since numbers might be shifted)
    for m_num in ('50', '51'):
        measure = piano.find(f".//{q('measure')}[@number='{m_num}']")
        if measure is None:
            continue
        print(f"\n--- XML Measure {m_num} ---")
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

inspect_m50_ref('noon.xml')
inspect_m50_ref('눈\xa0김효근\xa04부\xa010쪽.mxl')
