"""Analyze clean_score_only.xml / final_output.xml for reported issue classes."""
import sys
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def local(el):
    t = el.tag
    return t.split("}", 1)[1] if t.startswith("{") else t


def text(el, name):
    c = el.find(name)
    return c.text.strip() if c is not None and c.text else None


def analyze(path):
    tree = ET.parse(path)
    root = tree.getroot()
    # strip namespace for convenience
    for el in root.iter():
        if el.tag.startswith("{"):
            el.tag = el.tag.split("}", 1)[1]

    print("=" * 70)
    print(path.name)
    parts_meta = {}
    for sp in root.iter("score-part"):
        parts_meta[sp.get("id")] = text(sp, "part-name")
    print("parts:", parts_meta)

    for part in root.findall("part"):
        pid = part.get("id")
        divisions = None
        beats, beat_type = None, None
        for measure in part.findall("measure"):
            mnum = measure.get("number")
            attr = measure.find("attributes")
            if attr is not None:
                d = text(attr, "divisions")
                if d:
                    divisions = int(d)
                t = attr.find("time")
                if t is not None:
                    beats = int(text(t, "beats"))
                    beat_type = int(text(t, "beat-type"))
            # per voice duration sum
            voice_dur = {}
            backups = 0
            for child in measure:
                tag = local(child)
                if tag == "note":
                    if child.find("chord") is not None:
                        continue
                    dur = text(child, "duration")
                    if dur is None:
                        continue
                    v = text(child, "voice") or "1"
                    st = text(child, "staff") or "1"
                    key = (st, v)
                    voice_dur[key] = voice_dur.get(key, 0) + int(dur)
                elif tag == "backup":
                    backups += 1
            if divisions and beats:
                expected = divisions * beats * Fraction(4, beat_type)
                for key, total in voice_dur.items():
                    if total != expected:
                        kind = "OVER" if total > expected else "under"
                        print(f"  {pid} m{mnum} staff/voice={key} {kind}: {total}/{expected} (div={divisions}, {beats}/{beat_type})")


for n in sys.argv[1:] or ["clean_score_only", "final_output"]:
    analyze(ROOT / "_smoke" / f"{n}.xml")
