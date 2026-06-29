#!/usr/bin/env python3
"""Extract P5 m6 as standalone MusicXML for OSMD slur debug."""
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from fix_audiveris_mxl import fix_mxl_file  # noqa: E402

src = ROOT / "_smoke/omr-work-6855d546-full/audiveris_raw.mxl"
out_mxl = ROOT / "_smoke/_m6_slur_debug.mxl"
fix_mxl_file(src, out_mxl)

z = zipfile.ZipFile(out_mxl)
xml_name = [n for n in z.namelist() if n.endswith(".xml")][0]
root = ET.fromstring(z.read(xml_name))
if root.tag.startswith("{"):
    ns = root.tag[1 : root.tag.index("}")]
    q = lambda t: f"{{{ns}}}{t}"
else:
    ns = ""
    q = lambda t: t

# strip to piano part m6 only
part = None
for p in root.findall(q("part")):
    if p.get("id") == "P5":
        part = p
        break
if part is None:
    raise SystemExit("P5 missing")

keep = [part.find(q("measure")) if False else None]
measures = []
for m in part.findall(q("measure")):
    if m.get("number") in ("6", "30"):
        measures.append(m)
part[:] = measures

# minimal score
for child in list(root):
    if child.tag != q("part-list") and child is not part:
        root.remove(child)

# simplify part-list
pl = root.find(q("part-list"))
if pl is not None:
    for sp in list(pl):
        if sp.get("id") != "P5":
            pl.remove(sp)

out_xml = ROOT / "_smoke/m6_slur_debug.xml"
ET.ElementTree(root).write(out_xml, encoding="unicode", xml_declaration=True)
print("wrote", out_xml)
