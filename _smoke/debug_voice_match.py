import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import _note_matching_direction_voice, _ns

root = ET.fromstring("""<score-partwise version="3.1">
<part id="P5"><measure number="1">
<attributes/>
<direction><direction-type><words>PL</words></direction-type><voice>5</voice></direction>
<note><staff>1</staff><voice>1</voice></note>
<backup/>
<note><staff>2</staff><voice>5</voice></note>
</measure></part></score-partwise>""")
ns = _ns(root)
m = root.find(".//{*}measure")
d = m.find("direction")
a = _note_matching_direction_voice(m, d, ns)
print("matched", a is not None, a.find("staff").text if a is not None else None)
