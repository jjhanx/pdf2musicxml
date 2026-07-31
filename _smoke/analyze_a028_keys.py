#!/usr/bin/env python3
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path


def extract_xml(data: bytes) -> bytes:
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = [n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()]
            return z.read(names[0])
    return data


def local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def analyze(data: bytes, label: str) -> None:
    root = ET.fromstring(extract_xml(data))
    fifths_vals: list[int] = []
    naturals = 0
    for el in root.iter():
        lt = local(el.tag)
        if lt == "key":
            f = next((c for c in el if local(c.tag) == "fifths"), None)
            if f is not None and f.text:
                fifths_vals.append(int(f.text))
        if lt == "accidental" and (el.text or "").strip() == "natural":
            naturals += 1
    print(f"=== {label} ===")
    print("fifths counts:", Counter(fifths_vals))
    print("natural accidentals:", naturals)
    for part in root:
        if local(part.tag) != "part":
            continue
        pid = part.get("id")
        shown = 0
        for meas in part:
            if local(meas.tag) != "measure":
                continue
            for attr in meas:
                if local(attr.tag) != "attributes":
                    continue
                for key in attr:
                    if local(key.tag) != "key":
                        continue
                    f = next((c for c in key if local(c.tag) == "fifths"), None)
                    print(f"  part {pid} m{meas.get('number')} fifths={f.text if f is not None else None}")
                    shown += 1
            if shown >= 6:
                break


def main() -> int:
    zpath = Path(sys.argv[1] if len(sys.argv) > 1 else "omr-work-a028c3b5.zip")
    with zipfile.ZipFile(zpath) as z:
        for fname in ["audiveris_raw.mxl", "review.mxl", "omr_hitl_baseline.mxl"]:
            if fname in z.namelist():
                analyze(z.read(fname), fname)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
