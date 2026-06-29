import xml.etree.ElementTree as ET
import sys
from pathlib import Path

sys.path.insert(0, str(Path('scripts').resolve()))
from fix_audiveris_mxl import _repair_misplaced_sharp_via_duplicate, mxl_ns_uri, qname

tree = ET.parse('omr-work-ec9f6685/audiveris_raw.xml')
root = tree.getroot()
ns = mxl_ns_uri(root)

for part in root.findall(qname(ns, 'part')):
    pid = part.get('id')
    for measure in part.findall(qname(ns, 'measure')):
        m_num = measure.get('number')
        # clone measure to run function
        m_clone = ET.fromstring(ET.tostring(measure))
        fixed = _repair_misplaced_sharp_via_duplicate(m_clone, ns)
        if fixed > 0:
            print(f"Part {pid}, Measure {m_num}: modified {fixed} notes")
            # print notes before and after
            orig_notes = []
            for n in measure.findall(qname(ns, 'note')):
                if n.find(qname(ns, 'staff')) is not None and n.find(qname(ns, 'staff')).text == '1':
                    pitch = n.find(qname(ns, 'pitch'))
                    step = pitch.find(qname(ns, 'step')).text if pitch is not None else 'Rest'
                    acc = n.find(qname(ns, 'accidental')).text if n.find(qname(ns, 'accidental')) is not None else ''
                    orig_notes.append(f"{step}(Acc:{acc})")
            
            fixed_notes = []
            for n in m_clone.findall(qname(ns, 'note')):
                if n.find(qname(ns, 'staff')) is not None and n.find(qname(ns, 'staff')).text == '1':
                    pitch = n.find(qname(ns, 'pitch'))
                    step = pitch.find(qname(ns, 'step')).text if pitch is not None else 'Rest'
                    acc = n.find(qname(ns, 'accidental')).text if n.find(qname(ns, 'accidental')) is not None else ''
                    fixed_notes.append(f"{step}(Acc:{acc})")
            print(f"  Before: {', '.join(orig_notes)}")
            print(f"  After : {', '.join(fixed_notes)}")
