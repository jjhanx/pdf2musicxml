import re
import shutil
import zipfile
from pathlib import Path

zpath = Path("너에게 난 나에게 넌/omr-work-6cbf1add.zip")
tmpdir = Path("_smoke/_6cbf_inspect")
if tmpdir.exists():
    shutil.rmtree(tmpdir)
tmpdir.mkdir(parents=True)
with zipfile.ZipFile(zpath) as z:
    z.extractall(tmpdir)
    print("manifest", z.read("manifest.json").decode()[:300])
mxl = tmpdir / "review.mxl"
mxdir = tmpdir / "mxl"
mxdir.mkdir()
with zipfile.ZipFile(mxl) as z:
    z.extractall(mxdir)
xml = next(p for p in mxdir.glob("*.xml") if "META" not in p.name.upper())
text = xml.read_text(encoding="utf-8")
for pid in ["P1", "P2", "P3", "P4", "P5"]:
    m = re.search(rf'<part id="{pid}".*?>(.*?)</part>', text, re.S)
    if not m:
        continue
    part = m.group(1)
    for mn in ["31", "32", "33", "34"]:
        mm = re.search(rf'<measure number="{mn}".*?>(.*?)</measure>', part, re.S)
        if not mm:
            continue
        meas = mm.group(1)
        attrs = re.findall(r"<attributes.*?</attributes>", meas, re.S)
        notes = re.findall(r"<note.*?(?:</note>|/>)", meas, re.S)
        pitches = []
        for n in notes:
            if "<rest" in n:
                continue
            st = re.search(r"<step>([^<]+)</step>", n)
            oc = re.search(r"<octave>(\d+)</octave>", n)
            if st and oc:
                pitches.append(st.group(1) + oc.group(1))
        print(f"{pid} m{mn} attrs={len(attrs)} pitches={pitches[:8]}")
        for a in attrs:
            print(" ", re.sub(r"\s+", " ", a)[:200])
