import xml.etree.ElementTree as ET

tree = ET.parse('C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml')
root = tree.getroot()
p5 = root.find(".//part[@id='P5']")
m25 = p5.find(".//measure[@number='25']")
m26 = p5.find(".//measure[@number='26']")

print('m25 backup', len(m25.findall('.//backup')))
print('m26 backup', len(m26.findall('.//backup')))
print('m25 notes', len(m25.findall('.//note')))
print('m26 notes', len(m26.findall('.//note')))
