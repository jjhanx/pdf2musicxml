#!/usr/bin/env python3
import io
import sys
import zipfile
from pathlib import Path

import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import (  # noqa: E402
    _ns,
    _q,
    find_measure,
    find_part,
    measure_elements_snapshot,
    list_note_elements,
    _note_voice_staff,
)

zpath = Path("omr-work-c83a3f2c.zip")
with zipfile.ZipFile(zpath) as z:
    data = z.read("review.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as mz:
    xml_name = [n for n in mz.namelist() if n.endswith(".xml")][0]
    root = ET.fromstring(mz.read(xml_name))

ns = _ns(root)
part = find_part(root, ns, "P3")
m = find_measure(part, ns, "59")
print("=== XML doc order staff2 ===")
note_i = 0
for child in m:
    tag = child.tag.split("}")[-1]
    if tag == "note":
        staff_el = child.find(_q(ns, "staff"))
        st = staff_el.text if staff_el is not None else "?"
        if st != "2":
            note_i += 1
            continue
        typ = child.find(_q(ns, "type"))
        t = typ.text if typ is not None else "?"
        voice = child.find(_q(ns, "voice"))
        v = voice.text if voice is not None else "?"
        chord = child.find(_q(ns, "chord")) is not None
        tm = child.find(_q(ns, "time-modification"))
        tup = ""
        if tm is not None:
            an = tm.find(_q(ns, "actual-notes"))
            nn = tm.find(_q(ns, "normal-notes"))
            nt = tm.find(_q(ns, "normal-type"))
            tup = f" tm={an.text if an is not None else '?'}:{nn.text if nn is not None else '?'}:{nt.text if nt is not None else '?'}"
        notations = child.find(_q(ns, "notations"))
        tuplet = ""
        if notations is not None:
            tups = notations.findall(_q(ns, "tuplet"))
            for tu in tups:
                tuplet += f" tup(type={tu.get('type')} sb={tu.get('show-bracket')} br={tu.get('bracket')})"
        beams = [b.text for b in child.findall(_q(ns, "beam"))]
        x = child.get("default-x", "")
        print(
            f"  #{note_i} v={v} {'chord' if chord else 'lead':5} {t:7} "
            f"x={x}{tup}{tuplet} beams={beams}"
        )
        note_i += 1
    elif tag in ("backup", "forward"):
        dur = child.find(_q(ns, "duration"))
        print(f"  [{tag}] dur={dur.text if dur is not None else '?'}")

print("\n=== snapshot staff2 ===")
for n in measure_elements_snapshot(m, ns):
    if n.get("staff") != 2:
        continue
    print(
        f"  #{n['index']} {n.get('type')} {'chord' if n.get('chord') else 'lead':5} "
        f"x={n.get('defaultX')} tm={n.get('timeMod')} tup={n.get('tuplet')} beams={n.get('beams')}"
    )
