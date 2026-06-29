import io
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

def dump_xml_m25(mxl_path: Path):
    with zipfile.ZipFile(mxl_path) as z:
        container = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', container)
        root_path = m.group(1)
        root = ET.parse(io.BytesIO(z.read(root_path))).getroot()
        
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag[1 : root.tag.index("}")]
    
    def _q(tag):
        return f"{{{ns}}}{tag}" if ns else tag
        
    for part in root.findall(_q("part")):
        if part.get("id") != "P5":
            continue
        for measure in part.findall(_q("measure")):
            if measure.get("number") == "24":
                print(f"=== Part: P5, Measure 24 XML ===")
                notes = measure.findall(_q("note"))
                for idx, note in enumerate(notes):
                    if idx >= 22:
                        xml_str = ET.tostring(note, encoding="utf-8").decode("utf-8")
                        # Clean up namespaces for readability
                        xml_str = xml_str.replace(f' xmlns="{ns}"', '')
                        xml_str = re.sub(r'ns\d+:', '', xml_str)
                        print(f"\nNote #{idx}:")
                        print(xml_str)

if __name__ == "__main__":
    dump_xml_m25(Path("test-fix.mxl"))
