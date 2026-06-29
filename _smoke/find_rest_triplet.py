#!/usr/bin/env python3
"""Find which measure triggers rest+eighth triplet repair."""
import importlib.util
import io, re, sys, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "fix", Path("scripts/fix_audiveris_mxl.py")
)
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

path = sys.argv[1]
root = load(path)
ns = re.match(r"\{(.*)\}", root.tag).group(1)
for part in root.findall(fix.qname(ns, "part")):
    if part.get("id") != "P5":
        continue
    max_staff = fix._part_max_staves(part, ns)
    for measure in part.findall(fix.qname(ns, "measure")):
        mn = measure.get("number")
        div, exp = fix._measure_divisions_expected(measure, ns, part)
        n = fix._repair_eighth_rest_plus_two_eighths_triplet(
            measure, ns, max_staff, div, exp
        )
        if n:
            print(f"m{mn}: rest_eighth_triplet would fix {n}")
