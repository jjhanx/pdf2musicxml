import sys
content = open('scripts/fix_audiveris_mxl.py', encoding='utf-8').read()
start = content.find('stats["three_eighth_triplet_fixed"] += _repair_three_eighths_as_triplet')
print(content[start-500:start+500])
