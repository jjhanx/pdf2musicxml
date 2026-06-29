#!/usr/bin/env python3
import zipfile, xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path('_smoke/dbgzip/masked_input.mvt1_merged.mxl')
with zipfile.ZipFile(mxl) as z:
    names = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META-INF')]
    root = ET.fromstring(z.read(names[0]))
ns = root.tag[1:root.tag.index('}')] if root.tag.startswith('{') else ''

def q(t):
    return f'{{{ns}}}{t}'

for part in root.findall(q('part')):
    if part.get('id') != 'P5':
        continue
    for m in part.findall(q('measure')):
        if m.get('number') != '6':
            continue
        print('ALL notes measure 6 (editor index = position among <note> elements)')
        for i, note in enumerate(m.findall(q('note'))):
            v = note.find(q('voice'))
            st = note.find(q('staff'))
            chord = note.find(q('chord')) is not None
            p = note.find(q('pitch'))
            pitch = 'Rest'
            if p is not None:
                step = p.find(q('step')).text
                oct = p.find(q('octave')).text
                alt = p.find(q('alter'))
                pitch = f"{step}{'#' if alt is not None and alt.text=='1' else ''}{oct}"
            print(f"  #{i} v={v.text if v is not None else '-'} st={st.text if st is not None else '-'} {'chord ' if chord else ''}{pitch}")
