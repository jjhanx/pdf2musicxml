#!/usr/bin/env python3
"""Regression: print m59 P3 staff2 — editor order matches default-x (5940 zip)."""
import io
import sys
import zipfile
from pathlib import Path

import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import (  # noqa: E402
    _ns,
    find_measure,
    find_part,
    measure_elements_snapshot,
    rebuild_measure_timeline_clean,
)

EXPECTED_TYPES = ("half", "half", "quarter", "quarter", "half", "half", "quarter", "quarter")


def load_m59_p3():
    for zpath in (
        Path("고향의 봄/omr-work-5940c932.zip"),
        Path("omr-work-5940c932.zip"),
    ):
        if zpath.exists():
            break
    else:
        raise FileNotFoundError("omr-work-5940c932.zip not found")
    with zipfile.ZipFile(zpath) as z:
        data = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(data)) as mz:
        xml_name = [n for n in mz.namelist() if n.endswith(".xml")][0]
        root = ET.fromstring(mz.read(xml_name))
    ns = _ns(root)
    part = find_part(root, ns, "P3")
    measure = find_measure(part, ns, "59")
    return measure, ns


def staff2_leaders(snapshots):
    out = []
    for n in snapshots:
        if n.get("staff") != 2:
            continue
        out.append(n)
    return out


def assert_order(snapshots, label: str):
    notes = staff2_leaders(snapshots)
    types = tuple(n.get("type") for n in notes)
    assert types == EXPECTED_TYPES, f"{label}: types {types!r} != {EXPECTED_TYPES!r}"
    leaders = [n for n in notes if not n.get("chord")]
    xs = [n.get("timelineX") or n.get("defaultX") for n in leaders]
    assert all(xs[i] <= xs[i + 1] for i in range(len(xs) - 1)), f"{label}: leader x not sorted {xs!r}"


def main():
    measure, ns = load_m59_p3()
    before = measure_elements_snapshot(measure, ns)
    assert_order(before, "snapshot sort (before rebuild)")

    rebuild_measure_timeline_clean(measure, ns)
    after = measure_elements_snapshot(measure, ns)
    assert_order(after, "after rebuild")

    voices = {n.get("voice") for n in staff2_leaders(after)}
    assert len(voices) == 1, f"expected single voice after rebuild, got {voices}"

    # XML document order should match timeline after normalize
    doc_types = []
    for child in measure:
        if child.tag.split("}")[-1] != "note":
            continue
        staff_el = child.find("{*}staff")
        if staff_el is None or staff_el.text != "2":
            continue
        typ = child.find("{*}type")
        doc_types.append(typ.text if typ is not None else "?")
    assert tuple(doc_types) == EXPECTED_TYPES, f"XML doc order {doc_types!r}"

    print("OK: m59 P3 staff2 timeline order (5940)")


if __name__ == "__main__":
    main()
