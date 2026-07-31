#!/usr/bin/env python3
"""c83a zip 인쇄 59 PL — 혼합 세잇단 bracket·orphan quarter beam 회귀."""
import io
import sys
import zipfile
from pathlib import Path

import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import (  # noqa: E402
    _ns,
    _q,
    find_measure,
    find_part,
    list_note_elements,
    rebuild_measure_timeline_clean,
    _repair_tuplet_brackets_in_measure,
    _rhythmic_indices_in_range,
    _tuplet_notation_runs,
)


def load_m59():
    zpath = Path("omr-work-c83a3f2c.zip")
    with zipfile.ZipFile(zpath) as z:
        data = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as mz:
        xml_name = [n for n in mz.namelist() if n.endswith(".xml")][0]
        root = ET.fromstring(mz.read(xml_name))
    ns = _ns(root)
    part = find_part(root, ns, "P3")
    measure = find_measure(part, ns, "59")
    return measure, ns


def staff2_tuplet_starts(measure, ns):
    notes = list_note_elements(measure, ns)
    out = []
    for start, stop in _tuplet_notation_runs(notes, ns):
        st = _note_staff(notes[start], ns)
        if st != "2":
            continue
        notations = notes[start].find(_q(ns, "notations"))
        tup = notations.find(_q(ns, "tuplet")) if notations is not None else None
        out.append(
            {
                "start": start,
                "stop": stop,
                "show_bracket": (tup.get("show-bracket") if tup is not None else None),
                "bracket": (tup.get("bracket") if tup is not None else None),
            }
        )
    return out


def _note_staff(note, ns):
    staff_el = note.find(_q(ns, "staff"))
    return staff_el.text if staff_el is not None else "?"


def quarter_beams_on_staff2(measure, ns):
    notes = list_note_elements(measure, ns)
    bad = []
    for n in notes:
        if _note_staff(n, ns) != "2":
            continue
        typ = n.find(_q(ns, "type"))
        if typ is None or (typ.text or "") != "quarter":
            continue
        if n.findall(_q(ns, "beam")):
            bad.append(n)
    return bad


def main():
    measure, ns = load_m59()
    _repair_tuplet_brackets_in_measure(measure, ns)
    rebuild_measure_timeline_clean(measure, ns)

    triplets = staff2_tuplet_starts(measure, ns)
    assert len(triplets) == 2, f"expected 2 PL triplets, got {triplets!r}"
    for t in triplets:
        assert t["show_bracket"] == "yes", t
        assert t["bracket"] == "yes", t

    assert not quarter_beams_on_staff2(measure, ns), "quarter notes must not keep orphan beams"

    notes = list_note_elements(measure, ns)
    for start, stop in _tuplet_notation_runs(notes, ns):
        if _note_staff(notes[start], ns) != "2":
            continue
        indices = _rhythmic_indices_in_range(notes, ns, start, stop)
        types = [notes[i].find(_q(ns, "type")).text for i in indices]
        assert types == ["half", "quarter"], f"unexpected triplet types {types}"

    print("OK: c83a m59 PL mixed triplet brackets")


if __name__ == "__main__":
    main()
