# -*- coding: utf-8 -*-
"""Unit checks for play-order layout with rest+note same column."""
from pathlib import Path

# TS-side covered lightly via node; this checks Python coalesce idempotency.
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import (  # noqa: E402
    _ns,
    _note_voice_staff,
    coalesce_spurious_parallel_voices_in_measure,
    list_note_elements,
)

FIX = Path(__file__).resolve().parent / "_pl_m3_voices_fixture.xml"


def main() -> None:
    root = ET.parse(FIX).getroot()
    ns = _ns(root)
    part = next(
        p
        for p in root.iter()
        if (p.tag.endswith("}part") or p.tag == "part") and p.get("id")
    )
    measure = next(
        m
        for m in part
        if (m.tag.endswith("measure") or m.tag == "measure") and m.get("number") == "3"
    )
    assert coalesce_spurious_parallel_voices_in_measure(measure, ns, part)
    assert not coalesce_spurious_parallel_voices_in_measure(measure, ns, part)
    voices = {
        _note_voice_staff(n, ns)[0]
        for n in list_note_elements(measure, ns)
        if _note_voice_staff(n, ns)[1] == "2"
    }
    assert voices == {"5", "6"}
    print("idempotent OK")


if __name__ == "__main__":
    main()
