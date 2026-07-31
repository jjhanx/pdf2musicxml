"""Simulate transformMeasureToSingleStaff (PL) — verify forward + direction order."""
import xml.etree.ElementTree as ET
from pathlib import Path

XML = Path(__file__).resolve().parents[1] / "_smoke" / "20e5_score.xml"


def local(el):
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def note_staff(note):
    st = note.find("{*}staff")
    return int(st.text) if st is not None and st.text else 1


def layer_forward(measure, staff_n):
    children = list(measure)
    first_idx = next(
        (i for i, c in enumerate(children) if local(c) == "note" and note_staff(c) == staff_n),
        -1,
    )
    if first_idx < 0:
        return 0
    for j in range(first_idx - 1, -1, -1):
        if local(children[j]) != "backup":
            continue
        d = children[j].find("{*}duration")
        if d is not None and d.text and d.text.isdigit():
            return int(d.text)
        return 0
    return 0


def main():
    root = ET.parse(XML).getroot()
    p5 = next(p for p in root.findall(".//{*}part") if p.get("id") == "P5")
    m = next(x for x in p5.findall("{*}measure") if x.get("number") == "17")
    lf = layer_forward(m, 2)
    print(f"P5 m17 layerForward(staff2)={lf}")
    backups = [
        (i, c.find("{*}duration").text)
        for i, c in enumerate(m)
        if local(c) == "backup"
    ]
    print(f"backups: {backups}")
    pl_notes = [
        (i, c.get("default-x"), c.find("{*}voice").text if c.find("{*}voice") is not None else None)
        for i, c in enumerate(m)
        if local(c) == "note" and note_staff(c) == 2 and c.find("{*}chord") is None
    ]
    print(f"first PL notes (non-chord): {pl_notes[:5]}")


if __name__ == "__main__":
    main()
