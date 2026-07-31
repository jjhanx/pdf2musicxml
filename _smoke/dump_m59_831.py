#!/usr/bin/env python3
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
import io

zpath = Path("omr-work-8317959f.zip")
with zipfile.ZipFile(zpath) as z:
    mxl_name = "review.mxl"
    with zipfile.ZipFile(io.BytesIO(z.read(mxl_name))) as mz:
        xml_name = [n for n in mz.namelist() if n.endswith(".xml")][0]
        root = ET.fromstring(mz.read(xml_name))

parts = root.findall(".//{*}part")
print("parts", len(parts))
for pi, part in enumerate(parts):
    pid = part.get("id")
    for m in part.findall("{*}measure"):
        if m.get("number") != "59":
            continue
        print("\n=== part", pi, pid, "m59 children order ===")
        note_i = 0
        for child in m:
            tag = child.tag.split("}")[-1]
            if tag == "note":
                staff = child.find("{*}staff")
                st = staff.text if staff is not None else "?"
                typ = child.find("{*}type")
                t = typ.text if typ is not None else "?"
                dur = child.find("{*}duration")
                d = dur.text if dur is not None else "?"
                voice = child.find("{*}voice")
                v = voice.text if voice is not None else "?"
                chord = child.find("{*}chord") is not None
                pitch = child.find("{*}pitch")
                if pitch is not None:
                    step = pitch.find("{*}step").text
                    octv = pitch.find("{*}octave").text
                    alter = pitch.find("{*}alter")
                    alt = alter.text if alter is not None else ""
                    nm = f"{step}{alt}{octv}"
                else:
                    nm = "rest"
                tm = child.find("{*}time-modification")
                tm_s = ""
                if tm is not None:
                    an = tm.find("{*}actual-notes")
                    nn = tm.find("{*}normal-notes")
                    tm_s = f" tm={an.text if an is not None else '?'}:{nn.text if nn is not None else '?'}"
                tup = ""
                for notations in child.findall("{*}notations"):
                    for tuplet in notations.findall("{*}tuplet"):
                        tup = f" tuplet={tuplet.get('type')}"
                x = child.get("default-x", "")
                print(
                    f"  #{note_i} xml@{list(m).index(child)} staff={st} v={v} "
                    f"{'chord' if chord else 'lead'} {t} dur={d} {nm}{tm_s}{tup} x={x}"
                )
                note_i += 1
            elif tag in ("backup", "forward"):
                dur = child.find("{*}duration")
                v = child.find("{*}voice")
                print(f"  [{tag}] dur={dur.text if dur is not None else '?'} voice={v.text if v is not None else ''}")
