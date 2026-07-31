#!/usr/bin/env python3
"""Compare raw vs review m2 piano timeline in omr-work-b2d5000d."""
import io
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

ZIP = Path(r"D:/pdf2musicxml/omr-work-b2d5000d.zip")


def local(el):
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def load_mxl(name):
    with zipfile.ZipFile(ZIP) as z:
        data = z.read(name)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])
    return ET.fromstring(xml)


def max_staves(part):
    mx = 1
    for m in part.findall("{*}measure"):
        for st in m.findall(".//{*}staves"):
            if st.text and st.text.isdigit():
                mx = max(mx, int(st.text))
        for st in m.findall(".//{*}note/{*}staff"):
            if st.text and st.text.isdigit():
                mx = max(mx, int(st.text))
    return mx


def dump_m2(root, label):
    piano = [p for p in root.findall(".//{*}part") if max_staves(p) >= 2]
    print(f"\n======== {label} piano parts={[p.get('id') for p in piano]} ========")
    for p in piano:
        pid = p.get("id")
        m2 = next(m for m in p.findall("{*}measure") if m.get("number") == "2")
        print(f"\n--- {pid} m2 ---")
        t = 0
        idx = 0
        pr_pitch = 0
        pl_note = 0
        for child in m2:
            tag = local(child)
            if tag == "backup":
                d = int(child.find("{*}duration").text)
                t -= d
                print(f"  backup dur={d} t->{t}")
            elif tag == "forward":
                d = int(child.find("{*}duration").text)
                v = child.find("{*}voice")
                s = child.find("{*}staff")
                t += d
                print(f"  forward dur={d} voice={v.text if v is not None else None} staff={s.text if s is not None else None} t->{t}")
            elif tag == "note":
                idx += 1
                dur = int(child.find("{*}duration").text)
                staff = child.find("{*}staff")
                sn = staff.text if staff is not None else "1"
                voice = child.find("{*}voice")
                vn = voice.text if voice is not None else "1"
                chord = child.find("{*}chord") is not None
                pitch = child.find("{*}pitch")
                pname = "rest" if child.find("{*}rest") is not None else "?"
                if pitch is not None:
                    pname = pitch.find("{*}step").text + pitch.find("{*}octave").text
                dx = child.get("default-x", "")
                if sn == "1":
                    pr_pitch += 1
                    print(f"  PR#{pr_pitch} (note#{idx}) t={t} v={vn} dur={dur} dx={dx} {pname}{' CHORD' if chord else ''}")
                else:
                    if not chord:
                        pl_note += 1
                    print(f"  PL note#{pl_note if sn=='2' and not chord else '-'} (note#{idx}) t={t} v={vn} dur={dur} dx={dx} {pname}{' CHORD' if chord else ''}")
                if not chord:
                    t += dur


for name in ("audiveris_raw.mxl", "review.mxl", "omr_hitl_baseline.mxl"):
    try:
        dump_m2(load_mxl(name), name)
    except Exception as e:
        print(name, "ERR", e)
