import zipfile, xml.etree.ElementTree as ET
import sys

def dump_file(mxl_path):
    print(f"=== {mxl_path} ===")
    try:
        with zipfile.ZipFile(mxl_path) as z:
            name = [x for x in z.namelist() if x.endswith('.xml') and not x.startswith('META-INF')][0]
            root = ET.fromstring(z.read(name))
    except Exception as e:
        print(f"Error reading {mxl_path}: {e}")
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
            staff_txt = staff.text if staff is not None else '?'
            pitch = n.find(q('pitch'))
            rest = n.find(q('rest'))
            voice = n.find(q('voice'))
            dur = n.find(q('duration'))
            chord = n.find(q('chord')) is not None
            if rest is not None:
                desc = 'Rest'
            elif pitch is not None:
                step_el = pitch.find(q("step"))
                oct_el = pitch.find(q("octave"))
                step = step_el.text if step_el is not None else '?'
                octave = oct_el.text if oct_el is not None else '?'
                desc = f'{step}{octave}'
            elif chord:
                desc = 'Chord'
            else:
                desc = '?'
            v = voice.text if voice is not None else '?'
            d = dur.text if dur is not None else '?'
            tmod = n.find(q('time-modification'))
            tmod_desc = 'TimeMod' if tmod is not None else ''
            tuplet = [t.get('type') for t in n.findall(f'.//{q("tuplet")}')]
            print(f'[{idx}] {desc:6} Dur: {d:3} Voice: {v:2} Staff: {staff_txt} {tmod_desc:8} Tuplets: {tuplet}')

if __name__ == '__main__':
    dump_file('noon.mxl')
    dump_file('noon_fixed.mxl')
    dump_file(r'C:\Users\jjhan\.gemini\antigravity-ide\brain\6a7ff7c1-5510-4b4a-9349-3e2fa4be2604\scratch\omr-work-0ef63451\audiveris_raw.mxl')
