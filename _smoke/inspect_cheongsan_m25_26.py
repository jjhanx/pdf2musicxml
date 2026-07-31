"""Inspect m25/m26 XML around page break for all parts."""
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

def local(t):
    return t.split("}", 1)[-1] if "}" in t else t

def child_tags(meas):
    return [local(c.tag) for c in meas]

def tail_summary(meas, n=8):
    tags = child_tags(meas)
    return tags[-n:]

mxl = Path("청산에 살리라 F/_inspect_0ea5/review.mxl")
with zipfile.ZipFile(mxl) as z:
    xml_name = [n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]
    root = ET.fromstring(z.read(xml_name))

for mid in ("25", "26"):
    print(f"\n=== measure {mid} ===")
    for part in root.findall(".//{*}part"):
        pid = part.get("id", "")
        if not pid.startswith("P"):
            continue
        meas = next((m for m in part if local(m.tag) == "measure" and m.get("number") == mid), None)
        if not meas:
            print(pid, "MISSING")
            continue
        notes = sum(1 for c in meas if local(c.tag) == "note")
        backups = sum(1 for c in meas if local(c.tag) == "backup")
        prints = [local(c.tag) for c in meas if local(c.tag) == "print"]
        print(f"{pid}: notes={notes} backups={backups} tail={tail_summary(meas)}")
