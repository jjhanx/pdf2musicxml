"""
m28 PR: OMR 8분+forward 16분 이중 voice → rebuild 후 단일 16분 voice, spurious chord 없음.
Run: python _smoke/test_m28_pr_voice_rebuild.py
"""
from __future__ import annotations

import copy
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import (  # noqa: E402
    _ns,
    _note_voice_staff,
    apply_fix,
    list_note_elements,
    rebuild_measure_timeline_clean,
)

ZIP = Path(r"D:/pdf2musicxml/omr-work-3c30ccde.zip")


def load_m28_raw():
    with zipfile.ZipFile(ZIP) as z:
        data = z.read("audiveris_raw.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as mz:
        xml = next(n for n in mz.namelist() if n.endswith(".xml") and "META" not in n.upper())
        root = ET.fromstring(mz.read(xml))
    ns = _ns(root)
    part = next(p for p in root.findall(f"{ns}part") if p.get("id") == "P5")
    measure = next(m for m in part.findall(f"{ns}measure") if m.get("number") == "28")
    return copy.deepcopy(part), copy.deepcopy(measure), ns


def pr_staff1_notes(measure: ET.Element, ns: str):
    out = []
    for n in list_note_elements(measure, ns):
        v, st = _note_voice_staff(n, ns)
        if st != "1":
            continue
        typ = n.findtext(f"{ns}type") or "?"
        dur = int(n.findtext(f"{ns}duration") or "0")
        ch = n.find(f"{ns}chord") is not None
        step = n.findtext(f".//{ns}step") or "?"
        oct_ = n.findtext(f".//{ns}octave") or ""
        out.append((v, f"{step}{oct_}", typ, dur, ch))
    return out


def main() -> None:
    part, measure, ns = load_m28_raw()
    rebuild_measure_timeline_clean(measure, ns, part)
    notes = pr_staff1_notes(measure, ns)
    voices = {v for v, *_ in notes}
    if voices != {"1"}:
        raise SystemExit(f"expected single voice on PR, got {voices}: {notes}")
    if any(ch for *_, ch in notes):
        raise SystemExit(f"spurious chord tags: {notes}")
    if not all(typ == "16th" for _, _, typ, dur, _ in notes[:-1]):
        raise SystemExit(f"expected 16ths except last: {notes}")
    if notes[-1][2] not in ("eighth", "16th"):
        raise SystemExit(f"unexpected last note type: {notes[-1]}")

    # setPlayOrder on several leaders + rebuild must not introduce chords
    root = ET.Element("score-partwise")
    root.append(part)
    m = measure
    leaders = [n for n in list_note_elements(m, ns) if _note_voice_staff(n, ns)[1] == "1"]
    for i, po in enumerate([1, 2, 3, 4, 5], start=0):
        if i >= len(leaders):
            break
        apply_fix(
            root,
            ns,
            {
                "kind": "setPlayOrder",
                "partId": "P5",
                "measureMxl": "28",
                "noteIndex": list_note_elements(m, ns).index(leaders[i]),
                "playOrder": po,
                "staff": 1,
            },
        )
    rebuild_measure_timeline_clean(m, ns, part)
    notes2 = pr_staff1_notes(m, ns)
    if any(ch for *_, ch in notes2):
        raise SystemExit(f"chords after play order reorder: {notes2}")
    if {v for v, *_ in notes2} != {"1"}:
        raise SystemExit(f"voices after play order: {notes2}")

    print("m28_pr_voice_rebuild ok", len(notes2), "notes")


if __name__ == "__main__":
    main()
