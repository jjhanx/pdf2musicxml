#!/usr/bin/env python3
"""mvt1 P5 measure 13의 원본 XML 조각 추출."""
import re
import zipfile
from pathlib import Path

mxl = Path('D:/pdf2musicxml/_smoke/dbgzip/masked_input.mvt1_merged.mxl')
with zipfile.ZipFile(mxl) as z:
    names = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META-INF')]
    xml = z.read(names[0]).decode('utf-8')

# part P5 블록
m = re.search(r'<part id="P5">.*?</part>', xml, re.S)
part = m.group(0)
mm = re.search(r'<measure number="13".*?</measure>', part, re.S)
print(mm.group(0))
