import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib

def local(t):
    return t.split("}")[-1] if "}" in t else t

def dump_measure(meas, title):
    print(title)
    idx = 0
    for el in meas:
        tag = local(el.tag)
        if tag == "forward":
            v = el.find("voice")
            d = el.find("duration")
            print(f"  forward v={v.text if v is not None else '?'} d={d.text if d is not None else '?'}")
        elif tag == "backup":
            v = el.find("voice")
            d = el.find("duration")
            print(f"  backup v={v.text if v is not None else '?'} d={d.text if d is not None else '?'}")
        elif tag == "note":
            p = el.find("pitch")
            step = p.find("step").text if p is not None else "?"
            oct = p.find("octave").text if p is not None else "?"
            alter = p.find("alter")
            acc = alter.text if alter is not None else ""
            ch = el.find("chord") is not None
            v = el.find("voice")
            beam = el.find("beam")
            typ = el.find("type")
            print(
                f"  #{idx} {step}{'b' if acc == '-1' else ''}{oct} "
                f"{'chord ' if ch else ''}v={v.text if v is not None else '?'} "
                f"x={el.get('default-x')} type={typ.text if typ is not None else '?'} "
                f"beam={beam.text if beam is not None else ''}"
            )
            if not ch:
                idx += 1

ZIP = ROOT / "omr-work-0ea5ea52.zip"
with zipfile.ZipFile(ZIP) as z:
    data = z.read("review.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as inner:
    xml = inner.read([n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])
root = ET.fromstring(xml)
for part in root.iter():
    if local(part.tag) != "part" or part.get("id") != "P5":
        continue
    for meas in part:
        if local(meas.tag) == "measure" and meas.get("number") == "17":
            dump_measure(meas, "m17 RAW review:")
            break

lib.apply_fixes_to_root(
    root,
    [{"kind": "linkParallelOnsets", "partId": "P5", "measureMxl": "17", "staff": 1, "parallelNoteIndices": [0, 1, 3]}],
)
for part in root.iter():
    if local(part.tag) != "part" or part.get("id") != "P5":
        continue
    for meas in part:
        if local(meas.tag) == "measure" and meas.get("number") == "17":
            dump_measure(meas, "m17 after linkParallel [0,1,3]:")
            break
