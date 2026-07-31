#!/usr/bin/env python3
"""Summarize key signature patterns in all omr-work zips."""
import io
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def local(t):
    return t.split("}")[-1] if "}" in t else t


def profile_zip(zpath: Path) -> dict | None:
    with zipfile.ZipFile(zpath) as z:
        if "audiveris_raw.mxl" not in z.namelist():
            return None
        data = z.read("audiveris_raw.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()][0]))
    parts = [p for p in root if local(p.tag) == "part"]
    if not parts:
        return None
    p1 = parts[0]
    keys = []
    m1 = None
    for meas in p1:
        if local(meas.tag) != "measure":
            continue
        mn = int(meas.get("number") or 0)
        for attr in meas:
            if local(attr.tag) != "attributes":
                continue
            for key in attr:
                if local(key.tag) != "key":
                    continue
                f = next((c for c in key if local(c.tag) == "fifths"), None)
                if f is not None and f.text:
                    fv = int(f.text)
                    keys.append((mn, fv))
                    if mn == 1:
                        m1 = fv
    first_m = keys[0][0] if keys else None
    return {
        "name": zpath.name,
        "part_count": len(parts),
        "p1_key_count": len(keys),
        "p1_m1": m1,
        "p1_first_m": first_m,
        "p1_changes": len({f for _, f in keys}),
        "pattern": (
            "no_keys"
            if not keys
            else "m1_key"
            if first_m == 1
            else "mid_change_no_m1"
            if first_m and first_m > 1 and m1 is None
            else "other"
        ),
    }


for z in sorted(ROOT.glob("omr-work-*.zip")):
    p = profile_zip(z)
    if p is None:
        continue
    print(f"{p['name']:28} pattern={p['pattern']:18} p1_m1={p['p1_m1']} first_m={p['p1_first_m']} keys={p['p1_key_count']}")
