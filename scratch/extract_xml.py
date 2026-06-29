import zipfile
import re
from pathlib import Path

def extract_mxl(mxl_path, out_xml_path):
    mxl_path = Path(mxl_path)
    out_xml_path = Path(out_xml_path)
    with zipfile.ZipFile(mxl_path, 'r') as z:
        container_xml = z.read("META-INF/container.xml").decode("utf-8")
        match = re.search(r'full-path="([^"]+)"', container_xml)
        if not match:
            raise ValueError(f"Could not find rootfile in container.xml of {mxl_path}")
        root_file = match.group(1)
        xml_data = z.read(root_file)
        out_xml_path.write_bytes(xml_data)
        print(f"Extracted {mxl_path} -> {out_xml_path}")

extract_mxl("omr-work-ec9f6685/audiveris_raw.mxl", "omr-work-ec9f6685/audiveris_raw.xml")
extract_mxl("omr-work-ec9f6685/review.mxl", "omr-work-ec9f6685/review.xml")
extract_mxl("test-out.mxl", "test-out.xml")
