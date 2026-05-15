import sys
import zipfile
import io
import json
import xml.etree.ElementTree as ET

def inject_ocr(mxl_in_path, mxl_out_path, json_in_path):
    with open(json_in_path, 'r', encoding='utf-8') as f:
        ocr_data = json.load(f)
        
    with zipfile.ZipFile(mxl_in_path, 'r') as z:
        files = {name: z.read(name) for name in z.namelist()}
        
    container_xml = files.get('META-INF/container.xml')
    if not container_xml:
        print("Invalid MXL")
        return
        
    container_str = container_xml.decode('utf-8')
    import re
    match = re.search(r'full-path="([^"]+)"', container_str)
    if match:
        root_file_path = match.group(1)
    else:
        print("Could not find rootfile in container.xml")
        return
        
    score_xml = files[root_file_path]
    tree = ET.parse(io.BytesIO(score_xml))
    root = tree.getroot()
    
    # 1. Fix key signatures (existing logic)
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

    # 2. Extract classified text
    title_text = ""
    composer_text = ""
    lyricist_text = ""
    copyright_text = ""
    
    # Sort data by y to maintain visual order
    ocr_data.sort(key=lambda x: x.get('y', 0))
    
    lyric_slots = []
    
    for item in ocr_data:
        t = item.get('type', 'unknown')
        text = item.get('text', '')
        if t == 'title':
            title_text += text + " "
        elif t == 'composer':
            composer_text += text + " "
        elif t == 'lyricist':
            lyricist_text += text + " "
        elif t == 'copyright':
            copyright_text += text + " "
        elif t == 'lyrics':
            slots = item.get('lyric_slots', [])
            lyric_slots.extend(slots)
            
    # 3. Inject Metadata
    if title_text:
        work = root.find('work')
        if work is None:
            work = ET.SubElement(root, 'work')
            root.insert(0, work) # Put work at top
        work_title = work.find('work-title')
        if work_title is None:
            work_title = ET.SubElement(work, 'work-title')
        work_title.text = title_text.strip()
        
    identification = root.find('identification')
    if identification is None and (composer_text or lyricist_text or copyright_text):
        identification = ET.SubElement(root, 'identification')
        # insert after work if exists
        idx = 1 if root.find('work') is not None else 0
        root.insert(idx, identification)
        
    if composer_text or lyricist_text:
        for t, val in [('composer', composer_text), ('lyricist', lyricist_text)]:
            if val:
                creator = ET.SubElement(identification, 'creator', type=t)
                creator.text = val.strip()
                
    if copyright_text:
        rights = identification.find('rights')
        if rights is None:
            rights = ET.SubElement(identification, 'rights')
        rights.text = copyright_text.strip()

    # 4. Inject Lyrics
    if lyric_slots:
        # Find the first part to inject lyrics. Usually vocal is part 1.
        part1 = root.find('part')
        if part1 is not None:
            slot_idx = 0
            for measure in part1.findall('measure'):
                for note in measure.findall('note'):
                    if slot_idx >= len(lyric_slots):
                        break
                    
                    # Skip rests and chords (only put lyric on the first note of a chord)
                    if note.find('rest') is not None:
                        continue
                    if note.find('chord') is not None:
                        continue
                        
                    # Skip grace notes
                    if note.find('grace') is not None:
                        continue
                        
                    syllable = lyric_slots[slot_idx]
                    slot_idx += 1
                    
                    if syllable.strip():
                        # Remove existing lyric elements
                        for old_lyric in note.findall('lyric'):
                            note.remove(old_lyric)
                            
                        lyric_el = ET.SubElement(note, 'lyric')
                        syllabic_el = ET.SubElement(lyric_el, 'syllabic')
                        syllabic_el.text = 'single' # Simplify, could be begin/middle/end
                        text_el = ET.SubElement(lyric_el, 'text')
                        text_el.text = syllable.strip()
                        
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
