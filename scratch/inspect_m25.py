import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

def inspect_m25(mxl_path: Path):
    if not mxl_path.exists():
        print(f"{mxl_path} does not exist.")
        return
    
    with zipfile.ZipFile(mxl_path) as z:
        container = z.read("META-INF/container.xml").decode()
        m = re.search(r'full-path="([^"]+)"', container)
        if not m:
            print("No rootfile in container")
            return
        root_path = m.group(1)
        root = ET.parse(io.BytesIO(z.read(root_path))).getroot()
        
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag[1 : root.tag.index("}")]
    
    def _q(tag):
        return f"{{{ns}}}{tag}" if ns else tag
        
    print(f"\n=== File: {mxl_path.name} ===")
    for part in root.findall(_q("part")):
        part_id = part.get("id")
        for measure in part.findall(_q("measure")):
            if measure.get("number") == "24":
                print(f"Part: {part_id}, Measure 24")
                notes = measure.findall(_q("note"))
                for idx, note in enumerate(notes):
                    chord = note.find(_q("chord")) is not None
                    pitch_el = note.find(_q("pitch"))
                    rest_el = note.find(_q("rest"))
                    
                    p_str = ""
                    if pitch_el is not None:
                        step = pitch_el.find(_q("step")).text
                        octave = pitch_el.find(_q("octave")).text
                        alter_el = pitch_el.find(_q("alter"))
                        alt = ""
                        if alter_el is not None:
                            alt = "#" if int(alter_el.text) > 0 else "b"
                        p_str = f"{step}{alt}{octave}"
                    elif rest_el is not None:
                        p_str = "rest"
                        
                    voice = note.find(_q("voice")).text if note.find(_q("voice")) is not None else "?"
                    staff = note.find(_q("staff")).text if note.find(_q("staff")) is not None else "?"
                    stem = note.find(_q("stem")).text if note.find(_q("stem")) is not None else "?"
                    beams = [b.text for b in note.findall(_q("beam"))]
                    
                    chord_str = " (chord)" if chord else ""
                    print(f"  #{idx}{chord_str} pitch={p_str} voice={voice} staff={staff} stem={stem} beams={beams}")

if __name__ == "__main__":
    for f in ["noon.mxl", "noon_fixed.mxl", "test-fix.mxl", "test-out.mxl", "test.mxl"]:
        inspect_m25(Path(f))
