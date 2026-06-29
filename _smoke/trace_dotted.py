#!/usr/bin/env python3
import importlib.util, copy, io, re, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location("fix", Path("scripts/fix_audiveris_mxl.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()

root = load("_smoke/omr-work-a26ecec0-full/audiveris_raw.mxl")
ns = re.match(r"\{(.*)\}", root.tag).group(1) if re.match(r"\{(.*)\}", root.tag) else ""
part = [p for p in root.findall(fix.qname(ns, "part")) if p.get("id") == "P5"][0]
for mn in ("41","42","43","44","45"):
    for measure, div, exp in fix._iter_measures_with_timing(part, ns):
        if measure.get("number") != mn:
            continue
        m = copy.deepcopy(measure)
        d, l = fix._repair_dotted_quarter_misread_on_measure(m, ns, div, exp) if hasattr(fix, '_repair_dotted_quarter_misread_on_measure') else (0,0)
        d2, l2 = fix._repair_dotted_quarter_misread(part, ns) if mn=='41' else (0,0)
