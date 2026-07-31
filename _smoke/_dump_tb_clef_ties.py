#!/usr/bin/env python3
"""Find ties near m65 and clefs for T/B."""
from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def pitch_of(n: ET.Element) -> str:
    pitch = n.find("{*}pitch")
    if pitch is None:
        return "rest" if n.find("{*}rest") is not None else "?"
    step = pitch.find("{*}step").text
    octv = pitch.find("{*}octave").text
    alter = pitch.find("{*}alter")
    a = ""
    if alter is not None and alter.text == "1":
        a = "#"
    elif alter is not None and alter.text == "-1":
        a = "b"
    return f"{step}{a}{octv}"


def main() -> None:
    zpath = Path("omr-work-23ddc764.zip")
    with zipfile.ZipFile(zpath) as z:
        data = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0])
    root = ET.fromstring(xml)

    for pid in ["P3", "P4"]:
        part = next(p for p in root.findall("{*}part") if p.get("id") == pid)
        clef = "G?"
        for m in part.findall("{*}measure"):
            for a in m.findall("{*}attributes"):
                for c in a.findall("{*}clef"):
                    sign = c.find("{*}sign")
                    line = c.find("{*}line")
                    clef = f"{sign.text}/{line.text}" if sign is not None else clef
            num = int(m.get("number") or 0)
            if num < 60 or num > 70:
                continue
            for n in m:
                if local(n.tag) != "note":
                    continue
                marks = []
                for t in n.findall("{*}tie"):
                    marks.append(f"tie:{t.get('type')}")
                notations = n.find("{*}notations")
                if notations is not None:
                    for t in notations.findall("{*}tied"):
                        marks.append(
                            f"tied:{t.get('type')}:pl={t.get('placement')}:y={t.get('default-y')}"
                        )
                    for s in notations.findall("{*}slur"):
                        marks.append(f"slur:{s.get('type')}:pl={s.get('placement')}")
                if not marks and pitch_of(n) == "rest":
                    continue
                if marks or num in (64, 65, 66):
                    stem = n.find("{*}stem")
                    print(
                        f"{pid} m{num} clef={clef} {pitch_of(n)} stem={stem.text if stem is not None else '-'} {marks}"
                    )


if __name__ == "__main__":
    main()
