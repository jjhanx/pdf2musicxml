#!/usr/bin/env python3
"""Verify b2d5000d review.m2 PL note 5 (G3) aligns with PR pitch 11 at t=8."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from omr_hitl_lib import rebuild_measure_timeline_clean, _ns, _local

ZIP = ROOT / "omr-work-b2d5000d.zip"


def load(name):
    with zipfile.ZipFile(ZIP) as z:
        data = z.read(name)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper()][0])
    return ET.fromstring(xml)


def note_staff(n):
    st = n.find("{*}staff")
    return int(st.text) if st is not None and st.text else 1


def prune_cross_staff(measure, staff_n):
    children = list(measure)
    for child in list(measure):
        tag = _local(child)
        if tag not in ("backup", "forward"):
            continue
        idx = children.index(child)
        prev_staff = None
        for j in range(idx - 1, -1, -1):
            if _local(children[j]) == "note":
                prev_staff = note_staff(children[j])
                break
        next_staff = None
        for j in range(idx + 1, len(children)):
            if _local(children[j]) == "note":
                next_staff = note_staff(children[j])
                break
        if next_staff != staff_n:
            measure.remove(child)
            continue
        if tag in ("backup", "forward") and (prev_staff is None or prev_staff != staff_n):
            measure.remove(child)


def per_voice_times(measure):
    voice_cursor = {}
    last_v = "1"
    pr_pitch = 0
    pl_notes = []
    for child in measure:
        tag = _local(child)
        if tag == "backup":
            v_el = child.find("{*}voice")
            v = v_el.text if v_el is not None and v_el.text else last_v
            d = int(child.find("{*}duration").text)
            voice_cursor[v] = max(0, voice_cursor.get(v, 0) - d)
        elif tag == "forward":
            v_el = child.find("{*}voice")
            v = v_el.text if v_el is not None and v_el.text else last_v
            d = int(child.find("{*}duration").text)
            voice_cursor[v] = voice_cursor.get(v, 0) + d
        elif tag == "note":
            st = note_staff(child)
            v_el = child.find("{*}voice")
            v = v_el.text if v_el is not None and v_el.text else "1"
            last_v = v
            t = voice_cursor.get(v, 0)
            chord = child.find("{*}chord") is not None
            dur = int(child.find("{*}duration").text)
            if st == 1:
                pr_pitch += 1
                if pr_pitch == 11:
                    pr11_t = t
            else:
                if not chord:
                    pl_notes.append((len(pl_notes) + 1, t, child))
            if not chord:
                voice_cursor[v] = t + dur
    return pr11_t, pl_notes


def simulate(label, root):
    p4 = next(p for p in root.findall(".//{*}part") if p.get("id") == "P4")
    m = deepcopy(next(x for x in p4.findall("{*}measure") if x.get("number") == "2"))
    prune_cross_staff(m, 2)
    pr11, pl = per_voice_times(m)
    pl5 = next((t for n, t, _ in pl if n == 5), None)
    print(f"{label}: PR#11 t={pr11} PL#5 t={pl5} match={pr11 == pl5}")


root_raw = load("audiveris_raw.mxl")
root_rev = load("review.mxl")
simulate("raw PL filter", root_raw)
simulate("review before repair", root_rev)

p4 = next(p for p in root_rev.findall(".//{*}part") if p.get("id") == "P4")
m2 = next(x for x in p4.findall("{*}measure") if x.get("number") == "2")
ns = _ns(root_rev)
rebuild_measure_timeline_clean(m2, ns)
simulate("review after rebuild", root_rev)
