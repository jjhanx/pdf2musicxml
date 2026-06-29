import re
content = open('scripts/fix_audiveris_mxl.py', encoding='utf-8').read()
modified = content.replace('_ensure_tuplet_bracket(', 'print("TUPLET ADDED by " + sys._getframe().f_code.co_name + " on M" + measure.get("number", "")); _ensure_tuplet_bracket(')
with open('scripts/fix_audiveris_mxl_debug.py', 'w', encoding='utf-8') as f:
    f.write('import sys\n' + modified)
