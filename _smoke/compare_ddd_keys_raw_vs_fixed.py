#!/usr/bin/env python3
import io
import os
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
os.environ["AUDIVERIS_MXL_RHYTHM_FIX"] = "off"

from fix_audiveris_mxl import fix_mxl_file  # noqa: E402

ZIP = ROOT / "omr-work-ddd2447d.zip"

def local(t):
    return t.split("}")[-1]

def key_summary(data: bytes, label: str):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        root = ET.fromstring(z.read(name))
    events = []
    for part in root:
        if local(part.tag) != "part":
            continue
        pid = part.get("id") or "?"
        for meas in part:
            if local(meas.tag) != "measure":
                continue
            mn = meas.get("number") or "?"
            for attr in meas:
                if local(attr.tag) != "attributes":
                    continue
                for key in attr:
                    if local(key.tag) == "key":
                        f = next((c for c in key if local(c.tag) == "fifths"), None)
                        if f is not None and f.text:
                            pr = meas.find("{*}print")
                            br = ""
                            if pr is not None:
                                br = pr.attrib.get("new-page") or pr.attrib.get("new-system") or ""
                            events.append((pid, mn, int(f.text), br))
    print(f"\n=== {label} ===")
    print("first 10:", events[:10])
    print("fifths counts:", Counter(f for *_, f, __ in events))
    print("m1 keys:", [e for e in events if e[1] == "1"])
    print("m17 keys:", [e for e in events if e[1] == "17"])

td = Path(tempfile.mkdtemp())
raw = td / "raw.mxl"
fixed = td / "fixed.mxl"
with zipfile.ZipFile(ZIP) as z:
    raw.write_bytes(z.read("audiveris_raw.mxl"))

key_summary(raw.read_bytes(), "RAW")
stats = fix_mxl_file(raw, fixed)
print("stats keys:", {k: stats[k] for k in stats if "key" in k or "natural" in k or "sharp" in k or "misread" in k})
key_summary(fixed.read_bytes(), "FIXED default")
