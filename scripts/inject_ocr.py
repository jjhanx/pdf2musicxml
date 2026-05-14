import sys
import zipfile
import io
import json
import re
import xml.etree.ElementTree as ET

def inject_ocr(mxl_in_path, mxl_out_path, json_in_path):
    with open(json_in_path, 'r', encoding='utf-8') as f:
        ocr_texts = json.load(f)
        
    with zipfile.ZipFile(mxl_in_path, 'r') as z:
        files = {name: z.read(name) for name in z.namelist()}
        
    container_xml = files.get('META-INF/container.xml')
    if not container_xml:
        print("Invalid MXL")
        return
        
    container_str = container_xml.decode('utf-8')
    match = re.search(r'full-path="([^"]+)"', container_str)
    if match:
        root_file_path = match.group(1)
    else:
        print("Could not find rootfile in container.xml")
        return
        
    score_xml = files[root_file_path]
    tree = ET.parse(io.BytesIO(score_xml))
    root = tree.getroot()
    
    current_fifths = None
    for part in root.findall('part'):
        current_fifths = None
        for measure in part.findall('measure'):
            print_el = measure.find('print')
            is_new_system = print_el is not None and (print_el.attrib.get('new-system') == 'yes' or print_el.attrib.get('new-page') == 'yes')
            attr = measure.find('attributes')
            if attr is not None:
                key = attr.find('key')
                if key is not None:
                    fifths_el = key.find('fifths')
                    if fifths_el is not None:
                        fifths = int(fifths_el.text)
                        if is_new_system and fifths == 0 and current_fifths is not None and current_fifths != 0:
                            cancel_el = key.find('cancel')
                            if cancel_el is None:
                                fifths_el.text = str(current_fifths)
                        else:
                            current_fifths = fifths
                            
    page1_texts = [t for t in ocr_texts if t['page'] == 1]
    title_text = None
    if page1_texts:
        title_cand = min(page1_texts, key=lambda t: t['y'])
        title_text = title_cand['text']
        ocr_texts.remove(title_cand)
        work = root.find('work')
        if work is None:
            work = ET.SubElement(root, 'work')
        work_title = work.find('work-title')
        if work_title is None:
            work_title = ET.SubElement(work, 'work-title')
        work_title.text = title_text

    ocr_syllables = []
    for t in ocr_texts:
        chars = re.findall(r'[가-힣]', t['text'])
        ocr_syllables.extend(chars)
        
    lyric_els = root.findall('.//lyric/text')
    
    for i, l_el in enumerate(lyric_els):
        if i < len(ocr_syllables):
            l_el.text = ocr_syllables[i]
        else:
            break
            
    out_xml_bytes = ET.tostring(root, encoding='UTF-8', xml_declaration=True)
    files[root_file_path] = out_xml_bytes
    
    with zipfile.ZipFile(mxl_out_path, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python inject_ocr.py <mxl_in_path> <mxl_out_path> <json_in_path>")
        sys.exit(1)
    inject_ocr(sys.argv[1], sys.argv[2], sys.argv[3])
