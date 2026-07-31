"""Analyze P5 m25-27 staff2 (PL) voice durations in review.mxl."""
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

mxl = Path("청산에 살리라 F/_inspect_0ea5/review.mxl")
with zipfile.ZipFile(mxl) as z:
    xml_name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n)
    xml = z.read(xml_name).decode("utf-8")

root = ET.fromstring(xml)

def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag

def find_part(pid):
    for p in root.iter():
        if local(p.tag) == "part" and p.get("id") == pid:
            return p
    return None

def measure_timing(measure, inherited):
    div, beats, bt = inherited
    for attr in measure:
        if local(attr.tag) != "attributes":
            continue
        d = attr.findtext("divisions") or attr.findtext("{*}divisions")
        if d:
            div = int(d)
        for time in attr.iter():
            if local(time.tag) != "time":
                continue
            b = time.findtext("beats") or time.findtext("{*}beats")
            bt_el = time.findtext("beat-type") or time.findtext("{*}beat-type")
            if b:
                beats = int(b)
            if bt_el:
                bt = int(bt_el)
    exp = max(1, round(div * beats * 4 / bt))
    return div, beats, bt, exp

def timeline_end(measure):
    pos = 0
    for child in measure:
        tag = local(child.tag)
        if tag == "backup":
            pos = max(0, pos - int(child.findtext("duration") or child.findtext("{*}duration") or 0))
        elif tag == "forward":
            pos += int(child.findtext("duration") or child.findtext("{*}duration") or 0)
        elif tag == "note":
            if child.find("chord") is not None or child.find("{*}chord") is not None:
                continue
            if child.find("grace") is not None or child.find("{*}grace") is not None:
                continue
            pos += int(child.findtext("duration") or child.findtext("{*}duration") or 0)
    return pos

def voice_sums(measure, staff_n=None):
    by_voice = {}
    for note in measure:
        if local(note.tag) != "note":
            continue
        st_el = note.find("staff") or note.find("{*}staff")
        st = int(st_el.text) if st_el is not None and st_el.text else 1
        if staff_n is not None and st != staff_n:
            continue
        if note.find("chord") is not None or note.find("{*}chord") is not None:
            continue
        if note.find("grace") is not None or note.find("{*}grace") is not None:
            continue
        v_el = note.find("voice") or note.find("{*}voice")
        voice = (v_el.text if v_el is not None and v_el.text else "1").strip()
        dur = int(note.findtext("duration") or note.findtext("{*}duration") or 0)
        by_voice[voice] = by_voice.get(voice, 0) + dur
    return by_voice

for pid in ["P1", "P5"]:
    part = find_part(pid)
    if part is None:
        print(pid, "NOT FOUND")
        continue
    timing = (4, 4, 4)
    for measure in part:
        if local(measure.tag) != "measure":
            continue
        mn = measure.get("number")
        if mn not in ("24", "25", "26", "27", "28"):
            div, beats, bt, exp = measure_timing(measure, timing)
            timing = (div, beats, bt)
            continue
        div, beats, bt, exp = measure_timing(measure, timing)
        timing = (div, beats, bt)
        end = timeline_end(measure)
        prints = sum(1 for c in measure if local(c.tag) == "print")
        backups = sum(1 for c in measure if local(c.tag) == "backup")
        line = f"{pid} m{mn}: timeline={end}/{exp} print={prints} backup={backups}"
        if pid == "P5":
            vs2 = voice_sums(measure, staff_n=2)
            line += f" staff2_voices={vs2}"
        print(line)
