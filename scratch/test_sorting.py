import sys
sys.path.insert(0, 'scripts')

from pathlib import Path
import xml.etree.ElementTree as ET
import omr_hitl_lib as l

def test_sorting():
    mxl_in = Path("noon.mxl")
    mxl_out = Path("test-sort-out.mxl")
    
    print("Loading noon.mxl...")
    files, root_path, root = l.load_mxl_root(mxl_in)
    
    print("Running cleanup_chord_beams_in_root (which now sorts all notes)...")
    cleaned = l.cleanup_chord_beams_in_root(root)
    print(f"Cleaned chord beams in {cleaned} measures.")
    
    print("Writing test-sort-out.mxl...")
    l.write_mxl_root(mxl_out, files, root_path, root)
    
    # Now verify the output file
    print("Verifying test-sort-out.mxl...")
    files2, root_path2, root2 = l.load_mxl_root(mxl_out)
    ns = l._ns(root2)
    part = l.find_part(root2, ns, 'P5')
    measure = l.find_measure(part, ns, '24')
    notes = l.list_note_elements(measure, ns)
    
    for idx in [22, 24]:
        note = notes[idx]
        pitch = note.find(l._q(ns, 'pitch'))
        p_str = pitch.find(l._q(ns, 'step')).text + pitch.find(l._q(ns, 'octave')).text if pitch is not None else 'rest'
        children = [c.tag.replace(f'{{{ns}}}', '') if ns else c.tag for c in note]
        print(f"Note #{idx} ({p_str}) child tags: {children}")

if __name__ == "__main__":
    test_sorting()
