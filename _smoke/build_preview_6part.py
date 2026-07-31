#!/usr/bin/env python3
"""Build 6-part preview XML (P5 split) + cleanup, write for OSMD test."""
import copy
import xml.etree.ElementTree as ET
from pathlib import Path


def loc(t):
    return t.split("}", 1)[-1]


def note_staff(note):
    st = note.find("{*}staff")
    return int(st.text) if st is not None and (st.text or "").strip().isdigit() else 1


def has_note_before(meas, idx):
    kids = list(meas)
    return any(loc(kids[i].tag) == "note" for i in range(idx))


def has_note_after(meas, idx):
    kids = list(meas)
    return any(loc(kids[i].tag) == "note" for i in range(idx + 1, len(kids)))


def remove_dangling(meas):
    n = 0
    for el in list(meas):
        if loc(el.tag) not in ("backup", "forward"):
            continue
        idx = list(meas).index(el)
        if not has_note_before(meas, idx) or not has_note_after(meas, idx):
            meas.remove(el)
            n += 1
    return n


def strip_print_breaks(doc):
    for el in doc.iter():
        if loc(el.tag) != "print":
            continue
        if el.get("new-page") == "yes":
            del el.attrib["new-page"]
        if el.get("new-system") == "yes":
            del el.attrib["new-system"]
        if not el.attrib and len(el) == 0 and not (el.text or "").strip():
            parent = None
            for p in doc.iter():
                if el in list(p):
                    parent = p
                    break
            if parent is not None:
                parent.remove(el)


def prune_cross_staff(meas, staff_n):
    kids = list(meas)
    for el in list(meas):
        if loc(el.tag) not in ("backup", "forward"):
            continue
        idx = kids.index(el)
        prev_staff = next(
            (note_staff(kids[j]) for j in range(idx - 1, -1, -1) if loc(kids[j].tag) == "note"),
            None,
        )
        next_staff = next(
            (note_staff(kids[j]) for j in range(idx + 1, len(kids)) if loc(kids[j].tag) == "note"),
            None,
        )
        if next_staff != staff_n:
            meas.remove(el)
            continue
        if prev_staff is None or prev_staff != staff_n:
            meas.remove(el)


def transform_measure(meas, staff_n):
    for note in list(meas):
        if loc(note.tag) == "note" and note_staff(note) != staff_n:
            meas.remove(note)
    for note in meas.findall("{*}note"):
        st = note.find("{*}staff")
        if st is not None:
            st.text = "1"
    prune_cross_staff(meas, staff_n)
    remove_dangling(meas)


def split_part(part, part_id):
    pr = copy.deepcopy(part)
    pl = copy.deepcopy(part)
    pr.set("id", f"{part_id}__PR")
    pl.set("id", f"{part_id}__PL")
    for meas in pr.findall("{*}measure"):
        transform_measure(meas, 1)
    for meas in pl.findall("{*}measure"):
        transform_measure(meas, 2)
    return pr, pl


def strip_all_print(doc):
    for el in list(doc.iter()):
        if loc(el.tag) != "print":
            continue
        for parent in doc.iter():
            if el in list(parent):
                parent.remove(el)
                break


def strip_measure_width_and_default_xy(doc):
    for el in doc.iter():
        if loc(el.tag) == "measure":
            el.attrib.pop("width", None)
        el.attrib.pop("default-x", None)
        el.attrib.pop("default-y", None)


def main():
    raw = Path("_smoke/_cheongsan_review.xml").read_text(encoding="utf-8")
    root = ET.fromstring(raw)
    removed = 0
    for part in root.findall(".//{*}part"):
        for meas in part.findall("{*}measure"):
            removed += remove_dangling(meas)
    strip_all_print(root)
    strip_measure_width_and_default_xy(root)

    p5 = root.find('.//{*}part[@id="P5"]')
    if p5 is not None:
        parent = None
        for cand in root:
            if p5 in list(cand):
                parent = cand
                break
        if parent is None:
            parent = root
        pr, pl = split_part(p5, "P5")
        idx = list(parent).index(p5)
        parent.insert(idx, pr)
        parent.insert(idx + 1, pl)
        parent.remove(p5)

        part_list = root.find(".//{*}part-list")
        sp5 = part_list.find('.//{*}score-part[@id="P5"]') if part_list is not None else None
        if part_list is not None and sp5 is not None:
            def clone_sp(new_id, label):
                n = copy.deepcopy(sp5)
                n.set("id", new_id)
                for el in n:
                    if loc(el.tag) == "part-name":
                        el.text = label
                    if loc(el.tag) == "part-abbreviation":
                        el.text = label
                return n

            idx_sp = list(part_list).index(sp5)
            part_list.insert(idx_sp, clone_sp("P5__PR", "PR"))
            part_list.insert(idx_sp + 1, clone_sp("P5__PL", "PL"))
            part_list.remove(sp5)

    out = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")
    Path("_smoke/_cheongsan_preview_6part_clean.xml").write_text(out, encoding="utf-8")
    Path("public/cheongsan-preview.xml").write_text(out, encoding="utf-8")
    print("removed dangling", removed, "wrote public/cheongsan-preview.xml")


if __name__ == "__main__":
    main()
