import re

with open('scripts/fix_audiveris_mxl.py', 'r', encoding='utf-8') as f:
    content = f.read()

# We will inject a print statement wherever fixed += 1 occurs
# To avoid syntax issues, we will just use sys._getframe(1).f_code.co_name 
# Wait, let's just do a simple replacement
modified = content.replace('fixed += 1', 'fixed += 1\n            if measure.get("number") == "47": print("M47 modified!")')

with open('scripts/fix_audiveris_mxl_debug.py', 'w', encoding='utf-8') as f:
    f.write('import sys\n' + modified)
