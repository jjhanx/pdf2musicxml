content = open('scripts/fix_audiveris_mxl.py', encoding='utf-8').read()
modified = content.replace('stats["three_eighth_triplet_fixed"] += _repair_three_eighths_as_triplet(', 'print("M47?", measure.get("number")); stats["three_eighth_triplet_fixed"] += _repair_three_eighths_as_triplet(')
with open('scripts/fix_audiveris_mxl_debug.py', 'w', encoding='utf-8') as f:
    f.write(modified)
