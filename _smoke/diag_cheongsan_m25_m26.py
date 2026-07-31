#!/usr/bin/env python3
"""청산 review.mxl m24-28 voice·duration·timeline 진단."""
from __future__ import annotations

import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

MXL = Path("청산에 살리라 F/_inspect_0ea5/review.mxl")


def local(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def note_info(note: ET.Element) -> tuple[int, str, int]:
    voice = int(note.findtext(".//{*}voice") or note.findtext("voice") or "1"))
    staff = int(note.findtext(".//{*}staff") or note.findtext("staff") or "1"))
    dur = int(note.findtext(".//{*}duration") or note.findtext("duration") or "0"))
    rest = note.find(".//{*}rest") is not None or note.find("rest") is not None
    if rest:
        pitch = "R"
    else:
        p = note.find(".//{*}pitch") or note.find("pitch")
        if p is None:
            pitch = "?"
        else:
            pitch = (p.findtext(".//{*}step") or p.findtext("step") or "?") + (
                p.findtext(".//{*}octave") or p.findtext("octave") or "?"
            )
    chord = any(local(c.tag) == "chord" for c in note)
    return voice, f"{pitch}{'/ch' if chord else ''}", dur


def analyze_measure(meas: ET.Element) -> dict:
    div = 4
    for attr in meas.findall(".//{*}attributes") + meas.findall("attributes"):
        d = attr.findtext(".//{*}divisions") or attr.findtext("divisions")
        if d:
            div = int(d)
    voices: dict[int, int] = {}
    events = []
    for child in meas:
        tag = local(child.tag)
        if tag == "note":
            v, pitch, dur = note_info(child)
            if not any(local(c.tag) == "chord" for c in child):
                voices[v] = voices.get(v, 0) + dur
            events.append(("note", v, pitch, dur))
        elif tag == "backup":
            d = int(child.findtext(".//{*}duration") or child.findtext("duration") or "0"))
            events.append(("backup", d))
        elif tag == "forward":
            d = int(child.findtext(".//{*}duration") or child.findtext("duration") or "0")
            v = int(child.findtext(".//{*}voice") or child.findtext("voice") or "0")
            events.append(("forward", v, d))
        elif tag == "print":
            np = child.get("new-page") or child.get("new-system")
            events.append(("print", np or "?"))
    return {"div": div, "voices": voices, "events": events, "expected": div * 4}


def main() -> None:
    with zipfile.ZipFile(MXL) as z:
        root = ET.fromstring(z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]))
    for part in root:
        if local(part.tag) != "part":
            continue
        pid = part.get("id")
        for meas in part:
            if local(meas.tag) != "measure":
                continue
            n = int(meas.get("number") or 0)
            if n not in (24, 25, 26, 27, 28):
                continue
            info = analyze_measure(meas)
            bad = [v for v, tot in info["voices"].items() if tot not in (0, info["expected"])]
            flag = " BAD" if bad else ""
            print(f"{pid} m{n}{flag} voices={info['voices']} exp={info['expected']}")
            if n in (25, 26):
                print("   ", info["events"][:20], ("..." if len(info["events"]) > 20 else ""))


if __name__ == "__main__":
    main()
