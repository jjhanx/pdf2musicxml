#!/usr/bin/env python3
"""Full measure 6 voice 1 notes including chords."""
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path('_smoke/dbgzip/masked_input.mvt1_merged.mxl')
with zipfile.ZipFile(mxl) as z:
    names = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META-INF')]
    root = ET.fromstring(z.read(names[0]))

def q(ns, t):
    return f'{{{ns}}}{t}' if ns else t

ns = root.tag[1:root.tag.index('}')] if root.tag.startswith('{') else ''

for part in root.findall(q(ns, 'part')):
    if part.get('id') != 'P5':
        continue
    for m in part.findall(q(ns, 'measure')):
        if m.get('number') != '6':
            continue
        print('=== P5 measure 6 ALL notes v=1 ===')
        n = 0
        for note in m.findall(q(ns, 'note')):
            voice = note.find(q(ns, 'voice'))
            if voice is None or voice.text != '1':
                continue
            n += 1
            chord = note.find(q(ns, 'chord')) is not None
            p = note.find(q(ns, 'pitch'))
            pitch = 'Rest'
            if p is not None:
                step = p.find(q(ns, 'step')).text
                oct = p.find(q(ns, 'octave')).text
                alt = p.find(q(ns, 'alter'))
                pitch = f"{step}{'#' if alt is not None and alt.text=='1' else ''}{oct}"
            ties = [t.get('type') for t in note.findall('.//') if t.tag.endswith('tie')]
            slurs = [f"{s.get('number')}:{s.get('type')}" for s in note.findall('.//') if s.tag.endswith('slur')]
            print(f"  note{n} xml_idx={list(m).index(note)} {'(chord)' if chord else ''} {pitch} tie={ties} slur={slurs}")
