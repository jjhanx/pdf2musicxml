import zipfile, xml.etree.ElementTree as ET

def dump_m56(path):
    print('===', path, '===')
    with zipfile.ZipFile(path) as z:
        name = [x for x in z.namelist() if x.endswith('.xml') and not x.startswith('META-INF')][0]
        root = ET.fromstring(z.read(name))
    ns = ""
    if root.tag.startswith('{'):
        ns = root.tag[1:root.tag.index('}')]
    q = lambda tag: f'{{{ns}}}{tag}' if ns else tag
    for part in root.findall(q('part')):
        if part.get('id') != 'P5':
            continue
        m = part.find(f'./{q("measure")}[@number="56"]')
        if m is not None:
            for idx, n in enumerate(m.findall(q('note'))):
                staff = n.find(q('staff'))
                staff_txt = staff.text if staff is not None else '?'
                if staff_txt == '2':
                    pitch = n.find(q('pitch'))
                    rest = n.find(q('rest')) is not None
                    voice = n.find(q('voice')).text if n.find(q('voice')) is not None else '?'
                    dur = n.find(q('duration')).text if n.find(q('duration')) is not None else '?'
                    chord = n.find(q('chord')) is not None
                    desc = 'Rest' if rest else (f'{pitch.find(q("step")).text}{pitch.find(q("octave")).text}' if pitch is not None else 'Chord')
                    chord_str = ' [CHORD]' if chord else ''
                    print(f'[{idx}] {desc:6} Dur={dur} Voice={voice}{chord_str}')

if __name__ == '__main__':
    dump_m56('noon.mxl')
    dump_m56('noon_fixed.mxl')
