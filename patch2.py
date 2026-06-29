import re
with open('d:/pdf2musicxml/scripts/fix_audiveris_mxl.py', 'r', encoding='utf-8') as f:
    code = f.read()

idx = code.find('def _fix_misread_natural_accidental(')
new_func = '''
def _normalize_accidentals(measure, ns: str, key_fifths: int) -> int:
    fixed = 0
    
    def get_expected_alter(step: str, fifths: int) -> int:
        sharp_order = ('F', 'C', 'G', 'D', 'A', 'E', 'B')
        flat_order = ('B', 'E', 'A', 'D', 'G', 'C', 'F')
        if fifths > 0 and step in sharp_order[:fifths]: return 1
        if fifths < 0 and step in flat_order[:-fifths]: return -1
        return 0

    seen_in_measure = {}
    for n in measure.findall(qname(ns, "note")):
        if _is_rest(n, ns): continue
        pitch = n.find(qname(ns, "pitch"))
        if pitch is None: continue
        step = pitch.find(qname(ns, "step")).text
        octave = pitch.find(qname(ns, "octave")).text
        alter_el = pitch.find(qname(ns, "alter"))
        alter = int(alter_el.text) if alter_el is not None and alter_el.text else 0
        
        acc = n.find(qname(ns, "accidental"))
        if acc is not None:
            acc_type = acc.text.strip() if acc.text else ""
            key = (step, octave)
            
            expected_alter = seen_in_measure.get(key, get_expected_alter(step, key_fifths))
            
            if alter == 0 and acc_type == "natural" and expected_alter == 0:
                n.remove(acc)
                fixed += 1
                
            seen_in_measure[key] = alter
            
    return fixed

'''
code = code[:idx] + new_func + code[idx:]

idx3 = code.find('stats["natural_from_staccato_removed"] += 1\n                changed, to_sharp = _fix_misread_natural_accidental(')
code = code.replace('''                if _remove_duplicate_staccato_as_natural(note, ns):
                    stats["natural_from_staccato_removed"] += 1
                changed, to_sharp = _fix_misread_natural_accidental(
                    note, ns, seen_natural, first_chord_ids
                )
                if changed:
                    if to_sharp:
                        stats["misread_natural_to_sharp"] += 1
                    else:
                        stats["spurious_natural_removed"] += 1''', '''                if _remove_duplicate_staccato_as_natural(note, ns):
                    stats["natural_from_staccato_removed"] += 1
            stats["spurious_natural_removed"] += _normalize_accidentals(measure, ns, key_fifths)''')

with open('d:/pdf2musicxml/scripts/fix_audiveris_mxl.py', 'w', encoding='utf-8') as f:
    f.write(code)
