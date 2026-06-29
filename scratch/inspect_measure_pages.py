import xml.etree.ElementTree as ET

def inspect(filepath):
    tree = ET.parse(filepath)
    root = tree.getroot()
    ns = ''
    t = root.tag
    if t.startswith("{"):
        ns = t[1 : t.index("}")]

    def q(local):
        return f"{{{ns}}}{local}" if ns else local

    piano = None
    for part in root.findall(q('part')):
        if part.get('id') == 'P5':
            piano = part
            break

    print(f"Mapping of XML measures to page breaks for {filepath}:")
    page_num = 1
    system_num = 1
    for m in piano.findall(q('measure')):
        m_num = m.get('number')
        # Check if this measure has a print element
        pr = m.find(q('print'))
        if pr is not None:
            new_page = pr.get('new-page')
            new_system = pr.get('new-system')
            if new_page == 'yes':
                page_num += 1
                system_num = 1
                print(f"XML Measure {m_num} -> Page {page_num} (New Page)")
            elif new_system == 'yes':
                system_num += 1
                print(f"XML Measure {m_num} -> Page {page_num}, System {system_num} (New System)")

inspect('omr-work-2899bf35/audiveris_raw.xml')
