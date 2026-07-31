import io
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, "scripts")
from omr_hitl_lib import (  # noqa: E402
    _ns,
    _q,
    _note_stem_direction,
    _parse_default_x,
    _note_duration,
    _local,
    _note_voice_staff,
)

z = zipfile.ZipFile("omr-work-410e0c25.zip")
root = ET.fromstring(
    zipfile.ZipFile(io.BytesIO(z.read("review.mxl"))).read(
        [n for n in zipfile.ZipFile(io.BytesIO(z.read("review.mxl"))).namelist() if n.endswith(".xml")][0]
    )
)
ns = _ns(root)
part = root.find('.//{*}part[@id="P5"]')
m7 = next(x for x in part.findall("{*}measure") if x.get("number") == "7")
print("m7 PL notes before repair:")
for c in m7:
    loc = _local(c.tag)
    if loc in ("backup", "forward"):
        print(" ", loc, c.findtext(_q(ns, "duration")))
    elif loc == "note":
        v, st = _note_voice_staff(c, ns)
        if st != "2":
            continue
        chord = c.find(_q(ns, "chord")) is not None
        step = c.findtext(_q(ns, "step")) or ("rest" if c.find(_q(ns, "rest")) is not None else "?")
        print(
            f"  v={v} {step} chord={chord} stem={_note_stem_direction(c, ns)} "
            f"dx={_parse_default_x(c)} dur={_note_duration(c, ns)}"
        )
