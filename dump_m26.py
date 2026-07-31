import xml.etree.ElementTree as ET

tree = ET.parse('C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml')
root = tree.getroot()
for p in root.findall('part'):
    m26 = p.find(".//measure[@number='26']")
    print(f"\n--- PART {p.get('id')} Measure 26 ---")
    if m26 is not None:
        ET.dump(m26)
