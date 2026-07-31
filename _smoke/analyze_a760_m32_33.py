#!/usr/bin/env python3
"""Analyze m32-33 clef/key in omr-work-a760c5c1."""
import copy
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

Z = ROOT / "omr-work-a760c5c1.zip"
TMP = ROOT / "_smoke" / "_a760"
TMP.mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(Z) as z:
    for name in z.namelist():
        if name.endswith(".mxl"):
            (TMP / Path(name).name).write_bytes(z.read(name))

from fix_audiveris_mxl import (  # noqa: E402
    fix_mxl_file,
    mxl_ns_uri,
    _remove_redundant_courtesy_clefs_root,
    _repair_key_change_clef_misread_root,
)
from omr_hitl_lib import normalize_rest_durations_file  # noqa: E402


def load_mxl(path: Path) -> ET.Element:
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return ET.fromstring(z.read(name))


def q(ns, t):
    return f"{{{ns}}}{t}" if ns else t


def lt(el):
    return el.tag.split("}")[-1]


def dump_clefs_keys(root, label: str):
    ns = mxl_ns_uri(root)
    print(f"\n======== {label} ========")
    with open(TMP / "score-parts.txt", "a", encoding="utf-8") as f:
        pass
    parts = root.findall(q(ns, "part"))
    # score-part names
    sp = root.findall(".//{*}score-part")
    for s in sp:
        pid = s.get("id")
        pn = s.find(".//{*}part-name")
        print(f"  part {pid}: {pn.text if pn is not None else '?'}")
    for mn in ["31", "32", "33", "34", "35"]:
        print(f"--- m{mn} ---")
        for part in parts:
            pid = part.get("id")
            meas = next((m for m in part.findall(q(ns, "measure")) if m.get("number") == mn), None)
            if meas is None:
                continue
            bits = []
            for el in meas:
                if lt(el) != "attributes":
                    continue
                for c in el:
                    ct = lt(c)
                    if ct == "clef":
                        sign = c.find(q(ns, "sign"))
                        num = c.get("number") or "1"
                        line = c.find(q(ns, "line"))
                        bits.append(
                            f"clef#{num}={sign.text if sign is not None else '?'}"
                            + (f"L{line.text}" if line is not None else "")
                        )
                    elif ct == "key":
                        f = c.find(q(ns, "fifths"))
                        num = c.get("number") or "?"
                        bits.append(f"key#{num}={f.text if f is not None else '?'}")
                    elif ct == "staves":
                        bits.append(f"staves={c.text}")
            if bits:
                print(f"  {pid}: " + ", ".join(bits))


raw_path = TMP / "audiveris_raw.mxl"
if not raw_path.exists():
    raw_path = next(TMP.glob("*.mxl"))
fixed_path = TMP / "fixed.mxl"

raw = load_mxl(raw_path)
dump_clefs_keys(raw, f"RAW {raw_path.name}")

# step fix
import shutil

shutil.copy(raw_path, fixed_path)
normalize_rest_durations_file(fixed_path)
stats = fix_mxl_file(raw_path, fixed_path)
print("\nfix stats:", {k: v for k, v in stats.items() if v and k.endswith(("fixed", "removed", "rebuilt"))})

fixed = load_mxl(fixed_path)
dump_clefs_keys(fixed, "FIXED")
