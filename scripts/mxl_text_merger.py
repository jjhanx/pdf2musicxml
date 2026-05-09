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

# '1'이면 예전처럼 첫 마디에 direction 대량 삽입 (mxlplayer 등과 충돌 가능)
INJECT_DIRECTIONS = os.environ.get("PDF2MXL_INJECT_LYRICS_DIRECTIONS", "").lower() in ("1", "true", "yes")


def process_mxl(mxl_path, json_path, output_mxl_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        text_data = json.load(f)

    lines_out = []
    for page in text_data:
        pnum = page.get("page", "?")
        for block in page.get("blocks", []):
            t = block.get("text", "").strip()
            if not t:
                continue
            src = block.get("source", "?")
            lines_out.append(f"[p{pnum} {src}] {t}")

    sidecar_path = os.path.splitext(output_mxl_path)[0] + "_lyrics.txt"
    try:
        with open(sidecar_path, 'w', encoding='utf-8') as sf:
            sf.write("PDF에서 추출한 텍스트(벡터/OCR). MusicXML과 좌표계가 달라 자동 병합 가사 위치는 부정확할 수 있습니다.\n\n")
            sf.write("\n".join(lines_out))
    except Exception as e:
        print(f"Warning: could not write sidecar {sidecar_path}: {e}", file=sys.stderr)

    all_blocks = []
    for page in text_data:
        for block in page.get('blocks', []):
            all_blocks.append(block)

    if not all_blocks or not INJECT_DIRECTIONS:
        import shutil
        shutil.copy(mxl_path, output_mxl_path)
        if not INJECT_DIRECTIONS:
            print(f"Copied MXL unchanged (safe mode). Lyrics text: {sidecar_path}", flush=True)
        else:
            print(f"No text blocks. Copied MXL as is.", flush=True)
        return

    # --- 레거시: 첫 마디에 direction 삽입 (권장하지 않음) ---
    with zipfile.ZipFile(mxl_path, 'r') as zin:
        container_xml = zin.read('META-INF/container.xml')
        container_root = etree.fromstring(container_xml)
        rootfile_path = container_root.xpath('//rootfile/@full-path')[0]
        xml_content = zin.read(rootfile_path)

    tree = etree.parse(io.BytesIO(xml_content))
    root = tree.getroot()

    parts = root.findall('part')
    if parts:
        first_part = parts[0]
        measures = first_part.findall('measure')
        if measures:
            first_measure = measures[0]
            for block in all_blocks:
                text = block['text']
                bbox = block['bbox']
                direction = etree.Element("direction", placement="above")
                direction_type = etree.SubElement(direction, "direction-type")
                words = etree.SubElement(direction_type, "words")
                words.set("default-x", str(int(bbox[0])))
                words.set("default-y", str(int(bbox[1])))
                words.text = text
                first_measure.insert(0, direction)

    with zipfile.ZipFile(output_mxl_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        with zipfile.ZipFile(mxl_path, 'r') as zin:
            for item in zin.infolist():
                if item.filename == rootfile_path:
                    xml_bytes = etree.tostring(tree, encoding='utf-8', xml_declaration=True)
                    zout.writestr(item, xml_bytes)
                else:
                    zout.writestr(item, zin.read(item.filename))

    print(f"Success (legacy inject). Merged text into {output_mxl_path}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python mxl_text_merger.py <input.mxl> <text_data.json> <output.mxl>", file=sys.stderr)
        sys.exit(1)

    mxl_in = sys.argv[1]
    json_in = sys.argv[2]
    mxl_out = sys.argv[3]

    process_mxl(mxl_in, json_in, mxl_out)
