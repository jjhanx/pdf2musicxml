#!/usr/bin/env python3
import importlib.util, io, re, zipfile, xml.etree.ElementTree as ET, tempfile, os
from pathlib import Path
spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

raw = Path("_smoke/omr-work-6855d546-full/audiveris_raw.mxl")
fd, tmp = tempfile.mkstemp(suffix=".mxl")
os.close(fd)
fix.fix_mxl_file(raw, tmp)
z = zipfile.ZipFile(tmp)
c = z.read("META-INF/container.xml").decode()
rf = re.search(r'full-path="([^"]+)"', c).group(1)
root = ET.parse(io.BytesIO(z.read(rf))).getroot()
ns = fix.mxl_ns_uri(root)
part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]

for mno in ("6", "59"):
    for m in part.findall(fix.qname(ns, "measure")):
        if m.get("number") != mno:
            continue
        print(f"\n=== m{mno} all notes with slurs ===")
        for note in m.findall(fix.qname(ns, "note")):
            st = note.find(fix.qname(ns, "staff"))
            if st is not None and st.text != "1":
                continue
            pitch = note.find(fix.qname(ns, "pitch"))
            if pitch is None:
                continue
            lab = pitch.find(fix.qname(ns, "step")).text + pitch.find(fix.qname(ns, "octave")).text
            slurs = []
            for n in note.findall(fix.qname(ns, "notations")):
                for s in n.findall(fix.qname(ns, "slur")):
                    slurs.append((s.get("number"), s.get("type"), s.get("placement"), s.get("default-y")))
            if slurs:
                ch = note.find(fix.qname(ns, "chord")) is not None
                print(f"  {lab} chord={ch} {slurs}")
        print("groups:")
        for (st, voice), groups in fix._voice_groups(m, ns).items():
            if st != "1":
                continue
            for i, g in enumerate(groups):
                print(f"  {i}: {fix._chord_pitch_signature(g, ns)} type={fix._note_type_text(g[0],ns)}")

os.unlink(tmp)
