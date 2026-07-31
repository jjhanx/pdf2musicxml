import zipfile
import xml.etree.ElementTree as ET
import re
import os
import subprocess
import sys

def main():
    mxl_in = 'noon.mxl'
    temp_in = 'scratch/noon-test-input.mxl'
    temp_out = 'scratch/noon-test-output.mxl'
    
    # 1. Load noon.mxl, delete slurs in measure 52, and save to scratch/noon-test-input.mxl
    print("Preparing test input file with measure 52 slurs deleted...")
    os.makedirs('scratch', exist_ok=True)
    with zipfile.ZipFile(mxl_in) as z_in:
        container = z_in.read("META-INF/container.xml").decode("utf-8")
        m = re.search(r'full-path="([^"]+)"', container)
        xml_name = m.group(1)
        root = ET.fromstring(z_in.read(xml_name))
        
        # Find namespace
        ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
        def q(t):
            return f"{{{ns}}}{t}" if ns else t
            
        # Delete slurs in measure 52
        part = root.find(f".//{q('part')}[@id='P5']")
        measure_52 = part.find(f".//{q('measure')}[@number='52']")
        for note in measure_52.findall(q('note')):
            notations = note.find(q('notations'))
            if notations is not None:
                for slur in list(notations.findall(q('slur'))):
                    notations.remove(slur)
                    
        # Write back to a temporary MXL file
        with zipfile.ZipFile(temp_in, 'w') as z_out:
            # Copy META-INF/container.xml
            z_out.writestr("META-INF/container.xml", container)
            # Write modified XML
            z_out.writestr(xml_name, ET.tostring(root, encoding='utf-8'))
            # Copy other files if any
            for name in z_in.namelist():
                if name not in ("META-INF/container.xml", xml_name):
                    z_out.writestr(name, z_in.read(name))
                    
    # 2. Run fix_audiveris_mxl.py on scratch/noon-test-input.mxl
    print("Running fix_audiveris_mxl.py...")
    cmd = [sys.executable, 'scripts/fix_audiveris_mxl.py', temp_in, temp_out]
    res = subprocess.run(cmd, capture_output=True, text=True)
    print("stdout:", res.stdout)
    if res.returncode != 0:
        print("stderr:", res.stderr)
        print("fix_audiveris_mxl.py failed!")
        sys.exit(1)
        
    # 3. Parse scratch/noon-test-output.mxl and inspect measures 6, 30, and 52
    print("Inspecting slurs in output file...")
    with zipfile.ZipFile(temp_out) as z_out:
        root_out = ET.fromstring(z_out.read(xml_name))
        
    part_out = root_out.find(f".//{q('part')}[@id='P5']")
    
    # Check measure 52: should have NO slurs
    m52 = part_out.find(f".//{q('measure')}[@number='52']")
    m52_slurs = []
    for note in m52.findall(q('note')):
        slurs = note.findall(f".//{q('slur')}")
        if slurs:
            m52_slurs.extend(slurs)
    print(f"Measure 52 slurs count: {len(m52_slurs)}")
    if len(m52_slurs) > 0:
        print("FAIL: Measure 52 should not have any slurs restored!")
        sys.exit(1)
    else:
        print("PASS: Measure 52 has NO slurs.")
        
    # Check measure 6: should have slurs with dynamic positioning
    m6 = part_out.find(f".//{q('measure')}[@number='6']")
    m6_notes_slurs = []
    for idx, note in enumerate(m6.findall(q('note'))):
        pitch = note.find(q('pitch'))
        step = pitch.find(q('step')).text + pitch.find(q('octave')).text if pitch is not None else 'Rest'
        slurs = note.findall(f".//{q('slur')}")
        if slurs:
            slur_infos = [f"{s.get('type')},placement={s.get('placement')},def_y={s.get('default-y')}" for s in slurs]
            m6_notes_slurs.append((idx, step, slur_infos))
            print(f"Measure 6 note {idx} ({step}) slurs: {slur_infos}")
            
    # Expected: E4 (idx 4) should have placement=below, default-y=-15
    # G4 (idx 5) should have placement=above, default-y=-20
    # E4 (idx 6) stop slur
    # G4 (idx 7) stop slur
    success = True
    for idx, step, slur_infos in m6_notes_slurs:
        if idx == 4:
            if "placement=below" not in slur_infos[0] or "def_y=-15" not in slur_infos[0]:
                print(f"FAIL: E4 at idx 4 has wrong slur info: {slur_infos}")
                success = False
        elif idx == 5:
            if "placement=above" not in slur_infos[0] or "def_y=-20" not in slur_infos[0]:
                print(f"FAIL: G4 at idx 5 has wrong slur info: {slur_infos}")
                success = False
                
    if success:
        print("PASS: Measure 6 slurs have correct dynamically calculated placement and default-y offsets.")
    else:
        print("FAIL: Slur details mismatch.")
        sys.exit(1)

if __name__ == '__main__':
    main()
