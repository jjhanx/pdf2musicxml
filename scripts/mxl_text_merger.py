import sys
import json
import zipfile
import io
import os
try:
    from lxml import etree
except ImportError:
    print("Error: lxml is not installed. Please run: pip install lxml", file=sys.stderr)
    sys.exit(1)

def process_mxl(mxl_path, json_path, output_mxl_path):
    # Read text data
    with open(json_path, 'r', encoding='utf-8') as f:
        text_data = json.load(f)

    # Flatten text blocks for easy access
    all_blocks = []
    for page in text_data:
        for block in page.get('blocks', []):
            all_blocks.append(block)

    if not all_blocks:
        print("No text blocks to merge. Copying file as is.")
        import shutil
        shutil.copy(mxl_path, output_mxl_path)
        return

    # Read MXL file
    with zipfile.ZipFile(mxl_path, 'r') as zin:
        # Find the root xml file from META-INF/container.xml
        container_xml = zin.read('META-INF/container.xml')
        container_root = etree.fromstring(container_xml)
        rootfile_path = container_root.xpath('//rootfile/@full-path')[0]
        
        xml_content = zin.read(rootfile_path)

    # Parse MusicXML
    tree = etree.parse(io.BytesIO(xml_content))
    root = tree.getroot()

    # Heuristic Merge: 
    # For a v1, we will just attach all extracted text as `<direction>` to the first measure of the first part.
    # A true heuristic would calculate distances between PDF text bounding boxes and MusicXML note/measure coordinates.
    
    parts = root.findall('part')
    if parts:
        first_part = parts[0]
        measures = first_part.findall('measure')
        if measures:
            first_measure = measures[0]
            
            for block in all_blocks:
                text = block['text']
                bbox = block['bbox'] # [x0, y0, x1, y1]
                
                # Determine if it's a title (top of page) or lyric (near bottom/middle)
                # This is a placeholder for actual geometric matching
                y_center = (bbox[1] + bbox[3]) / 2
                
                # Create direction
                direction = etree.Element("direction", placement="above")
                direction_type = etree.SubElement(direction, "direction-type")
                words = etree.SubElement(direction_type, "words")
                
                # We can store original coordinates in default-x/y or just inject the text
                # We will scale coordinates arbitrarily for now
                words.set("default-x", str(int(bbox[0])))
                words.set("default-y", str(int(bbox[1])))
                words.text = text
                
                first_measure.insert(0, direction)

    # Write out to new MXL
    with zipfile.ZipFile(output_mxl_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        with zipfile.ZipFile(mxl_path, 'r') as zin:
            for item in zin.infolist():
                if item.filename == rootfile_path:
                    # Write modified XML
                    xml_bytes = etree.tostring(tree, encoding='utf-8', xml_declaration=True)
                    zout.writestr(item, xml_bytes)
                else:
                    zout.writestr(item, zin.read(item.filename))

    print(f"Success. Merged text into {output_mxl_path}")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python mxl_text_merger.py <input.mxl> <text_data.json> <output.mxl>", file=sys.stderr)
        sys.exit(1)
        
    mxl_in = sys.argv[1]
    json_in = sys.argv[2]
    mxl_out = sys.argv[3]
    
    process_mxl(mxl_in, json_in, mxl_out)
