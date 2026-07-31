#!/usr/bin/env python3
import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys_path = Path("scripts")
import sys
sys.path.insert(0, str(sys_path))
from omr_hitl_lib import measure_snapshot, load_mxl_root, _ns, _q, list_note_elements, _note_voice_staff  # noqa: E402

zpath = Path("고향의 봄/omr-work-5940c932.zip")
if not zpath.exists():
    zpath = Path("omr-work-5940c932.zip")

with zipfile.ZipFile(zpath) as z:
    data = z.read("review.mxl")
with zipfile.ZipFile(io.BytesIO(data)) as mz:
    xml_name = [n for n in mz.namelist() if n.endswith(".xml")][0]
    root = ET.fromstring(mz.read(xml_name))

ns = _ns(root)
parts = root.findall(".//{*}part")
print("parts", len(parts))
for pi, part in enumerate(parts):
    pid = part.get("id")
    for m in part.findall("{*}measure"):
        if m.get("number") != "59":
            continue
        print("\n=== part", pi, pid, "m59 ===")
        note_i = 0
        for child in m:
            tag = child.tag.split("}")[-1]
            if tag == "note":
                staff = child.find("{*}staff")
                st = staff.text if staff is not None else "?"
                if st != "2" and pid not in ("P4", "P5"):
                    note_i += 1
                    continue
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
                x = child.get("default-x", "")
                print(f"  #{note_i} staff={st} v={v} {'chord' if chord else 'lead':5} {t:7} dur={d:3} {nm:6} x={x}")
                note_i += 1
            elif tag in ("backup", "forward"):
                print(f"  [{tag}] dur={child.find('{*}duration').text if child.find('{*}duration') is not None else '?'}")

# snapshot for piano part
for pid in ("P4", "P5"):
    part = next((p for p in parts if p.get("id") == pid), None)
    if part is None:
        continue
    snap = measure_snapshot(root, ns, pid, "59")
    if not snap:
        continue
    print(f"\n--- snapshot part {pid} staff2 notes ---")
    for n in snap["notes"]:
        if n.get("staff") != 2:
            continue
        print(
            f"  #{n['index']} {n.get('type')} {'chord' if n.get('chord') else 'lead':5} "
            f"{n.get('pitch') or 'rest'} dur={n.get('duration')}"
        )
