import zipfile, xml.etree.ElementTree as ET

def print_time_sig_info(mxl_path):
    print(f"=== {mxl_path} ===")
    with zipfile.ZipFile(mxl_path) as z:
        name = [x for x in z.namelist() if x.endswith('.xml') and not x.startswith('META-INF')][0]
        root = ET.fromstring(z.read(name))
    ns = ""
    if root.tag.startswith('{'):
        ns = root.tag[1:root.tag.index('}')]
    q = lambda tag: f'{{{ns}}}{tag}' if ns else tag
    
    current_div = None
    current_time = None
    
    for part in root.findall(q('part')):
        if part.get('id') != 'P5':
            continue
        for m in part.findall(q('measure')):
            m_num = m.get('number')
            div_el = m.find(f'.//{q("divisions")}')
            if div_el is not None:
                current_div = div_el.text
            time_el = m.find(f'.//{q("time")}')
            if time_el is not None:
                beats = time_el.find(q('beats')).text
                beat_type = time_el.find(q('beat-type')).text
                current_time = f"{beats}/{beat_type}"
            if m_num == "41":
                print(f"Measure 41: divisions={current_div}, time_signature={current_time}")
                break

if __name__ == '__main__':
    print_time_sig_info('noon.mxl')
