import subprocess
import os
import sys
import zipfile
import re
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

def run_cmd(cmd):
    print(f"\nRunning command: {cmd}")
    res = subprocess.run(cmd, shell=False, capture_output=True)
    stdout = res.stdout.decode('cp949', errors='replace')
    stderr = res.stderr.decode('cp949', errors='replace')
    if res.returncode != 0:
        print(f"Command failed with code {res.returncode}")
        print("STDOUT:", stdout)
        print("STDERR:", stderr)
        raise RuntimeError(f"Command failed: {cmd}")
    print("Command succeeded.")
    if stdout.strip():
        print("STDOUT:", stdout[:500] + ("..." if len(stdout) > 500 else ""))
    if stderr.strip():
        print("STDERR:", stderr[:500] + ("..." if len(stderr) > 500 else ""))

def mxl_ns_uri(root):
    t = root.tag
    if t.startswith("{"):
        return t[1 : t.index("}")]
    return ""

def qname(ns, local):
    return f"{{{ns}}}{local}" if ns else local

def main():
    # Set environment variables for Audiveris
    os.environ["AUDIVERIS_BIN"] = "C:\\Program Files\\Audiveris\\Audiveris.exe"
    
    # 1. Layout extraction
    run_cmd(['python', 'scripts/pdf_separator.py', 'extract', 'd:/pdf2musicxml/original.pdf', 'd:/pdf2musicxml/extracted_music_text.json'])
    
    # 2. Strip ranges and run PUA replacement on clean_score_only.pdf
    run_cmd(['python', 'scripts/pdf_separator.py', 'strip', 'd:/pdf2musicxml/original.pdf', 'd:/pdf2musicxml/clean_score_only.pdf', '--ranges', '7-17'])
    
    # Verify U+F073 replacement in clean_score_only.pdf
    print("\nVerifying U+F073 replacement in clean_score_only.pdf...")
    import fitz
    doc = fitz.open("d:/pdf2musicxml/clean_score_only.pdf")
    found_f073 = False
    for page in doc:
        text = page.get_text()
        if "\uf073" in text:
            found_f073 = True
            print("Warning: Found \uf073 in clean_score_only.pdf!")
    doc.close()
    if not found_f073:
        print("Success: No \uf073 characters found in clean_score_only.pdf (all replaced)!")
        
    # 3. Run Audiveris
    os.makedirs("d:/pdf2musicxml/test-out", exist_ok=True)
    aud_cmd = [
        "C:\\Program Files\\Audiveris\\Audiveris.exe",
        "-batch",
        "-export",
        "-output",
        "d:/pdf2musicxml/test-out",
        "-option",
        "org.audiveris.omr.sheet.BookManager.useSeparateBookFolders=false",
        "-constant",
        "org.audiveris.omr.text.TextWord.constants.abnormalWordRegexp=^[<>{}\\[\\]PpRrLl9]+$",
        "-constant",
        "org.audiveris.omr.text.TextWord.constants.tupletWordRegexp=^(?:[36]|[36][\\-_\\u2014]+|[\\-_\\u2014]*[36][\\-_\\u2014]*)$",
        "--",
        "d:/pdf2musicxml/clean_score_only.pdf"
    ]
    run_cmd(aud_cmd)
    
    # 4. Merge lyric sources
    run_cmd(['python', 'scripts/merge_lyric_sources.py', 'd:/pdf2musicxml/extracted_music_text.json', 'd:/pdf2musicxml/lyric_manifest.json', '--output-flat', 'd:/pdf2musicxml/ocr_data.json'])
    
    # 5. Run OCR and label injection (which runs fix_audiveris_mxl.py)
    # Note: we also want to simulate the part labeling step.
    # The server writes part_labels_preset.json / part_labels.json.
    # Let's write a mock part_labels.json to make sure part labeling runs correctly.
    labels_path = "d:/pdf2musicxml/test-out/part_labels.json"
    import json
    with open(labels_path, "w", encoding="utf-8") as f:
        json.dump({
            "version": 1,
            "labelsByIndex": ["S", "A", "T", "B", "PR", "PL"],
            "savedAt": "2026-06-10T12:00:00Z",
            "source": "test"
        }, f, indent=2)
        
    run_cmd(['python', 'scripts/inject_ocr.py', 'd:/pdf2musicxml/test-out/clean_score_only.mxl', 'd:/pdf2musicxml/test-out/final_output.mxl', 'd:/pdf2musicxml/ocr_data.json'])
    
    # 6. Verify final MXL file
    print("\n--- Verifying final_output.mxl ---")
    mxl_path = "d:/pdf2musicxml/test-out/final_output.mxl"
    if not os.path.exists(mxl_path):
        print(f"Error: {mxl_path} does not exist!")
        return
        
    with zipfile.ZipFile(mxl_path, 'r') as z:
        container_xml = z.read("META-INF/container.xml").decode("utf-8")
        match = re.search(r'full-path="([^"]+)"', container_xml)
        root_file = match.group(1)
        score_xml = z.read(root_file)
        
    tree = ET.parse(io.BytesIO(score_xml))
    root = tree.getroot()
    ns = mxl_ns_uri(root)
    
    # Check Measure 6 of Piano part (usually P5 or P6 depending on how parts are labeled)
    parts = root.findall(qname(ns, "part"))
    for part in parts:
        pid = part.get("id")
        
        # Check part-name
        score_part = root.find(f".//{qname(ns, 'score-part')}[@id='{pid}']")
        pname = "None"
        if score_part is not None:
            name_el = score_part.find(qname(ns, "part-name"))
            if name_el is not None:
                pname = name_el.text
                
        print(f"Part {pid} (Name: {pname}):")
        
        measures = part.findall(qname(ns, "measure"))
        for m in measures:
            num = m.get("number")
            # We want to check measure 6 for slurs
            if num == "6" and ("piano" in pname.lower() or "pr" in pname.lower() or pname in ("P", "PR", "PL")):
                print(f"  Found Piano measure 6!")
                notes = m.findall(qname(ns, "note"))
                voice1_notes = [note for note in notes if note.find(qname(ns, "voice")).text == "1"]
                print(f"    Voice 1 note count: {len(voice1_notes)}")
                for idx, note in enumerate(voice1_notes):
                    pitch_el = note.find(qname(ns, "pitch"))
                    step = pitch_el.find(qname(ns, "step")).text
                    octave = pitch_el.find(qname(ns, "octave")).text
                    alter_el = pitch_el.find(qname(ns, "alter"))
                    alter = f"({alter_el.text})" if alter_el is not None else ""
                    pitch = f"{step}{alter}{octave}"
                    
                    notations = note.find(qname(ns, "notations"))
                    slurs = []
                    if notations is not None:
                        for s in notations.findall(qname(ns, "slur")):
                            slurs.append(f"Slur({s.get('type')}, num={s.get('number')})")
                    print(f"      Note {idx+1}: {pitch}, Slurs: {slurs}")
            
            # We want to check measures 13-15 for tuplets/triplets
            if num in ("13", "14", "15") and ("piano" in pname.lower() or "pl" in pname.lower() or pname in ("P", "PR", "PL")):
                notes = m.findall(qname(ns, "note"))
                print(f"  Piano Measure {num}: Note count={len(notes)}")
                for idx, note in enumerate(notes):
                    voice_el = note.find(qname(ns, "voice"))
                    voice = voice_el.text if voice_el is not None else "None"
                    
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
                    tuplet_info = []
                    if notations is not None:
                        for t in notations.findall(qname(ns, "tuplet")):
                            tuplet_info.append(f"Tuplet({t.get('type')})")
                    if tuplet_info:
                        print(f"    [{idx}] Pitch: {pitch}, Voice: {voice}, Tuplets: {tuplet_info}")

import io
if __name__ == "__main__":
    main()
