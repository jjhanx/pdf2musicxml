"""Verify m33 SATB clef/key repair rules on omr-work-6cbf1add review.mxl."""
import re
import shutil
import zipfile
from pathlib import Path

zpath = Path("너에게 난 나에게 넌/omr-work-6cbf1add.zip")
tmpdir = Path("_smoke/_6cbf_repair_check")
if tmpdir.exists():
    shutil.rmtree(tmpdir)
tmpdir.mkdir(parents=True)
with zipfile.ZipFile(zpath) as z:
    z.extractall(tmpdir)
with zipfile.ZipFile(tmpdir / "review.mxl") as z:
    z.extractall(tmpdir / "mxl")
xml_path = next(p for p in (tmpdir / "mxl").glob("*.xml") if "META" not in p.name.upper())
text = xml_path.read_text(encoding="utf-8")

STEP_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def pitch_midi(note_xml: str):
    st = re.search(r"<step>([^<]+)</step>", note_xml)
    oc = re.search(r"<octave>(\d+)</octave>", note_xml)
    if not st or not oc:
        return None
    return (int(oc.group(1)) + 1) * 12 + STEP_SEMI.get(st.group(1).upper(), 0)


def measure_attrs(part_xml: str, mn: str):
    m = re.search(rf'<measure number="{mn}".*?>(.*?)</measure>', part_xml, re.S)
    if not m:
        return None, []
    meas = m.group(1)
    attrs = re.findall(r"<attributes.*?</attributes>", meas, re.S)
    notes = re.findall(r"<note.*?(?:</note>|/>)", meas, re.S)
    midis = [pitch_midi(n) for n in notes if "<rest" not in n and pitch_midi(n) is not None]
    med = sorted(midis)[len(midis) // 2] if midis else None
    return attrs, med


for pid in ["P1", "P2", "P3", "P4"]:
    part = re.search(rf'<part id="{pid}".*?>(.*?)</part>', text, re.S)
    if not part:
        continue
    attrs, med = measure_attrs(part.group(1), "33")
    has_f = any("<sign>F</sign>" in a for a in attrs or [])
    has_key = any("<key" in a for a in attrs or [])
    treble_misread = has_f and med is not None and med >= 52
    keep_f = has_f and med is not None and med < 52
    print(
        f"{pid} m33 median={med} F={has_f} key={has_key} "
        f"-> remove_misread={treble_misread} keep_bass_F={keep_f}"
    )
