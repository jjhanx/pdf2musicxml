import xml.etree.ElementTree as ET

tree = ET.parse('omr-work-ec9f6685/review.xml')
root = tree.getroot()
ns = ''
t = root.tag
if t.startswith("{"):
    ns = t[1 : t.index("}")]

def qname(local):
    return f"{{{ns}}}{local}" if ns else local

part_list = root.find(qname('part-list'))
for sp in part_list.findall(qname('score-part')):
    pid = sp.get('id')
    pname = sp.find(qname('part-name')).text
    print(f"Part ID: {pid}, Name: {pname}")
