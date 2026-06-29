#!/usr/bin/env python3
xml = open('_smoke/m13_p5.xml', encoding='utf-16').read()
header = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>Piano</part-name></score-part></part-list>
  <part id="P5">
"""
attrs = (
    '<attributes><divisions>6</divisions><key><fifths>2</fifths></key>'
    '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>'
    '<clef number="1"><sign>G</sign><line>2</line></clef>'
    '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
)
m13 = xml.replace('<measure number="13" width="276">', '<measure number="13">' + attrs, 1)
out = header + m13 + "\n  </part>\n</score-partwise>"
open('_smoke/m13_score.xml', 'w', encoding='utf-8').write(out)
print('written', len(out))
