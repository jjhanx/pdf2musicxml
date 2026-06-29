#!/usr/bin/env python3
import zipfile, re
from pathlib import Path
mxl = Path('_smoke/dbgzip/masked_input.mvt1_merged.mxl')
with zipfile.ZipFile(mxl) as z:
    names = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META-INF')]
    xml = z.read(names[0]).decode('utf-8')
for m in ('10', '11', '12', '13', '14', '15'):
    mm = re.search(r'<measure number="' + m + r'".*?</measure>', xml, re.S)
    if not mm:
        continue
    block = mm.group(0)
    words = re.findall(r'<words[^>]*>([^<]+)</words>', block)
    if words:
        print('m' + m + ' words:', words)
