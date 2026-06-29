#!/usr/bin/env python3
"""Directions and tuplet show-number in measures 13-15."""
import zipfile, xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path('_smoke/dbgzip/masked_input.mvt1_merged.mxl')
with zipfile.ZipFile(mxl) as z:
    names = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META-INF')]
    root = ET.fromstring(z.read(names[0]))
ns = root.tag[1:root.tag.index('}')] if root.tag.startswith('{') else ''

def q(t):
    return f'{{{ns}}}{t}' if ns else t

def local(el):
    t = el.tag
    return t[t.index('}')+1:] if t.startswith('{') else t

for part in root.findall(q('part')):
    if part.get('id') != 'P5':
        continue
    for m in part.findall(q('measure')):
        mn = m.get('number')
        if mn not in ('13', '14', '15', '16'):
            continue
        print(f'\n=== measure {mn} directions ===')
        for d in m.findall(q('direction')):
            parts = []
            for el in d.iter():
                if local(el) in ('words', 'text', 'syllable', 'rehearsal'):
                    if el.text and el.text.strip():
                        parts.append(repr(el.text.strip()))
                elif local(el) not in ('direction', 'direction-type', 'offset', 'staff', 'voice'):
                    parts.append(f'<{local(el)}>')
            print(' ', ' | '.join(parts) if parts else '(empty)')
