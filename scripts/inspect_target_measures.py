import sys
import zipfile
import re
import xml.etree.ElementTree as ET
from pathlib import Path
import io

def get_measure_xml(mxl_path, measure_num):
    with zipfile.ZipFile(mxl_path, 'r') as z:
        container_xml = z.read("META-INF/container.xml").decode("utf-8")
        match = re.search(r'full-path="([^"]+)"', container_xml)
        if not match:
            return "No full-path"
        root_file = match.group(1)
        score_xml = z.read(root_file)
        
    tree = ET.parse(io.BytesIO(score_xml))
    root = tree.getroot()
    
    t = root.tag
    ns = ""
    if t.startswith("{"):
        ns = t[1 : t.index("}")]
    
    def qname(local):
        return f"{{{ns}}}{local}" if ns else local
        
    res = []
    # Find parts
    parts = root.findall(qname("part"))
    for part in parts:
        part_id = part.get("id")
        measure = None
        for m in part.findall(qname("measure")):
            if m.get("number") == str(measure_num):
                measure = m
                break
        if measure is not None:
            # Format XML
            ET.indent(measure, space="  ")
            xml_str = ET.tostring(measure, encoding="utf-8").decode("utf-8")
            res.append(f"Part: {part_id}\n{xml_str}")
    return "\n\n".join(res)

if __name__ == "__main__":
    out_lines = []
    for m_num in [25, 35, 45, 50, 51]:
        out_lines.append(f"==================== MEASURE {m_num} (RAW) ====================")
        out_lines.append(get_measure_xml("omr-work-20006191/audiveris_raw.mxl", m_num))
        out_lines.append(f"==================== MEASURE {m_num} (REVIEW) ====================")
        out_lines.append(get_measure_xml("omr-work-20006191/review.mxl", m_num))
        out_lines.append(f"==================== MEASURE {m_num} (FIXED) ====================")
        out_lines.append(get_measure_xml("test-out-2000.mxl", m_num))
    Path("check_2000.txt").write_text("\n".join(out_lines), encoding="utf-8")
    print("Done")
