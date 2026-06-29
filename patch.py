import re
with open('d:/pdf2musicxml/scripts/fix_audiveris_mxl.py', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Insert _general_resolve_overfull_measure before _repair_three_eighths_as_triplet
idx1 = code.find('def _repair_three_eighths_as_triplet')
new_func = '''
def _general_resolve_overfull_measure(
    measure, ns: str, max_staff: int, divisions: int, expected: int
) -> int:
    \"\"\"마디가 Overfull일 때, 수학적으로 잇단음표 변환이 정확히 들어맞는 구간을 찾아 범용 보정.\"\"\"
    if not divisions or not expected:
        return 0
    fixed = 0
    for (_, _voice), groups in _voice_groups(measure, ns).items():
        total = sum(_note_duration(g[0], ns) or 0 for g in groups)
        if total <= expected:
            continue
        overflow = total - expected
        eighth = divisions // 2
        quarter = divisions
        
        # Check eighths
        triplet_eighth = max(1, (eighth * 2) // 3)
        eighth_saving = 3 * eighth - 3 * triplet_eighth
        
        # Check quarters
        triplet_quarter = max(1, (quarter * 2) // 3)
        quarter_saving = 3 * quarter - 3 * triplet_quarter

        target_dur = None
        target_saving = 0
        new_type = ''
        new_dur = 0
        
        if eighth_saving > 0 and overflow % eighth_saving == 0:
            target_dur = eighth
            target_saving = eighth_saving
            new_type = 'eighth'
            new_dur = triplet_eighth
        elif quarter_saving > 0 and overflow % quarter_saving == 0:
            target_dur = quarter
            target_saving = quarter_saving
            new_type = 'quarter'
            new_dur = triplet_quarter
            
        if not target_dur:
            continue
            
        num_triplets = overflow // target_saving
        triplets_found = 0
        
        i = 0
        while i <= len(groups) - 3:
            trio = groups[i : i + 3]
            if any(g[0].find(qname(ns, "time-modification")) is not None for g in trio):
                i += 1; continue
            if not all(_note_duration(g[0], ns) == target_dur for g in trio):
                i += 1; continue
                
            for j, grp in enumerate(trio):
                for n in grp[1]:
                    _clear_note_staccato(n, ns)
                    _strip_tuplet_notations(n, ns)
                    _ensure_time_modification(n, ns)
                    _set_note_type_duration(n, ns, new_dur, new_type)
                    if new_type == 'eighth' and not any(_is_rest(g[0], ns) for g in trio):
                        _rebeam_group([n], ns, "begin" if j == 0 else ("end" if j == 2 else "continue"))
            
            has_rest = any(_is_rest(g[0], ns) for g in trio)
            plc = _infer_tuplet_placement(trio[0][0], ns, max_staff)
            _ensure_tuplet_bracket(trio[0][0], ns, plc, trio[2][0], has_rest=has_rest)
            
            fixed += 1
            triplets_found += 1
            i += 3
            if triplets_found >= num_triplets:
                break
    return fixed

'''
code = code[:idx1] + new_func + code[idx1:]

# 2. Insert _extrapolate_chord_ties
idx2 = code.find('def _restore_ties_between_measures')
new_func2 = '''
def _extrapolate_chord_ties(part, ns: str) -> int:
    \"\"\"동일 화음 내 일부 노트만 Tie가 있는 경우 전체 공통 피치로 확장.\"\"\"
    completed = 0
    for measure in part.findall(qname(ns, "measure")):
        for (_, _voice), groups in _voice_groups(measure, ns).items():
            for i in range(len(groups) - 1):
                a_notes = groups[i][1]
                b_notes = groups[i+1][1]
                a_map = _group_pitch_map(a_notes, ns)
                b_map = _group_pitch_map(b_notes, ns)
                common = [p for p in a_map if p in b_map]
                if not common: continue
                
                has_start = any(_note_has_tie(a_map[p], ns, "start") for p in common)
                has_stop = any(_note_has_tie(b_map[p], ns, "stop") for p in common)
                
                if has_start or has_stop:
                    for p in common:
                        if not _note_has_tie(a_map[p], ns, "start"):
                            _add_tie(a_map[p], ns, "start")
                            completed += 1
                        if not _note_has_tie(b_map[p], ns, "stop"):
                            _add_tie(b_map[p], ns, "stop")
    return completed

'''
code = code[:idx2] + new_func2 + code[idx2:]

# 3. Patch fix_score_xml
idx3 = code.find('stats["quarter_pair_eighth_fixed"] += _repair_quarter_pair_before_eighths')
replacement = '''
            # Check for underfull measure bypass
            total_durations = [sum(_note_duration(g[0], ns) or 0 for g in groups) for groups in _voice_groups(measure, ns).values()]
            is_underfull = any(t > 0 and t < expected for t in total_durations)
            
            if not is_underfull:
                stats["three_eighth_triplet_fixed"] += _general_resolve_overfull_measure(
                    measure, ns, max_staff, divisions or 0, expected or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_quarter_pair_before_eighths(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_quarter_pair_after_beam_run(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_quarter_chord_before_rest(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["two_quarter_voice_eighth_fixed"] += _repair_two_quarter_voice_as_eighths(
                    measure, ns, divisions or 0, expected or 0
                )
                stats["three_eighth_triplet_fixed"] += _repair_three_eighths_as_triplet(
                    measure, ns, max_staff, divisions or 0
                )
                stats["rest_eighth_triplet_fixed"] += _repair_eighth_rest_plus_two_eighths_triplet(
                    measure, ns, max_staff, divisions or 0, expected or 0
                )
                stats["triplet_quarter_prefix_repaired"] += _repair_two_quarters_as_triplet_prefix(
                    measure, ns, max_staff, expected or 0
                )
'''
old_block_regex = re.compile(r'stats\["quarter_pair_eighth_fixed"\].*?stats\["triplet_quarter_prefix_repaired"\] \+\= _repair_two_quarters_as_triplet_prefix\([^)]+\)', re.DOTALL)
code = old_block_regex.sub(replacement.strip(), code, count=1)

# 4. Patch _extrapolate_chord_ties call
new_tie_call = '''stats["chord_ties_completed"] += _extrapolate_chord_ties(part, ns)
        completed, system_added = _restore_ties_between_measures(part, ns)'''
code = code.replace('completed, system_added = _restore_ties_between_measures(part, ns)', new_tie_call)

# 5. Prevent overfull eighth from damaging underfull measures
code = code.replace('''            if total != expected + eighth:
                continue''', '''            if total != expected + eighth or total < expected:
                continue''')

with open('d:/pdf2musicxml/scripts/fix_audiveris_mxl.py', 'w', encoding='utf-8') as f:
    f.write(code)
