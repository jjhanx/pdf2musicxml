import zipfile
import io
import xml.etree.ElementTree as ET
import sys
from pathlib import Path
import json

sys.path.append('scripts')
from restructure_mxl_parts import restructure_mxl

xml_data = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>256</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>
"""
with zipfile.ZipFile('scratch/test_homr.mxl', 'w') as z:
    z.writestr('score.xml', xml_data)
    z.writestr('META-INF/container.xml', """<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>""")

with open('scratch/labels.json', 'w') as f:
    json.dump({'labelsByIndex': ['SA', 'TB', 'P']}, f)

restructure_mxl(Path('scratch/test_homr.mxl'), Path('scratch/test_homr_out.mxl'), Path('scratch/labels.json'))
