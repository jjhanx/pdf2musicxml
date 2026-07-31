#!/usr/bin/env python3
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def find_zip() -> Path:
    for p in [
        ROOT / "omr-work-8317959f.zip",
        ROOT / "너에게 난 나에게 넌" / "omr-work-8317959f.zip",
    ]:
        if p.is_file():
            return p
    raise FileNotFoundError("omr-work-8317959f.zip")


def extract(data: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])


def local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def analyze_mxl(data: bytes, label: str) -> None:
    root = ET.fromstring(extract(data))
    fifths: list[int] = []
    naturals = 0
    for el in root.iter():
        lt = local(el.tag)
        if lt == "key":
            f = next((c for c in el if local(c.tag) == "fifths"), None)
            if f is not None and f.text:
                fifths.append(int(f.text))
        if lt == "accidental" and (el.text or "").strip() == "natural":
            naturals += 1
    print(f"{label}: fifths={Counter(fifths)} naturals={naturals}")
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
                    pr = meas.find("{*}print")
                    pa = pr.attrib if pr is not None else {}
                    print(f"  {pid} m{meas.get('number')} fifths={f.text if f is not None else None} print={pa}")
                    shown += 1
            if shown >= 10:
                break


def main() -> int:
    zpath = find_zip()
    print("zip:", zpath)
    with zipfile.ZipFile(zpath) as z:
        for fname in ["audiveris_raw.mxl", "review.mxl"]:
            if fname in z.namelist():
                analyze_mxl(z.read(fname), fname)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
