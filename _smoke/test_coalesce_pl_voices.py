# -*- coding: utf-8 -*-
"""PL m3: voice5+6+7 → coalesce to voice5+6 with leading rest for second half."""
from __future__ import annotations

import copy
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import (  # noqa: E402
    _ns,
    _note_voice_staff,
    coalesce_spurious_parallel_voices_in_measure,
    list_note_elements,
    rebuild_measure_timeline_clean,
)

FIX = Path(__file__).resolve().parent / "_pl_m3_voices_fixture.xml"


def _local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def dump_staff2(measure: ET.Element, ns: str, label: str) -> None:
    print("==", label)
    for el in list(measure):
        loc = _local(el.tag)
        if loc == "backup":
            d = el.findtext(f"{{{ns}}}duration") if ns else el.findtext("duration")
            if d is None:
                d = el.findtext("duration")
            print(f"  BACKUP {d}")
            continue
        if loc != "note":
            continue
        v, st = _note_voice_staff(el, ns)
        if st != "2":
            continue
        rest = el.find(f"{{{ns}}}rest") is not None if ns else el.find("rest") is not None
        if not rest:
            rest = el.find("rest") is not None
        typ = el.findtext(f"{{{ns}}}type") if ns else None
        if typ is None:
            typ = el.findtext("type")
        pitch = ""
        if not rest:
            step = el.findtext("pitch/step") or el.findtext(f"{{{ns}}}pitch/{{{ns}}}step")
            octv = el.findtext("pitch/octave") or el.findtext(f"{{{ns}}}pitch/{{{ns}}}octave")
            pitch = f"{step}{octv}"
        po = el.get("data-hitl-play-order")
        print(f"  v={v} {typ} {'REST' if rest else pitch} po={po}")


def main() -> None:
    if not FIX.exists():
        raise SystemExit(f"missing fixture {FIX}")
    root = ET.parse(FIX).getroot()
    ns = _ns(root)
    part = root.find(f"{{{ns}}}part") if ns else root.find("part")
    if part is None:
        part = next(p for p in root.iter() if _local(p.tag) == "part")
    measure = None
    for m in part:
        if _local(m.tag) == "measure" and m.get("number") == "3":
            measure = m
            break
    assert measure is not None
    dump_staff2(measure, ns, "before")
    before = copy.deepcopy(measure)
    ok = coalesce_spurious_parallel_voices_in_measure(measure, ns, part)
    assert ok, "coalesce should change measure"
    dump_staff2(measure, ns, "after coalesce")
    voices = {
        _note_voice_staff(n, ns)[0]
        for n in list_note_elements(measure, ns)
        if _note_voice_staff(n, ns)[1] == "2"
    }
    assert voices == {"5", "6"}, voices
    staff2 = [
        n
        for n in list_note_elements(measure, ns)
        if _note_voice_staff(n, ns)[1] == "2" and n.find("chord") is None and (
            (n.find("rest") is not None) or (ns and n.find(f"{{{ns}}}rest") is not None)
        )
    ]
    # also count rests with namespace
    rests = []
    for n in list_note_elements(measure, ns):
        if _note_voice_staff(n, ns)[1] != "2":
            continue
        if n.find("rest") is not None or (ns and n.find(f"{{{ns}}}rest") is not None):
            rests.append(n)
    assert len(rests) == 2, f"expected 2 rests (original + inserted), got {len(rests)}"

    # rebuild path should be idempotent-ish
    measure2 = before
    rebuild_measure_timeline_clean(measure2, ns, part)
    voices2 = {
        _note_voice_staff(n, ns)[0]
        for n in list_note_elements(measure2, ns)
        if _note_voice_staff(n, ns)[1] == "2"
    }
    assert voices2 == {"5", "6"}, voices2
    print("OK")


if __name__ == "__main__":
    main()
