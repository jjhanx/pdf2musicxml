#!/usr/bin/env python3
"""Audit: preview voice flatten is general — scan all omr-work ZIPs."""
from __future__ import annotations

import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def local(el) -> str:
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def note_staff(note: ET.Element) -> int:
    st = note.find("{*}staff")
    return int(st.text) if st is not None and st.text else 1


def note_voice(note: ET.Element) -> str:
    v = note.find("{*}voice")
    return v.text if v is not None and v.text else "1"


def note_dur(note: ET.Element) -> int:
    d = note.find("{*}duration")
    return int(d.text) if d is not None and d.text else 0


def is_chord(note: ET.Element) -> bool:
    return note.find("{*}chord") is not None


def dur_el(el: ET.Element) -> int:
    d = el.find("{*}duration")
    return int(d.text) if d is not None and d.text else 0


def staff_timed_notes(measure: ET.Element) -> list[tuple[ET.Element, int, str, int]]:
    t = 0
    out = []
    for child in measure:
        tag = local(child)
        if tag == "backup":
            t = max(0, t - dur_el(child))
        elif tag == "forward":
            t += dur_el(child)
        elif tag == "note":
            dur = note_dur(child)
            end = t if is_chord(child) else t + dur
            out.append((child, t, note_voice(child), end))
            if not is_chord(child):
                t = end
    return out


def voices_overlap(timed) -> bool:
    by_v: dict[str, list[tuple[int, int]]] = {}
    for _, tm, vn, end in timed:
        by_v.setdefault(vn, []).append((tm, end))
    voices = list(by_v)
    for i, a in enumerate(voices):
        for b in voices[i + 1 :]:
            for a0, a1 in by_v[a]:
                for b0, b1 in by_v[b]:
                    if max(a0, b0) < min(a1, b1):
                        return True
    return False


def prune_cross_staff_timeline(measure: ET.Element, staff_n: int) -> None:
    children = list(measure)
    for child in list(measure):
        tag = local(child)
        if tag not in ("backup", "forward"):
            continue
        idx = children.index(child)
        prev_staff = None
        for j in range(idx - 1, -1, -1):
            if local(children[j]) == "note":
                prev_staff = note_staff(children[j])
                break
        next_staff = None
        for j in range(idx + 1, len(children)):
            if local(children[j]) == "note":
                next_staff = note_staff(children[j])
                break
        if next_staff != staff_n:
            measure.remove(child)
            continue
        if tag in ("backup", "forward") and (prev_staff is None or prev_staff != staff_n):
            measure.remove(child)


def flatten_if_ok(measure: ET.Element) -> str:
    timed = staff_timed_notes(measure)
    if len(timed) < 2:
        return "skip_few_notes"
    if len({x[2] for x in timed}) < 2:
        return "skip_single_voice"
    if voices_overlap(timed):
        return "skip_overlap"
    # rebuild
    times_before = [(t, note_dur(n), note_voice(n)) for n, t, _, _ in timed]
    for child in list(measure):
        if local(child) in ("note", "backup", "forward"):
            measure.remove(child)
    cursor = 0
    ns = measure.tag.split("}")[0].strip("{") if "}" in measure.tag else ""
    q = lambda name: f"{{{ns}}}{name}" if ns else name
    idx = 0
    for note, tm, _, _ in timed:
        if tm > cursor:
            fwd = ET.Element(q("forward"))
            ET.SubElement(fwd, q("duration")).text = str(tm - cursor)
            measure.insert(idx, fwd)
            idx += 1
            cursor = tm
        clone = deepcopy(note)
        v = clone.find("{*}voice")
        if v is not None:
            v.text = "1"
        measure.insert(idx, clone)
        idx += 1
        if not is_chord(clone):
            cursor = tm + note_dur(clone)
    timed_after = staff_timed_notes(measure)
    times_after = [(t, note_dur(n), note_voice(n)) for n, t, _, _ in timed_after]
    if times_before != [(a, b, _) for a, b, _ in times_before]:  # always true
        pass
    if [(a, b) for a, b, _ in times_before] != [(a, b) for a, b, _ in times_after]:
        return "ERROR_time_changed"
    if any(local(c) == "backup" for c in measure):
        return "flattened_has_backup"
    return "flattened"


