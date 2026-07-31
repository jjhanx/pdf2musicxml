import zipfile
import xml.etree.ElementTree as ET
import re

def inspect_mxl_or_xml(filepath):
    # Print safe representation of filename to avoid Windows CP949 encoding errors
    safe_name = filepath.encode('ascii', errors='replace').decode('ascii')
    print(f"\n==================== {safe_name} ====================")
    try:
        if filepath.lower().endswith('.mxl'):
            with zipfile.ZipFile(filepath) as z:
                # Find root file
                try:
                    container = z.read("META-INF/container.xml").decode("utf-8")
                    m = re.search(r'full-path="([^"]+)"', container)
                    name = m.group(1)
                except Exception:
                    names = [n for n in z.namelist() if n.lower().endswith(".xml") and not n.startswith("META-INF/")]
                    names.sort(key=len)
                    name = names[0]
                data = z.read(name)
                root = ET.fromstring(data)
        else:
            tree = ET.parse(filepath)
            root = tree.getroot()
    except Exception as e:
        print(f"Error reading file: {e}")
        return

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
        # Try P1
        for part in root.findall(q('part')):
            if part.get('id') == 'P1':
                piano = part
                break

    if piano is None:
        print("Piano part not found")
        return

    for m_num in ('6', '30', '52'):
        measure = piano.find(f".//{q('measure')}[@number='{m_num}']")
        if measure is None:
            print(f"Measure {m_num} not found")
            continue
        print(f"--- Measure {m_num} ---")
        for idx, note in enumerate(measure.findall(q('note'))):
            staff = note.find(q('staff')).text if note.find(q('staff')) is not None else '1'
            voice = note.find(q('voice')).text if note.find(q('voice')) is not None else '1'
            pitch_el = note.find(q('pitch'))
            step = pitch_el.find(q('step')).text if pitch_el is not None else 'Rest'
            octave = pitch_el.find(q('octave')).text if pitch_el is not None else ''
            ch = 'Chord' if note.find(q('chord')) is not None else 'Lead '
            stem_el = note.find(q('stem'))
            stem = stem_el.text if stem_el is not None else 'None'
            slurs = []
            notations = note.find(q('notations'))
            if notations is not None:
                for s in notations.findall(q('slur')):
                    slurs.append(f"{s.get('type')},{s.get('number')},{s.get('placement')},def_y={s.get('default-y')}")
            print(f"[{idx:2d}] S{staff} V{voice} {ch:5s} {step}{octave} stem:{stem:4s} slurs: {slurs}")

for f in ['noon.mxl', 'scratch/test-fix-noon.mxl']:
    inspect_mxl_or_xml(f)
