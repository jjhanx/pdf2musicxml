#!/usr/bin/env python3
"""Probe m6 slurs, m11 rhythm, m14 tuplet/directions."""
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
    pid = part.get('id')
    pname = ''
    for sp in root.findall(f'.//{q("score-part")}'):
        if sp.get('id') == pid:
            pn = sp.find(q('part-name'))
            pname = pn.text if pn is not None else ''
    for m in part.findall(q('measure')):
        mn = m.get('number')
        if mn not in ('6', '11', '13', '14', '15'):
            continue
        attrs = m.find(q('attributes'))
        time_s = ''
        div_s = ''
        if attrs is not None:
            div = attrs.find(q('divisions'))
            if div is not None:
                div_s = div.text or ''
            time = attrs.find(q('time'))
            if time is not None:
                b = time.find(q('beats'))
                bt = time.find(q('beat-type'))
                time_s = f"{b.text}/{bt.text}" if b is not None and bt is not None else ''
        print(f'\n=== part {pid} ({pname}) m{mn} div={div_s} time={time_s} ===')
        for d in m.findall(q('direction')):
            txt = []
            for el in d.iter():
                if local(el) in ('words', 'text') and el.text and el.text.strip():
                    txt.append(repr(el.text.strip()))
            if txt:
                print('  DIR', txt)
        for i, note in enumerate(m.findall(q('note'))):
            if note.find(q('chord')) is not None:
                continue
            v = note.find(q('voice'))
            st = note.find(q('staff'))
            p = note.find(q('pitch'))
            pitch = 'Rest'
            if p is not None:
                pitch = (p.find(q('step')).text or '') + (p.find(q('octave')).text or '')
            typ = note.find(q('type'))
            dur = note.find(q('duration'))
            dots = len(note.findall(q('dot')))
            slurs = [(s.get('number'), s.get('type')) for n in note.findall(q('notations')) for s in n.findall(q('slur'))]
            tm = note.find(q('time-modification'))
            tm_s = ''
            if tm is not None:
                an = tm.find(q('actual-notes'))
                tm_s = f' tm={an.text if an is not None else "?"}'
            tup = []
            for n in note.findall(q('notations')):
                for t in n.findall(q('tuplet')):
                    tup.append(f"tuplet:{t.get('type')} show={t.get('show-number')}")
            print(f"  #{i} v={v.text if v else '-'} st={st.text if st else '-'} {pitch} type={typ.text if typ is not None else '-'} dur={dur.text if dur is not None else '-'} dots={dots}{tm_s} slur={slurs} {tup}")
