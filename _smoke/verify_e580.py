#!/usr/bin/env python3
"""Quick verification of reported issue measures."""
import subprocess
import sys

CASES = [
    ("P5", 16, "m17 PL slur"),
    ("P5", 24, "m25 PL triplet"),
    ("P5", 26, "m27 PL triplet plc"),
    ("P5", 27, "m28 PL triplet"),
    ("P4", 34, "m35 B rest"),
    ("P3", 35, "m36 T rhythm"),
    ("P4", 35, "m36 B rhythm"),
    ("P5", 55, "m56 PR order"),
    ("P1", 45, "m46 S rhythm"),
    ("P1", 46, "m47 S rhythm"),
]

mxl = "_smoke/omr-work-e580e133/test.mxl"
for pid, mnum, label in CASES:
    print(f"\n=== {label} ({pid} m{mnum}) ===")
    subprocess.run([sys.executable, "_smoke/probe_measures.py", mxl, pid, str(mnum)], check=False)
