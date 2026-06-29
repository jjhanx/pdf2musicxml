import sys
import os
import zipfile
import re
import xml.etree.ElementTree as ET
from pathlib import Path
import io

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

def inspect_workspace():
    root_dir = Path("d:/pdf2musicxml")
    zip_files = list(root_dir.glob("*.zip"))
    
    out_lines = []
    out_lines.append(f"Found ZIP files: {[f.name for f in zip_files]}")

    for zf_path in zip_files:
        out_lines.append(f"\n--- Inspecting {zf_path.name} ---")
        try:
            with zipfile.ZipFile(zf_path, 'r') as z:
                names = z.namelist()
                out_lines.append(f"Files inside zip: {names[:10]} (total {len(names)} files)")
                
                mxl_files = [n for n in names if n.lower().endswith('.mxl')]
                out_lines.append(f"MXL files inside zip: {mxl_files}")
                
                for mxl_name in mxl_files:
                    mxl_bytes = z.read(mxl_name)
                    inspect_mxl_bytes(mxl_bytes, f"{zf_path.name} -> {mxl_name}", out_lines)
        except Exception as e:
            out_lines.append(f"Failed to read {zf_path.name}: {e}")
            
    # Also search for any .mxl files in the workspace or subdirectories
    mxl_in_root = list(root_dir.glob("*.mxl"))
    out_lines.append(f"\nFound MXL files in root: {[f.name for f in mxl_in_root]}")
    for mf in mxl_in_root:
        try:
            inspect_mxl_bytes(mf.read_bytes(), mf.name, out_lines)
        except Exception as e:
            out_lines.append(f"Failed to read {mf.name}: {e}")

    # Write report to workspace
    out_path = root_dir / "inspect_output.txt"
    out_path.write_text("\n".join(out_lines), encoding="utf-8")
    print(f"Report written to {out_path}")

def mxl_ns_uri(root):
    t = root.tag
    if t.startswith("{"):
        return t[1 : t.index("}")]
    return ""

def qname(ns, local):
    return f"{{{ns}}}{local}" if ns else local

def inspect_mxl_bytes(mxl_bytes, label, out_lines):
    with zipfile.ZipFile(io.BytesIO(mxl_bytes)) as z:
        names = z.namelist()
        container_xml = z.read("META-INF/container.xml").decode("utf-8")
        match = re.search(r'full-path="([^"]+)"', container_xml)
        if not match:
            out_lines.append("No full-path in container.xml")
            return
        root_file = match.group(1)
        score_xml = z.read(root_file)
        
    tree = ET.parse(io.BytesIO(score_xml))
    root = tree.getroot()
    ns = mxl_ns_uri(root)
    
    out_lines.append(f"\nInspecting MXL: {label}")
    parts = root.findall(qname(ns, "part"))
    out_lines.append(f"Part count: {len(parts)}")
    
    score_parts = root.findall(f".//{qname(ns, 'score-part')}")
    for sp in score_parts:
        pid = sp.get("id")
        name_el = sp.find(qname(ns, "part-name"))
        out_lines.append(f"Score Part ID: {pid}, Name: {name_el.text if name_el is not None else 'None'}")
        
    for part in parts:
        pid = part.get("id")
        out_lines.append(f"\nPart {pid}:")
        measures = part.findall(qname(ns, "measure"))
        out_lines.append(f"Measure count: {len(measures)}")
        
        for m in measures:
            num = m.get("number")
            # We want to inspect measures 5 to 17
            if num in ("5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17"):
                out_lines.append(f"  Measure number {num}:")
                notes = m.findall(qname(ns, "note"))
                out_lines.append(f"    Note count: {len(notes)}")
                for idx, note in enumerate(notes):
                    voice_el = note.find(qname(ns, "voice"))
                    voice = voice_el.text if voice_el is not None else "None"
                    
                    # check if rest or pitch
                    pitch_el = note.find(qname(ns, "pitch"))
                    if pitch_el is not None:
                        step = pitch_el.find(qname(ns, "step")).text
                        octave = pitch_el.find(qname(ns, "octave")).text
                        alter_el = pitch_el.find(qname(ns, "alter"))
                        alter = f"({alter_el.text})" if alter_el is not None else ""
                        pitch = f"{step}{alter}{octave}"
                    else:
                        pitch = "Rest" if note.find(qname(ns, "rest")) is not None else "Unknown"
                    
                    notations = note.find(qname(ns, "notations"))
                    slur_infos = []
                    tuplet_infos = []
                    if notations is not None:
                        slurs = notations.findall(qname(ns, "slur"))
                        for s in slurs:
                            slur_infos.append(f"Slur({s.get('type')}, num={s.get('number')})")
                        tuplets = notations.findall(qname(ns, "tuplet"))
                        for t in tuplets:
                            tuplet_infos.append(f"Tuplet({t.get('type')})")
                    
                    out_lines.append(f"      [{idx}] Pitch: {pitch}, Voice: {voice}, Slurs: {slur_infos}, Tuplets: {tuplet_infos}")
                
                dirs = m.findall(qname(ns, "direction"))
                for idx, d in enumerate(dirs):
                    words = []
                    for w in d.iter():
                        if w.tag.endswith("words") or w.tag.endswith("text"):
                            words.append(w.text or "")
                    out_lines.append(f"    Direction [{idx}]: {' '.join(words)}")

if __name__ == "__main__":
    inspect_workspace()
