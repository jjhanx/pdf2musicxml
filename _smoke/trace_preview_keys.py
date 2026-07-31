#!/usr/bin/env python3
"""Trace m1 keys through raw vs postprocessed vs preview pipeline."""
from __future__ import annotations

import io
import os
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
os.environ["AUDIVERIS_MXL_RHYTHM_FIX"] = "off"

from fix_audiveris_mxl import fix_mxl_file  # noqa: E402


def local(t: str) -> str:
    return t.split("}")[-1] if "}" in t else t


def m1_fifths(root: ET.Element, part_id: str) -> str:
    for part in root.findall(".//{*}part"):
        if part.get("id") != part_id:
            continue
        for meas in part.findall("{*}measure"):
            if meas.get("number") != "1":
                continue
            for attr in meas.findall("{*}attributes"):
                for key in attr.findall("{*}key"):
                    f = key.find("{*}fifths")
                    if f is not None and f.text is not None:
                        return f.text.strip()
            return "NONE"
    return "MISSING"


def load_mxl_bytes(data: bytes) -> ET.Element:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return ET.fromstring(z.read(name))


def main() -> int:
    zpath = ROOT / "omr-work-1b1b34df.zip"
    if not zpath.exists():
        print("zip missing", zpath)
        return 1
    with zipfile.ZipFile(zpath) as z:
        raw_b = z.read("audiveris_raw.mxl")
        rev_b = z.read("review.mxl") if "review.mxl" in z.namelist() else None

    raw_root = load_mxl_bytes(raw_b)
    print("=== audiveris_raw.mxl ===")
    for pid in ("P1", "P2", "P3", "P4", "P5"):
        print(f"  {pid} m1 fifths: {m1_fifths(raw_root, pid)}")

    if rev_b:
        rev_root = load_mxl_bytes(rev_b)
        print("=== review.mxl (zip) ===")
        for pid in ("P1", "P2", "P3", "P4", "P5"):
            print(f"  {pid} m1 fifths: {m1_fifths(rev_root, pid)}")

    td = tempfile.mkdtemp()
    src = Path(td) / "in.mxl"
    out = Path(td) / "out.mxl"
    src.write_bytes(raw_b)
    stats = fix_mxl_file(str(src), str(out))
    post_root = load_mxl_bytes(out.read_bytes())
    print("=== fix_audiveris_mxl default ===")
    print("  stats opening_key_explicit:", stats.get("opening_key_explicit"))
    for pid in ("P1", "P2", "P3", "P4", "P5"):
        print(f"  {pid} m1 fifths: {m1_fifths(post_root, pid)}")

    # first key per part
    print("=== first <key> measure (raw) ===")
    for part in raw_root.findall(".//{*}part"):
        pid = part.get("id")
        for meas in sorted(part.findall("{*}measure"), key=lambda m: int(m.get("number") or 0)):
            for attr in meas.findall("{*}attributes"):
                for key in attr.findall("{*}key"):
                    f = key.find("{*}fifths")
                    if f is not None:
                        print(f"  {pid} first at m{meas.get('number')} fifths={f.text}")
                        break
            else:
                continue
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
