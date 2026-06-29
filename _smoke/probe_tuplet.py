#!/usr/bin/env python3
"""measure 13, part P의 PL(staff 2) 내용 — 세잇단음표가 어떻게 인코딩됐는지 확인."""
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

def strip_ns(tag):
    return tag.split('}')[-1]

def dump(mxl_path, measure_no):
    with zipfile.ZipFile(mxl_path) as z:
        names = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META-INF')]
        with z.open(names[0]) as f:
            tree = ET.parse(f)
    root = tree.getroot()
    ns = ''
    if root.tag.startswith('{'):
        ns = root.tag[1:root.tag.index('}')]
    def q(t):
        return f'{{{ns}}}{t}' if ns else t

    for part in root.iter(q('part')):
        pid = part.get('id')
        for m in part.iter(q('measure')):
            if m.get('number') != str(measure_no):
                continue
            print(f'== part {pid} measure {m.get("number")} ==')
            for note in m:
                t = strip_ns(note.tag)
                if t != 'note':
                    if t in ('backup', 'forward'):
                        d = note.find(q('duration'))
                        print(f'  <{t}> dur={d.text if d is not None else "?"}')
                    continue
                staff = note.find(q('staff'))
                staff_txt = staff.text if staff is not None else '-'
                rest = note.find(q('rest'))
                pitch = note.find(q('pitch'))
                ptxt = ''
                if pitch is not None:
                    ptxt = (pitch.find(q('step')).text or '') + (pitch.find(q('octave')).text or '')
                dur = note.find(q('duration'))
                typ = note.find(q('type'))
                tm = note.find(q('time-modification'))
                tm_txt = ''
                if tm is not None:
                    an = tm.find(q('actual-notes'))
                    nn = tm.find(q('normal-notes'))
                    tm_txt = f' timeMod={an.text if an is not None else "?"}:{nn.text if nn is not None else "?"}'
                tuplets = []
                notations = note.find(q('notations'))
                extra = []
                if notations is not None:
                    for el in notations.iter():
                        et = strip_ns(el.tag)
                        if et == 'tuplet':
                            tuplets.append(f'tuplet type={el.get("type")} number={el.get("number")} show-number={el.get("show-number")}')
                        elif et in ('articulations', 'notations'):
                            continue
                        else:
                            extra.append(et + (f'[{el.text}]' if el.text and el.text.strip() else ''))
                dots = len(note.findall(q('dot')))
                kind = 'rest' if rest is not None else f'note {ptxt}'
                print(f'  staff={staff_txt} {kind} dur={dur.text if dur is not None else "?"} type={typ.text if typ is not None else "-"} dots={dots}{tm_txt} {" ".join(tuplets)} {("notations:" + ",".join(extra)) if extra else ""}')

if __name__ == '__main__':
    for f in sorted(Path('D:/pdf2musicxml/_smoke/dbgzip').glob('*_merged.mxl')):
        print(f'### {f.name}')
        dump(f, sys.argv[1] if len(sys.argv) > 1 else 13)
