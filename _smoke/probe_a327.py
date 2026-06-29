#!/usr/bin/env python3
"""Probe measures for a3276108 issues."""
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

TARGETS = {
    "P1": ["24", "41"],
    "P5": ["6", "20", "28", "30", "44", "48", "50", "56"],
}


def load(path):
    with zipfile.ZipFile(path) as z:
        c = z.read("META-INF/container.xml").decode()
        rf = re.search(r'full-path="([^"]+)"', c).group(1)
        return ET.parse(io.BytesIO(z.read(rf))).getroot()


def q(ns, t):
    return f"{{{ns}}}{t}" if ns else t


def txt(el):
    return el.text.strip() if el is not None and el.text else ""


def pitch(n, ns):
    p = n.find(q(ns, "pitch"))
    if p is None:
        return "R" if n.find(q(ns, "rest")) is not None else "?"
    s, o = txt(p.find(q(ns, "step"))), txt(p.find(q(ns, "octave")))
    a = txt(p.find(q(ns, "alter")))
    acc = {"1": "#", "-1": "b"}.get(a, "") if a else ""
    ac = n.find(q(ns, "accidental"))
    acs = f"({ac.text})" if ac is not None and ac.text else ""
    return f"{s}{acc}{o}{acs}"


def note_info(n, ns):
    ch = "+" if n.find(q(ns, "chord")) is not None else " "
    st = txt(n.find(q(ns, "staff"))) or "1"
    typ = txt(n.find(q(ns, "type"))) or "?"
    dur = txt(n.find(q(ns, "duration")))
    dot = "." if n.find(q(ns, "dot")) is not None else ""
    tm = "T" if n.find(q(ns, "time-modification")) is not None else ""
    beams = ",".join(b.text or "?" for b in n.findall(q(ns, "beam")))
    slurs = ",".join(f"{s.get('number')}:{s.get('type')}" for s in n.findall(".//" + q(ns, "slur")))
    ties = ",".join(t.get("type") for t in n.findall(q(ns, "tie")))
    extra = ""
    if beams:
        extra += f" beam={beams}"
    if slurs:
        extra += f" slur={slurs}"
    if ties:
        extra += f" tie={ties}"
    return f"{ch}{pitch(n, ns)}:{typ}{dot}{tm}({dur})[s{st}]{extra}"


def dir_info(measure, ns):
    out = []
    for d in measure.findall(q(ns, "direction")):
        parts = []
        for dt in d.findall(q(ns, "direction-type")):
            for child in dt:
                tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                t = txt(child) or child.get("type") or ""
                parts.append(f"{tag}:{t[:20]}")
        if parts:
            st = d.find(q(ns, "staff"))
            out.append(f"dir[s{txt(st) or '?'}]:{'|'.join(parts)}")
    return out


def dump(path):
    root = load(path)
    m = re.match(r"\{(.*)\}", root.tag)
    ns = m.group(1) if m else ""
    print(f"\n======== {path} ========")
    for part in root.findall(q(ns, "part")):
        pid = part.get("id")
        if pid not in TARGETS:
            continue
        for measure in part.findall(q(ns, "measure")):
            mn = measure.get("number")
            if mn not in TARGETS[pid]:
                continue
            staff_filter = None
            if pid == "P5" and mn in {"28", "44", "56"}:
                staff_filter = "2"
            notes = []
            for n in measure.findall(q(ns, "note")):
                st = txt(n.find(q(ns, "staff"))) or "1"
                if staff_filter and st != staff_filter:
                    continue
                notes.append(note_info(n, ns))
            dirs = dir_info(measure, ns) if pid == "P5" and mn in {"6", "20", "30"} else []
            print(f"{pid} m{mn}:")
            print(" ", " | ".join(notes))
            for d in dirs:
                print(" ", d)


for p in sys.argv[1:]:
    dump(p)
