#!/usr/bin/env python3
import re
import zipfile

with zipfile.ZipFile('_smoke/dbgzip/test_norm.mxl') as z:
    names = [n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META-INF')]
    xml = z.read(names[0]).decode('utf-8')

part = re.search(r'<part id="P5">.*?</part>', xml, re.S).group(0)
m13 = re.search(r'<measure number="13".*?</measure>', part, re.S).group(0)
print('staccato in m13 P5:', 'staccato' in m13)
print('tuplet kept:', '<tuplet' in m13, '| time-modification kept:', 'time-modification' in m13)
