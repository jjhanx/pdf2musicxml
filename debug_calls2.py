content = open('scripts/fix_audiveris_mxl.py', encoding='utf-8').read()
modified = content.replace('stats["three_eighth_triplet_fixed"] += _repair_three_eighths_as_triplet(
                    measure, ns, max_staff, divisions or 0
                )', 'val = _repair_three_eighths_as_triplet(measure, ns, max_staff, divisions or 0)\n                if val > 0: print("FIXED in M" + str(measure.get("number")), "val=", val)\n                stats["three_eighth_triplet_fixed"] += val')
with open('scripts/fix_audiveris_mxl_debug.py', 'w', encoding='utf-8') as f:
    f.write(modified)
