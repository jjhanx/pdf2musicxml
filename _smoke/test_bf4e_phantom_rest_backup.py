#!/usr/bin/env python3
"""bf4e: missing PR↔PL backup is restored by timeline normalize (not only multivoice)."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "_smoke" / "_bf4e_phantom_rest_fix"
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    _local,
    _ns,
    _note_voice_staff,
    load_mxl_root,
    normalize_grand_staff_voices_in_measure,
    normalize_measure_timelines_in_root,
    normalize_multivoice_stems_in_measure,
    write_mxl_root,
)


def staff2_onset(path: Path, measure_number: str = "1") -> int | None:
    _files, _rp, root = load_mxl_root(path)
    ns = _ns(root)
    for part in root:
        if _local(part) != "part" or part.get("id") != "P5":
            continue
        for m in part:
            if _local(m) != "measure" or m.get("number") != measure_number:
                continue
            cursor = 0
            for el in m:
                tag = _local(el)
                if tag == "note":
                    if any(_local(c) == "chord" for c in el):
                        continue
                    _v, st = _note_voice_staff(el, ns)
                    dur_el = el.find(f"{{{ns}}}duration") if ns else el.find("duration")
                    d = int((dur_el.text or "0").strip() or 0) if dur_el is not None else 0
                    if st == "2":
                        return cursor
                    cursor += d
                elif tag == "backup":
                    dur_el = el.find(f"{{{ns}}}duration") if ns else el.find("duration")
                    d = int((dur_el.text or "0").strip() or 0) if dur_el is not None else 0
                    cursor = max(0, cursor - d)
                elif tag == "forward":
                    dur_el = el.find(f"{{{ns}}}duration") if ns else el.find("duration")
                    d = int((dur_el.text or "0").strip() or 0) if dur_el is not None else 0
                    cursor += d
    return None


def has_backup(path: Path, measure_number: str = "1") -> bool:
    _files, _rp, root = load_mxl_root(path)
    ns = _ns(root)
    for part in root:
        if _local(part) != "part" or part.get("id") != "P5":
            continue
        for m in part:
            if _local(m) != "measure" or m.get("number") != measure_number:
                continue
            return any(_local(el) == "backup" for el in m)
    return False


def staff2_voices(path: Path, measure_number: str) -> set[str]:
    _files, _rp, root = load_mxl_root(path)
    ns = _ns(root)
    out: set[str] = set()
    for part in root:
        if _local(part) != "part" or part.get("id") != "P5":
            continue
        for m in part:
            if _local(m) != "measure" or m.get("number") != measure_number:
                continue
            for el in m:
                if _local(el) != "note":
                    continue
                v, st = _note_voice_staff(el, ns)
                if st == "2":
                    out.add(v)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    zip_path = ROOT / "omr-work-bf4e4741.zip"
    if not zip_path.exists():
        raise SystemExit(f"missing {zip_path}")
    import zipfile

    with zipfile.ZipFile(zip_path) as z:
        z.extract("review.mxl", OUT)
    work = OUT / "review_fixed.mxl"
    shutil.copy(OUT / "review.mxl", work)

    assert staff2_onset(work, "1") != 0, "fixture: m1 PL delayed without backup"
    assert not has_backup(work, "1")

    files, rp, root = load_mxl_root(work)
    n = normalize_measure_timelines_in_root(root)
    write_mxl_root(work, files, rp, root)
    assert n >= 1, n
    assert has_backup(work, "1"), "backup restored"
    assert staff2_onset(work, "1") == 0, staff2_onset(work, "1")

    # staff2 voice=1 → 5 (and staff1 high voices remapped so they don't collide)
    files, rp, root = load_mxl_root(OUT / "review.mxl")
    ns = _ns(root)
    for part in root:
        if _local(part) != "part" or part.get("id") != "P5":
            continue
        for m in part:
            if _local(m) != "measure" or m.get("number") != "48":
                continue
            assert normalize_grand_staff_voices_in_measure(m, ns)
    write_mxl_root(OUT / "m48_voice.mxl", files, rp, root)
    assert staff2_voices(OUT / "m48_voice.mxl", "48") == {"5"}, staff2_voices(
        OUT / "m48_voice.mxl", "48"
    )

    # m21: PR uses v5/v6 while PL uses v1 — staff2-only remap would collide on v5
    files, rp, root = load_mxl_root(OUT / "review.mxl")
    ns = _ns(root)
    for part in root:
        if _local(part) != "part" or part.get("id") != "P5":
            continue
        for m in part:
            if _local(m) != "measure" or m.get("number") != "21":
                continue
            assert normalize_grand_staff_voices_in_measure(m, ns)
            v1, v2 = set(), set()
            for el in m:
                if _local(el) != "note":
                    continue
                v, st = _note_voice_staff(el, ns)
                if st == "1":
                    v1.add(v)
                elif st == "2":
                    v2.add(v)
            assert not (v1 & v2), (v1, v2)
            assert v1 == {"1", "2"}, v1
            assert v2 == {"5"}, v2

    # m11: monophonic PL stem flip → unify
    files, rp, root = load_mxl_root(OUT / "review.mxl")
    ns = _ns(root)
    from omr_hitl_lib import normalize_monophonic_staff_stems_in_measure

    for part in root:
        if _local(part) != "part" or part.get("id") != "P5":
            continue
        for m in part:
            if _local(m) != "measure" or m.get("number") != "11":
                continue
            assert normalize_monophonic_staff_stems_in_measure(m, ns)
            stems = set()
            for el in m:
                if _local(el) != "note":
                    continue
                v, st = _note_voice_staff(el, ns)
                if st != "2" or el.find(f"{{{ns}}}pitch") is None:
                    continue
                stems.add((el.findtext(f"{{{ns}}}stem") or "").strip())
            assert len(stems) == 1, stems

    # m14: rest+whole → lower voice stem down
    files, rp, root = load_mxl_root(OUT / "review.mxl")
    ns = _ns(root)
    for part in root:
        if _local(part) != "part" or part.get("id") != "P5":
            continue
        for m in part:
            if _local(m) != "measure" or m.get("number") != "14":
                continue
            assert normalize_multivoice_stems_in_measure(m, ns)
            stems = []
            for el in m:
                if _local(el) != "note":
                    continue
                v, st = _note_voice_staff(el, ns)
                if st != "2" or v != "6":
                    continue
                if el.find(f"{{{ns}}}pitch") is None:
                    continue
                stem = el.findtext(f"{{{ns}}}stem") or ""
                stems.append(stem.strip())
            assert stems and all(s == "down" for s in stems), stems
    print("ok phantom backup + staff voices + mono stem + stem")


if __name__ == "__main__":
    main()
