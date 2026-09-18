#!/usr/bin/env python3
"""m9: do not leave PR on T/B; do not split LH into PR+PL staffs."""
from __future__ import annotations

import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from restructure_mxl_parts import restructure_mxl  # noqa: E402


def _mxl_from_score(score: ET.Element) -> bytes:
    buf = io.BytesIO()
    xml_buf = io.BytesIO()
    ET.ElementTree(score).write(xml_buf, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>
""",
        )
        z.writestr("score.xml", xml_buf.getvalue())
    return buf.getvalue()


def _load_pristine_score() -> ET.Element:
    with zipfile.ZipFile(ROOT / "omr-work-8f913a75.zip") as z:
        data = z.read("audiveris_pristine.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as mz:
        xn = next(
            x
            for x in mz.namelist()
            if x.endswith((".xml", ".musicxml")) and "META" not in x
        )
        return ET.fromstring(mz.read(xn))


def pitched(part: ET.Element, mno: str) -> list[str]:
    out = []
    for m in part.findall("{*}measure"):
        if m.get("number") != mno:
            continue
        for n in m.findall("{*}note"):
            if n.find("{*}chord") is not None:
                continue
            st = n.findtext("{*}staff") or "1"
            if n.find("{*}rest") is not None:
                continue
            p = n.find("{*}pitch")
            out.append(f"{p.findtext('{*}step')}{p.findtext('{*}octave')}/st{st}")
    return out


def main() -> None:
    root = _load_pristine_score()
    # Sanity: pristine m9 has T/B pitched and piano all staff1
    parts = {p.get("id"): p for p in root.findall("{*}part")}
    assert pitched(parts["P3"], "9"), "pristine T should have notes"
    assert pitched(parts["P5"], "9")
    assert all("/st1" in x for x in pitched(parts["P5"], "9")), pitched(parts["P5"], "9")

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        src = td_path / "in.mxl"
        out = td_path / "out.mxl"
        labels = td_path / "labels.json"
        src.write_bytes(_mxl_from_score(root))
        labels.write_text(
            json.dumps({"version": 1, "labelsByIndex": ["S", "A", "T", "B", "P"]}),
            encoding="utf-8",
        )
        restructure_mxl(src, out, labels)
        with zipfile.ZipFile(out) as z:
            name = next(n for n in z.namelist() if n.endswith((".xml", ".musicxml")) and "META" not in n)
            fixed = ET.fromstring(z.read(name))

    fp = {p.get("id"): p for p in fixed.findall("{*}part")}
    t9 = pitched(fp["P3"], "9")
    b9 = pitched(fp["P4"], "9")
    p9 = pitched(fp["P5"], "9")
    s9 = pitched(fp["P1"], "9")
    assert not t9, f"T m9 must be emptied (PR reclaim), got {t9}"
    assert not b9, f"B m9 must be emptied (PR reclaim), got {b9}"
    assert s9, f"S m9 vocals should remain, got {s9}"
    rh = [x for x in p9 if x.endswith("/st1")]
    lh = [x for x in p9 if x.endswith("/st2")]
    assert rh, f"piano m9 should have RH on staff1 from T/B, got {p9}"
    assert lh, f"piano m9 LH should stay on staff2 after merge, got {p9}"
    assert any(x.startswith(("F3", "E3", "F2")) for x in lh), lh
    assert any(x.startswith(("A4", "F4", "C4", "C5", "G4")) for x in rh), rh
    # LH voices must not be left alone on staff1 while inventing empty PR
    assert not any(x.startswith(("F3", "E3", "F2")) and x.endswith("/st1") for x in p9), p9
    print("test_m9_no_pr_to_tb_no_lh_staff_split: OK", {"S": s9[:3], "RH": rh[:4], "LH": lh[:4]})


if __name__ == "__main__":
    main()
