#!/usr/bin/env python3
"""Dump m64-66 for SATB with ties/slurs and clefs."""
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
    alter = pitch.find("{*}alter")
    a = alter.text if alter is not None and alter.text else ""
    if a == "1":
        a = "#"
    elif a == "-1":
        a = "b"
    return f"{pitch.find('{*}step').text}{a}{pitch.find('{*}octave').text}"


def dump(zpath: Path) -> None:
    with zipfile.ZipFile(zpath) as z:
        data = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0])
    root = ET.fromstring(xml)
    labels = {}
    for sp in root.findall(".//{*}score-part"):
        name = sp.find("{*}part-name")
        labels[sp.get("id")] = name.text if name is not None else sp.get("id")
    print(f"=== {zpath.name} labels={labels} ===")
    for pid in ["P1", "P2", "P3", "P4"]:
        part = None
        for p in root.findall("{*}part"):
            if p.get("id") == pid:
                part = p
                break
        if part is None:
            continue
        for m in part.findall("{*}measure"):
            num = m.get("number")
            if num not in ("63", "64", "65", "66"):
                continue
            notes = [c for c in m if local(c.tag) == "note"]
            attrs = []
            for a in m.findall("{*}attributes"):
                for clef in a.findall("{*}clef"):
                    sign = clef.find("{*}sign")
                    line = clef.find("{*}line")
                    attrs.append(f"clef {sign.text if sign is not None else '?'}/{line.text if line is not None else '?'}")
            print(f"{labels.get(pid,pid)}({pid}) m{num} {attrs}")
            for c in notes:
                stem = c.find("{*}stem")
                stem_t = stem.text if stem is not None else "-"
                typ = c.find("{*}type")
                typ_t = typ.text if typ is not None else "?"
                marks = []
                for t in c.findall("{*}tie"):
                    marks.append(f"tie@{t.get('type')}/{t.get('placement')}")
                notations = c.find("{*}notations")
                if notations is not None:
                    for t in notations.findall("{*}tied"):
                        marks.append(
                            f"tied@{t.get('type')}/pl={t.get('placement')}/or={t.get('orientation')}/y={t.get('default-y')}"
                        )
                    for s in notations.findall("{*}slur"):
                        marks.append(
                            f"slur@{s.get('type')}/pl={s.get('placement')}/or={s.get('orientation')}/y={s.get('default-y')}"
                        )
                print(f"  {pitch_of(c)} {typ_t} stem={stem_t} {marks}")


if __name__ == "__main__":
    for z in ["omr-work-23ddc764.zip", "청산에 살리라 F/omr-work-ddbf5994.zip", "omr-work-0ea5ea52.zip"]:
        p = Path(z)
        if p.exists():
            dump(p)
