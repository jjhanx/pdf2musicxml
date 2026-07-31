"""P5 PL m26 duration sum after split-style staff filter."""
import xml.etree.ElementTree as ET
from pathlib import Path

def local(tag):
    return tag.split("}")[-1] if "}" in tag else tag

def note_staff(note):
    st = note.find("{*}staff")
    return int(st.text) if st is not None and st.text and st.text.strip().isdigit() else 1

def voice_dur(measure, staff_n=None):
    div = 4
    beats, beat_type = 4, 4
    for child in measure:
        if local(child.tag) != "attributes":
            continue
        d = child.find("{*}divisions")
        if d is not None and d.text:
            div = int(d.text)
        t = child.find("{*}time")
        if t is not None:
            b = t.find("{*}beats")
            bt = t.find("{*}beat-type")
            if b is not None and b.text:
                beats = int(b.text)
            if bt is not None and bt.text:
                beat_type = int(bt.text)
    expected = div * beats * 4 // beat_type
    voices = {}
    cur = {1: 0}
    for child in measure:
        tag = local(child.tag)
        if tag == "backup":
            dur = int(child.find("{*}duration").text or 0)
            # simplified: track max voice timeline
            continue
        if tag != "note":
            continue
        if staff_n is not None and note_staff(child) != staff_n:
            continue
        v_el = child.find("{*}voice")
        v = int(v_el.text) if v_el is not None and v_el.text else 1
        dur = int(child.find("{*}duration").text or 0)
        if child.find("{*}chord") is not None:
            continue
        voices[v] = voices.get(v, 0) + dur
    return div, expected, voices

root = ET.parse("_smoke/_cheongsan_review.xml").getroot()
p5 = next(p for p in root if local(p.tag) == "part" and p.get("id") == "P5")
for mnum in (25, 26, 27):
    meas = next(m for m in p5 if local(m.tag) == "measure" and m.get("number") == str(mnum))
    print(f"\n=== P5 m{mnum} staff1 (PR) ===")
    print(voice_dur(meas, 1))
    print(f"=== P5 m{mnum} staff2 (PL) ===")
    print(voice_dur(meas, 2))
    notes_pl = [c for c in meas if local(c.tag) == "note" and note_staff(c) == 2]
    print("PL notes", len(notes_pl))
    for i, n in enumerate(notes_pl[:8]):
        p = n.find("{*}pitch")
        r = n.find("{*}rest")
        typ = n.find("{*}type")
        print(
            i + 1,
            "rest" if r is not None else (p.find("{*}step").text + p.find("{*}octave").text if p is not None else "?"),
            "dur",
            n.find("{*}duration").text,
            "type",
            typ.text if typ is not None else None,
            "voice",
            n.find("{*}voice").text if n.find("{*}voice") is not None else "1",
        )
