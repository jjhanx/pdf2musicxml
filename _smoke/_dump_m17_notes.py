"""Dump m17 P5 staff1 note leaders."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import omr_hitl_lib as lib

ZIP = ROOT / "omr-work-0ea5ea52.zip"
with zipfile.ZipFile(ZIP) as z:
    data = z.read("review.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as inner:
    xml = inner.read(
        [n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0]
    )
root = ET.fromstring(xml)
fixes = [
    {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 3, "playOrder": 2, "staff": 1},
    {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 4, "playOrder": 3, "staff": 1},
    {"kind": "setPlayOrder", "partId": "P5", "measureMxl": "17", "noteIndex": 0, "playOrder": 1, "staff": 1},
]
lib.apply_fixes_to_root(root, fixes)

HITL = "{http://pdf2musicxml.local/hitl}data-hitl-play-order"

for part in root.iter():
    if not part.tag.endswith("part") or part.get("id") != "P5":
        continue
    for meas in part:
        if not meas.tag.endswith("measure") or meas.get("number") != "17":
            continue
        idx = 0
        for ch in meas:
            if not ch.tag.endswith("note"):
                continue
            st = next((c for c in ch if c.tag.endswith("staff")), None)
            if st is not None and (st.text or "").strip() not in ("", "1"):
                continue
            step_el = next((c for c in ch if c.tag.endswith("step")), None)
            oct_el = next((c for c in ch if c.tag.endswith("octave")), None)
            alter_el = next((c for c in ch if c.tag.endswith("alter")), None)
            dur = next((c for c in ch if c.tag.endswith("duration")), None)
            beams = [b.text for b in ch if b.tag.endswith("beam")]
            chord = any(c.tag.endswith("chord") for c in ch)
            po = ch.get(HITL) or ch.get("data-hitl-play-order")
            acc = "b" if alter_el is not None and alter_el.text == "-1" else ""
            pitch = f"{step_el.text if step_el is not None else '?'}{acc}{oct_el.text if oct_el is not None else ''}"
            print(
                idx,
                pitch,
                "dur",
                dur.text if dur is not None else "?",
                "beam",
                beams,
                "chord",
                chord,
                "po",
                po,
            )
            idx += 1
