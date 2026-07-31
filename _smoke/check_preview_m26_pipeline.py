"""Export preview XML + check m25-27 timeline per part after cleanup pipeline."""
import xml.etree.ElementTree as ET
from pathlib import Path
import subprocess
import sys

# Run TS pipeline export
subprocess.run([sys.executable.replace("python.exe", "npx") if False else "npx", "tsx", "_smoke/export_preview_pipeline.ts"], check=False)

def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag

def timeline_end(measure):
    pos = 0
    for child in measure:
        tag = local(child.tag)
        if tag == "backup":
            dur = int(child.find("{*}duration").text or 0)
            pos = max(0, pos - dur)
        elif tag == "forward":
            pos += int(child.find("{*}duration").text or 0)
        elif tag == "note":
            if child.find("{*}chord") is not None or child.find("{*}grace") is not None:
                continue
            pos += int(child.find("{*}duration").text or 0)
    return pos

def expected_div(measure, inherited=(4, 4, 4)):
    div, beats, bt = inherited
    for child in measure:
        if local(child.tag) != "attributes":
            continue
        d = child.find("{*}divisions")
        if d is not None and d.text:
            div = int(d.text)
        t = child.find("{*}time")
        if t is not None:
            b = t.find("{*}beats")
            btt = t.find("{*}beat-type")
            if b is not None and b.text:
                beats = int(b.text)
            if btt is not None and btt.text:
                bt = int(btt.text)
    exp = div * beats * 4 // bt
    return div, beats, bt, exp

path = Path("_smoke/_cheongsan_preview_pipeline.xml")
if not path.exists():
    print("preview xml missing — run export_preview_pipeline.ts first")
    sys.exit(1)

root = ET.parse(path).getroot()
parts = [p for p in root if local(p.tag) == "part"]
for part in parts:
    pid = part.get("id")
    timing = (4, 4, 4)
    for mnum in (25, 26, 27):
        meas = next((m for m in part if local(m.tag) == "measure" and m.get("number") == str(mnum)), None)
        if meas is None:
            print(pid, f"m{mnum}", "MISSING")
            continue
        div, beats, bt, exp = expected_div(meas, timing)
        timing = (div, beats, bt)
        end = timeline_end(meas)
        prints = sum(1 for c in meas if local(c.tag) == "print")
        width = meas.get("width")
        notes = [c for c in meas if local(c.tag) == "note"]
        first = notes[0] if notes else None
        fp = "?"
        if first is not None:
            p = first.find("{*}pitch")
            if p is not None:
                fp = p.find("{*}step").text + p.find("{*}octave").text
            elif first.find("{*}rest") is not None:
                fp = "rest"
        print(f"{pid} m{mnum} exp={exp} end={end} gap={exp-end} print={prints} width={width} first={fp}")
