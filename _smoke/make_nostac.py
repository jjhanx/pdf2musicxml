#!/usr/bin/env python3
import re

data = open('_smoke/m13_score.xml', encoding='utf-8').read()
data = re.sub(r'<notations>\s*<articulations>\s*<staccato[^/]*/>\s*</articulations>\s*</notations>', '', data)
open('_smoke/m13_score_nostac.xml', 'w', encoding='utf-8').write(data)
print('staccato left:', 'staccato' in data)
