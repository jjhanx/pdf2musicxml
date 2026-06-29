content = open('scripts/fix_audiveris_mxl.py', encoding='utf-8').read()
new_content = content.replace('''            if not is_underfull:
                stats["three_eighth_triplet_fixed"] += _general_resolve_overfull_measure(
                    measure, ns, max_staff, divisions or 0, expected or 0
                )
                stats["three_eighth_triplet_fixed"] += _repair_three_eighths_as_triplet(
                    measure, ns, max_staff, divisions or 0
                )
                stats["three_eighth_triplet_fixed"] += _repair_four_eighths_as_triplet_plus_eighth(
                    measure, ns, divisions or 0
                )
                stats["quarter_pair_eighth_fixed"] += _repair_quarter_pair_before_eighths(
                    measure, ns, divisions or 0, expected or 0
                )''', '''            stats["three_eighth_triplet_fixed"] += _general_resolve_overfull_measure(
                measure, ns, max_staff, divisions or 0, expected or 0
            )
            stats["three_eighth_triplet_fixed"] += _repair_three_eighths_as_triplet(
                measure, ns, max_staff, divisions or 0
            )
            stats["three_eighth_triplet_fixed"] += _repair_four_eighths_as_triplet_plus_eighth(
                measure, ns, divisions or 0
            )
            stats["quarter_pair_eighth_fixed"] += _repair_quarter_pair_before_eighths(
                measure, ns, divisions or 0, expected or 0
            )''')
open('scripts/fix_audiveris_mxl.py', 'w', encoding='utf-8').write(new_content)
print('Done!')
