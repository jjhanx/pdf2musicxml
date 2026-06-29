#!/usr/bin/env python3
"""Measure 6 ties/slurs and measures 14-16 triplets in debug MXL."""
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

def load_xml(mxl_path):
    with zipfile.ZipFile(mxl_path) as z:
        names = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META-INF')]
        return ET.fromstring(z.read(names[0]))

def q(ns, t):
    return f'{{{ns}}}{t}' if ns else t

def ns_uri(root):
    t = root.tag
    return t[1:t.index('}')] if t.startswith('{') else ''

def local(el):
    t = el.tag
    return t[t.index('}')+1:] if t.startswith('{') else t

def pitch_str(note, ns):
    p = note.find(q(ns, 'pitch'))
    if p is None:
        return 'Rest'
    step = p.find(q(ns, 'step'))
    oct = p.find(q(ns, 'octave'))
    alt = p.find(q(ns, 'alter'))
    s = step.text if step is not None else '?'
    o = oct.text if oct is not None else '?'
    a = alt.text if alt is not None else None
    return f"{s}{'#' if a=='1' else 'b' if a=='-1' else ''}{o}"

def note_info(note, ns, idx):
    voice = note.find(q(ns, 'voice'))
    staff = note.find(q(ns, 'staff'))
    ties = []
    slurs = []
    for n in note.findall(q(ns, 'notations')):
        for t in n.findall(q(ns, 'tie')):
            ties.append(t.get('type'))
        for s in n.findall(q(ns, 'slur')):
            slurs.append(f"slur#{s.get('number')}:{s.get('type')}")
    tm = note.find(q(ns, 'time-modification'))
    tm_s = ''
    if tm is not None:
        an = tm.find(q(ns, 'actual-notes'))
        nn = tm.find(q(ns, 'normal-notes'))
        tm_s = f" tm={an.text}:{nn.text}" if an is not None and nn is not None else ' tm=?'
    tuplet = []
    for n in note.findall(q(ns, 'notations')):
        for t in n.findall(q(ns, 'tuplet')):
            tuplet.append(f"tuplet:{t.get('type')} show={t.get('show-number')} num={t.get('number')}")
    arts = []
    for n in note.findall(q(ns, 'notations')):
        for a in n.findall('.//'):
            if local(a) in ('staccato', 'accent', 'tenuto'):
                arts.append(f"{local(a)}({a.get('placement')})")
    return {
        'idx': idx,
        'pitch': pitch_str(note, ns),
        'voice': voice.text if voice is not None else '-',
        'staff': staff.text if staff is not None else '-',
        'ties': ties,
        'slurs': slurs,
        'tm': tm_s,
        'tuplet': tuplet,
        'arts': arts,
    }

def dump_measure(root, ns, part_id, measure_no):
    for part in root.findall(q(ns, 'part')):
        if part.get('id') != part_id:
            continue
        for m in part.findall(q(ns, 'measure')):
            if m.get('number') != str(measure_no):
                continue
            print(f"\n=== part {part_id} measure {measure_no} ===")
            dirs = []
            for d in m.findall(q(ns, 'direction')):
                txt = []
                for el in d.iter():
                    if local(el) in ('words', 'text'):
                        if el.text and el.text.strip():
                            txt.append(el.text.strip())
                dirs.append(' '.join(txt) if txt else '(non-text direction)')
            if dirs:
                print('  directions:', dirs)
            notes = m.findall(q(ns, 'note'))
            for i, note in enumerate(notes):
                info = note_info(note, ns, i)
                if note.find(q(ns, 'chord')) is not None:
                    continue
                extra = ''
                if info['ties']:
                    extra += f" tie={info['ties']}"
                if info['slurs']:
                    extra += f" {info['slurs']}"
                if info['tm']:
                    extra += info['tm']
                if info['tuplet']:
                    extra += f" {info['tuplet']}"
                if info['arts']:
                    extra += f" arts={info['arts']}"
                print(f"  #{i} v={info['voice']} st={info['staff']} {info['pitch']}{extra}")

def find_piano_part(root, ns):
    for sp in root.findall(f'.//{q(ns, "score-part")}'):
        name = sp.find(q(ns, 'part-name'))
        pid = sp.get('id')
        nm = (name.text or '').strip() if name is not None else ''
        if nm.lower() in ('p', 'piano', 'pl', 'pr') or 'piano' in nm.lower():
            print(f"  score-part {pid}: {nm}")

for mxl in [
    Path('_smoke/dbgzip/masked_input.mvt1_merged.mxl'),
    Path('_smoke/dbgzip/test_norm.mxl'),
    Path('_smoke/dbgzip/test_fixed_pipeline.mxl'),
]:
    if not mxl.exists():
        print(f"SKIP {mxl}")
        continue
    print(f"\n######## {mxl.name} ########")
    root = load_xml(mxl)
    ns = ns_uri(root)
    find_piano_part(root, ns)
    dump_measure(root, ns, 'P5', 6)
    for mn in (13, 14, 15):
        dump_measure(root, ns, 'P5', mn)
