#!/usr/bin/env python3
"""Verify 12 reported issues in omr-work-2e86a8e0 (print measure = XML + 1)."""
import subprocess
import sys

MXL = "_smoke/omr-work-2e86a8e0/test.mxl"
CASES = [
    ("P5", 24, "2", "1 m25 PL triplet '3'"),
    ("P4", 34, None, "2 m35 B pickup"),
    ("P3", 35, None, "3 m36 T 2nd eighth"),
    ("P4", 35, None, "3 m36 B 2nd eighth"),
    ("P5", 44, "2", "4 m45 PL triplets"),
    ("P1", 45, None, "5 m46 S"),
    ("P3", 45, None, "5 m46 T"),
    ("P4", 45, None, "5 m46 B"),
    ("P1", 46, None, "6 m47 S"),
    ("P2", 46, None, "6 m47 A"),
    ("P3", 46, None, "6 m47 T"),
    ("P4", 46, None, "6 m47 B"),
    ("P5", 40, "1", "7 m48 PL? (m40 RH beamed->quarter)"),
    ("P5", 50, "1", "8 m51 PR natural"),
    ("P4", 51, None, "9 m52 B"),
    ("P1", 53, None, "10 m54 S"),
    ("P2", 53, None, "10 m54 A"),
    ("P3", 53, None, "10 m54 T"),
    ("P4", 53, None, "10 m54 B"),
    ("P1", 56, None, "11 m57 S"),
    ("P3", 56, None, "11 m57 T"),
    ("P5", 56, "1", "11 m57 PR"),
    ("P5", 56, "1", "12 m57 PR overlap"),
]

for pid, mnum, staff, label in CASES:
    args = [sys.executable, "_smoke/probe_measures.py", MXL, pid, str(mnum)]
    if staff:
        args.append(staff)
    print(f"\n=== {label} ===")
    subprocess.run(args, check=False)
