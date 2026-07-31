"""Dump raw m17 P5 staff 1 from omr-work-4637986c."""
import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ZIP = Path(__file__).resolve().parents[1] / "청산에 살리라 F" / "omr-work-4637986c.zip"
with zipfile.ZipFile(ZIP) as z:
    data = z.read("review.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as inner:
    xml = inner.read(
        [n for n in inner.namelist() if n.endswith(".xml") and "META" not in n.upper()][0]
    )
root = ET.fromstring(xml)


def local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


for part in root.iter():
    if local(part.tag) != "part" or part.get("id") != "P5":
        continue
    for meas in part:
        if local(meas.tag) != "measure" or meas.get("number") != "17":
            continue
        print("=== raw m17 P5 ===")
        for c in meas:
            tag = local(c.tag)
            if tag == "note":
                pitch_el = next((x for x in c if local(x.tag) == "pitch"), None)
                if pitch_el is None:
                    continue
                step = next((x.text for x in pitch_el if local(x.tag) == "step"), "?")
                oct_ = next((x.text for x in pitch_el if local(x.tag) == "octave"), "?")
                if any(local(x.tag) == "chord" for x in c):
                    continue
                v = next((x.text for x in c if local(x.tag) == "voice"), "?")
                st = next((x.text for x in c if local(x.tag) == "staff"), "?")
                po = c.get("data-hitl-play-order")
                dur = next((x.text for x in c if local(x.tag) == "duration"), "?")
                typ = next((x.text for x in c if local(x.tag) == "type"), "?")
                x = c.get("default-x")
                print(f"  {step}{oct_} v={v} staff={st} po={po} dur={dur} type={typ} x={x}")
            elif tag in ("forward", "backup"):
                v = next((x.text for x in c if local(x.tag) == "voice"), "?")
                d = next((x.text for x in c if local(x.tag) == "duration"), "?")
                print(f"  <{tag}> v={v} dur={d}")