def max_staves(part: ET.Element) -> int:
    mx = 1
    for m in part.findall("{*}measure"):
        for st in m.findall(".//{*}staves"):
            if st.text and st.text.isdigit():
                mx = max(mx, int(st.text))
        for st in m.findall(".//{*}note/{*}staff"):
            if st.text and st.text.isdigit():
                mx = max(mx, int(st.text))
    return mx


def load_raw_mxl(zpath: Path) -> bytes:
    with zipfile.ZipFile(zpath) as z:
        return z.read("audiveris_raw.mxl")


def xml_from_mxl(data: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and "META" not in n.upper())
        return z.read(name)


def audit_zip(zpath: Path) -> dict:
    root = ET.fromstring(xml_from_mxl(load_raw_mxl(zpath)))
    stats = {
        "zip": zpath.name,
        "piano_parts": 0,
        "measures_staff1": 0,
        "measures_staff2": 0,
        "flattened": 0,
        "skip_single_voice": 0,
        "skip_overlap": 0,
        "skip_few_notes": 0,
        "errors": 0,
        "bf_patterns": 0,  # backup followed by forward with voice on forward
    }
    for part in root.findall(".//{*}part"):
        if max_staves(part) < 2:
            continue
        stats["piano_parts"] += 1
        for m in part.findall("{*}measure"):
            for staff_n, key in ((1, "measures_staff1"), (2, "measures_staff2")):
                stats[key] += 1
                mm = deepcopy(m)
                for c in list(mm):
                    if local(c) == "note" and note_staff(c) != staff_n:
                        mm.remove(c)
                prune_cross_staff_timeline(mm, staff_n)
                # detect backup+forward pattern (OSMD-risky)
                ch = list(mm)
                for i, c in enumerate(ch):
                    if local(c) != "backup" or i + 1 >= len(ch):
                        continue
                    if local(ch[i + 1]) == "forward":
                        stats["bf_patterns"] += 1
                result = flatten_if_ok(mm)
                stats[result] = stats.get(result, 0) + 1
                if result.startswith("ERROR"):
                    stats["errors"] += 1
    return stats


def main() -> int:
    zips = sorted({p for p in ROOT.glob("omr-work-*.zip")} | {p for p in ROOT.glob("_smoke/omr-work-*.zip")})
    if not zips:
        print("No omr-work zips found")
        return 1
    totals = {
        "flattened": 0,
        "skip_single_voice": 0,
        "skip_overlap": 0,
        "skip_few_notes": 0,
        "errors": 0,
        "bf_patterns": 0,
        "piano_parts": 0,
    }
    print(f"Scanning {len(zips)} omr-work ZIP(s)\n")
    for zp in zips:
        s = audit_zip(zp)
        for k in totals:
            totals[k] += s.get(k, 0)
        print(
            f"{s['zip']}: piano={s['piano_parts']} bf_pairs={s['bf_patterns']} "
            f"flat={s.get('flattened',0)} skip_v1={s.get('skip_single_voice',0)} "
            f"skip_ov={s.get('skip_overlap',0)} err={s.get('errors',0)}"
        )
    print("\n=== TOTAL ===")
    print(f"piano parts: {totals['piano_parts']}")
    print(f"backup+forward pairs (staff-filtered): {totals['bf_patterns']}")
    print(f"flattened measures: {totals['flattened']}")
    print(f"skipped (single voice): {totals['skip_single_voice']}")
    print(f"skipped (overlapping voices - preserved): {totals['skip_overlap']}")
    print(f"time preservation errors: {totals['errors']}")
    return 1 if totals["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
