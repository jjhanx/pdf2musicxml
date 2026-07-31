#!/usr/bin/env python3
"""Confirm m64 PL from review.mxl: after prune, no stale forward and first PL at t=0."""
from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def note_staff(n: ET.Element) -> int:
    st = n.find("{*}staff")
    return int(st.text) if st is not None and st.text else 1


def note_voice(n: ET.Element) -> str:
    v = n.find("{*}voice")
    return v.text if v is not None and v.text else "1"


def forward_voice(el: ET.Element) -> str | None:
    v = el.find("{*}voice")
    return v.text if v is not None and v.text else None


def prune(measure: ET.Element, staff_n: int) -> None:
    for child in list(measure):
        tag = local(child.tag)
        if tag not in ("backup", "forward"):
            continue
        children = list(measure)
        idx = children.index(child)
        prev_staff = None
        for j in range(idx - 1, -1, -1):
            if local(children[j].tag) == "note":
                prev_staff = note_staff(children[j])
                break
        next_staff = None
        for j in range(idx + 1, len(children)):
            if local(children[j].tag) == "note":
                next_staff = note_staff(children[j])
                break
        if next_staff != staff_n:
            measure.remove(child)
            continue
        if tag == "forward" and prev_staff is None:
            fv = forward_voice(child)
            ok = False
            if fv is None:
                for j in range(idx + 1, len(children)):
                    if local(children[j].tag) == "note" and note_staff(children[j]) == staff_n:
                        ok = True
                        break
            else:
                for j in range(idx + 1, len(children)):
                    c = children[j]
                    if local(c.tag) != "note" or note_staff(c) != staff_n:
                        continue
                    if note_voice(c) == fv:
                        ok = True
                        break
            if not ok:
                measure.remove(child)
            continue
        if prev_staff is None or prev_staff != staff_n:
            measure.remove(child)


def main() -> None:
    zpath = Path("omr-work-23ddc764.zip")
    with zipfile.ZipFile(zpath) as z:
        data = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read([n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0])
    root = ET.fromstring(xml)
    part = root.find(".//{*}part[@id='P5']")
    assert part is not None
    m = None
    for meas in part.findall("{*}measure"):
        if meas.get("number") == "64":
            m = meas
            break
    assert m is not None
    for n in list(m):
        if local(n.tag) == "note" and note_staff(n) != 2:
            m.remove(n)
    print("after remove PR notes:")
    for c in m:
        t = local(c.tag)
        if t in ("backup", "forward"):
            d = c.find("{*}duration")
            v = c.find("{*}voice")
            print(f"  {t} d={d.text if d is not None else '?'} v={v.text if v is not None else '-'}")
        elif t == "note":
            print(f"  note s{note_staff(c)} v{note_voice(c)}")
    prune(m, 2)
    print("after prune:")
    seq = []
    for c in m:
        t = local(c.tag)
        if t in ("backup", "forward", "note"):
            seq.append(t)
            print(f"  {t}" + (f" v{forward_voice(c)}" if t == "forward" else ""))
    assert "forward" not in seq, seq
    assert seq and seq[0] == "note", seq
    print("m64 pl prune ok")


if __name__ == "__main__":
    main()
