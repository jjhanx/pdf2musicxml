#!/usr/bin/env python3
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def dump_m26(zpath: Path) -> None:
    with zipfile.ZipFile(zpath) as z:
        mxls = [n for n in z.namelist() if n.endswith(".mxl")]
        if not mxls:
            print(zpath.name, "no mxl")
            return
        data = z.read(mxls[0])
        if data[:2] == b"PK":
            with zipfile.ZipFile(__import__("io").BytesIO(data)) as inner:
                xml_name = [n for n in inner.namelist() if n.endswith(".xml")][0]
                data = inner.read(xml_name)
        root = ET.fromstring(data)
    print("---", zpath.name)
    for pid in ("P1", "P2", "P3", "P4", "P5"):
        part = root.find(f".//{{*}}part[@id='{pid}']")
        if part is None:
            continue
        for m in part.findall("{*}measure"):
            if m.get("number") != "26":
                continue
            notes = []
            for n in m.findall("{*}note"):
                if n.find("{*}rest") is not None:
                    notes.append("R")
                    continue
                p = n.find("{*}pitch")
                ty = n.find("{*}type")
                dots = len(n.findall("{*}dot"))
                pitch = p.find("{*}step").text + p.find("{*}octave").text
                if dots:
                    pitch += "." * dots
                notes.append(f"{pitch}/{ty.text}")
            print(f"  {pid}: {notes}")


def main() -> None:
    for p in (
        Path("청산에 살리라 F/omr-work-09c31894.zip"),
        Path("청산에 살리라 F/omr-work-040d7129.zip"),
        Path("omr-work-0ea5ea52.zip"),
    ):
        if p.exists():
            dump_m26(p)


if __name__ == "__main__":
    main()
