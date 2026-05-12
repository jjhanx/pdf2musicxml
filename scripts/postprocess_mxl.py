import sys
import zipfile
import io
import os
# Disable Paddle IR to prevent NotImplementedError with newer Paddle versions
os.environ['FLAGS_enable_pir_api'] = '0'
os.environ['PADDLE_DISABLE_PIR'] = '1'

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
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    log_file = os.path.join(project_root, "last_ocr_debug.log")
    
    # clear previous log
    with open(log_file, "w", encoding="utf-8") as f:
        f.write("--- NEW RUN ---\n")
        
    def _log(msg):
        print(msg, flush=True)
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
            
    _log("Loading PaddleOCR...")
    try:
        ocr = PaddleOCR(use_angle_cls=False, lang='korean', det_limit_side_len=960)
        _log("Extracting images from PDF...")
        images = convert_from_path(pdf_path, dpi=150) # Reduced DPI to save memory
        
        ocr_texts = []
        for i, img in enumerate(images):
            import numpy as np
            img_cv = np.array(img)
            result = ocr.ocr(img_cv)
            if result and result[0]:
                for line in result[0]:
                    bbox = line[0]
                    text = line[1][0]
                    y_center = sum(p[1] for p in bbox) / 4
                    x_center = sum(p[0] for p in bbox) / 4
                    if re.search(r'[가-힣]', text):
                        ocr_texts.append({'page': i+1, 'text': text, 'x': x_center, 'y': y_center})
                    
        with zipfile.ZipFile(mxl_path, 'r') as z:
            files = {name: z.read(name) for name in z.namelist()}
            
        container_xml = files.get('META-INF/container.xml')
        if not container_xml:
            _log("Invalid MXL")
            return
            
        container_tree = ET.fromstring(container_xml)
        root_file_path = None
        for elem in container_tree.iter():
            if 'rootfile' in elem.tag.lower():
                root_file_path = elem.attrib.get('full-path')
                break
                
        if not root_file_path:
            _log("Could not find rootfile in container.xml")
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
                                    _log(f"Restored key signature {current_fifths} at measure {measure.attrib.get('number')}")
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
            _log(f"Set title to: {title_text}")

        ocr_syllables = []
        for t in ocr_texts:
            chars = re.findall(r'[가-힣]', t['text'])
            ocr_syllables.extend(chars)
            
        lyric_els = root.findall('.//lyric/text')
        _log(f"Mapping {len(ocr_syllables)} OCR syllables to {len(lyric_els)} MusicXML lyric tags.")
        _log(f"Extracted Syllables: {''.join(ocr_syllables)}")
        
        for i, l_el in enumerate(lyric_els):
            if i < len(ocr_syllables):
                l_el.text = ocr_syllables[i]
            else:
                break
                
        out_xml_bytes = ET.tostring(root, encoding='UTF-8', xml_declaration=True)
        files[root_file_path] = out_xml_bytes
        
        with zipfile.ZipFile(output_mxl_path, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for name, data in files.items():
                z.writestr(name, data)
                
        _log(f"Saved post-processed MXL to {output_mxl_path}")
    except Exception as e:
        import traceback
        _log(f"FATAL ERROR: {str(e)}\n{traceback.format_exc()}")
        raise

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python postprocess_mxl.py <pdf_path> <mxl_in_path> <mxl_out_path>")
        sys.exit(1)
    process_mxl(sys.argv[1], sys.argv[2], sys.argv[3])
