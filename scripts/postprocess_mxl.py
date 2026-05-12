import sys
import zipfile
import io
import os
import re
import xml.etree.ElementTree as ET
from pdf2image import convert_from_path
from paddleocr import PaddleOCR

def group_texts_by_line(texts, y_tolerance=20):
    """Group text boxes into lines based on Y coordinate proximity."""
    if not texts:
        return []
    # Sort by Y first
    texts = sorted(texts, key=lambda t: t['y'])
    lines = []
    current_line = [texts[0]]
    for t in texts[1:]:
        if abs(t['y'] - current_line[-1]['y']) <= y_tolerance:
            current_line.append(t)
        else:
            lines.append(current_line)
            current_line = [t]
    lines.append(current_line)
    
    # Sort each line by X
    for line in lines:
        line.sort(key=lambda t: t['x'])
    return lines

def process_mxl(pdf_path, mxl_path, output_mxl_path):
    print("Loading PaddleOCR...")
    ocr = PaddleOCR(use_angle_cls=False, lang='korean', show_log=False)
    
    print("Extracting images from PDF...")
    images = convert_from_path(pdf_path, dpi=200)
    
    ocr_texts = []
    for i, img in enumerate(images):
        import numpy as np
        img_cv = np.array(img)
        result = ocr.ocr(img_cv, cls=False)
        if result and result[0]:
            for line in result[0]:
                bbox = line[0]
                text = line[1][0]
                y_center = sum(p[1] for p in bbox) / 4
                x_center = sum(p[0] for p in bbox) / 4
                # Only keep texts containing Korean to avoid mapping tempo/dynamics as lyrics
                if re.search(r'[가-힣]', text):
                    ocr_texts.append({'page': i+1, 'text': text, 'x': x_center, 'y': y_center})
                
    # Unzip MXL
    with zipfile.ZipFile(mxl_path, 'r') as z:
        files = {name: z.read(name) for name in z.namelist()}
        
    container_xml = files.get('META-INF/container.xml')
    if not container_xml:
        print("Invalid MXL")
        return
        
    root_file_path = ET.fromstring(container_xml).find('.//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile').attrib['full-path']
    score_xml = files[root_file_path]
    tree = ET.parse(io.BytesIO(score_xml))
    root = tree.getroot()
    
    # 1. Fix Key Signatures (Propagation across systems/pages)
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
                            # Check if it's a real key change by looking for <cancel>
                            cancel_el = key.find('cancel')
                            if cancel_el is None:
                                fifths_el.text = str(current_fifths)
                                print(f"Restored key signature {current_fifths} at measure {measure.attrib.get('number')}")
                        else:
                            current_fifths = fifths
                            
    # 2. Inject Title and Lyrics via Topological Coordinate Mapping
    # Find title from page 1 (highest Y)
    page1_texts = [t for t in ocr_texts if t['page'] == 1]
    title_text = None
    if page1_texts:
        title_cand = min(page1_texts, key=lambda t: t['y'])
        title_text = title_cand['text']
        # Remove title from pool
        ocr_texts.remove(title_cand)
        
        work = root.find('work')
        if work is None:
            work = ET.SubElement(root, 'work')
        work_title = work.find('work-title')
        if work_title is None:
            work_title = ET.SubElement(work, 'work-title')
        work_title.text = title_text
        print(f"Set title to: {title_text}")

    # Extract all lyric elements from MusicXML, grouped by measure/system
    # We will flatten them and also flatten OCR texts to just map sequentially.
    # Since we filtered out non-Korean texts, the remaining OCR texts are mostly lyrics.
    # To be robust, we break them down into syllables.
    ocr_syllables = []
    for t in ocr_texts:
        # Extract only Korean letters to avoid punctuation mismatch
        chars = re.findall(r'[가-힣]', t['text'])
        ocr_syllables.extend(chars)
        
    lyric_els = root.findall('.//lyric/text')
    
    print(f"Mapping {len(ocr_syllables)} OCR syllables to {len(lyric_els)} MusicXML lyric tags.")
    
    # Sequential replacement
    for i, l_el in enumerate(lyric_els):
        if i < len(ocr_syllables):
            l_el.text = ocr_syllables[i]
        else:
            break
            
    # Save back to zip
    out_xml_bytes = ET.tostring(root, encoding='UTF-8', xml_declaration=True)
    files[root_file_path] = out_xml_bytes
    
    with zipfile.ZipFile(output_mxl_path, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
            
    print(f"Saved post-processed MXL to {output_mxl_path}")

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python postprocess_mxl.py <pdf_path> <mxl_in_path> <mxl_out_path>")
        sys.exit(1)
    process_mxl(sys.argv[1], sys.argv[2], sys.argv[3])
