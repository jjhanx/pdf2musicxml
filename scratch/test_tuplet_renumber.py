import xml.etree.ElementTree as ET
import sys
from pathlib import Path

# Add scripts to path so we can import fix_audiveris_mxl
sys.path.insert(0, str(Path('scripts').resolve()))
from fix_audiveris_mxl import _renumber_tuplets_in_measure, qname, mxl_ns_uri

tree = ET.parse('omr-work-ec9f6685/audiveris_raw.xml')
root = tree.getroot()
ns = mxl_ns_uri(root)

piano_part = None
for part in root.findall(qname(ns, 'part')):
    if part.get('id') == 'P5':
        piano_part = part
        break

m45 = piano_part.find(f".//{qname(ns, 'measure')}[@number='45']")

# Print before renumbering
print("--- Before Renumbering ---")
for note in m45.findall(qname(ns, "note")):
    if note.find(qname(ns, "chord")) is not None:
        continue
    notations = note.find(qname(ns, "notations"))
    if notations is not None:
        for tuplet in notations.findall(qname(ns, "tuplet")):
            pitch = note.find(qname(ns, "pitch"))
            step = pitch.find(qname(ns, "step")).text if pitch is not None else "Rest"
            print(f"Note Pitch: {step}, Tuplet type: {tuplet.get('type')}, number: {tuplet.get('number')}")

# Run renumbering
fixed = _renumber_tuplets_in_measure(m45, ns)
print(f"\nFixed: {fixed} tuplets")

# Print after renumbering
print("\n--- After Renumbering ---")
for note in m45.findall(qname(ns, "note")):
    if note.find(qname(ns, "chord")) is not None:
        continue
    notations = note.find(qname(ns, "notations"))
    if notations is not None:
        for tuplet in notations.findall(qname(ns, "tuplet")):
            pitch = note.find(qname(ns, "pitch"))
            step = pitch.find(qname(ns, "step")).text if pitch is not None else "Rest"
            print(f"Note Pitch: {step}, Tuplet type: {tuplet.get('type')}, number: {tuplet.get('number')}")
