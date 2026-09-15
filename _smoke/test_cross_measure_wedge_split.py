"""최종 MXL: 교차 마디 wedge를 마디 경계에서 끊어 MuseScore ContHeight 직선을 피한다."""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from omr_hitl_lib import (  # noqa: E402
    amplify_wedge_spreads_for_visibility_in_root,
    split_cross_measure_wedges_at_barlines_in_root,
)


def _score_two_measure_crescendo() -> ET.Element:
    score = ET.Element("score-partwise", version="3.1")
    part_list = ET.SubElement(score, "part-list")
    sp = ET.SubElement(part_list, "score-part", id="P1")
    ET.SubElement(sp, "part-name").text = "S"
    part = ET.SubElement(score, "part", id="P1")

    m1 = ET.SubElement(part, "measure", number="1")
    attrs = ET.SubElement(m1, "attributes")
    ET.SubElement(attrs, "divisions").text = "1"
    n1 = ET.SubElement(m1, "note")
    p = ET.SubElement(n1, "pitch")
    ET.SubElement(p, "step").text = "C"
    ET.SubElement(p, "octave").text = "4"
    ET.SubElement(n1, "duration").text = "1"
    ET.SubElement(n1, "voice").text = "1"
    ET.SubElement(n1, "type").text = "quarter"
    ET.SubElement(n1, "staff").text = "1"
    d = ET.SubElement(m1, "direction", placement="above")
    dt = ET.SubElement(d, "direction-type")
    ET.SubElement(dt, "wedge", type="crescendo", spread="0", number="1")
    ET.SubElement(d, "staff").text = "1"
    ET.SubElement(d, "voice").text = "1"
    n2 = ET.SubElement(m1, "note")
    p2 = ET.SubElement(n2, "pitch")
    ET.SubElement(p2, "step").text = "D"
    ET.SubElement(p2, "octave").text = "4"
    ET.SubElement(n2, "duration").text = "1"
    ET.SubElement(n2, "voice").text = "1"
    ET.SubElement(n2, "type").text = "quarter"
    ET.SubElement(n2, "staff").text = "1"

    m2 = ET.SubElement(part, "measure", number="2")
    n3 = ET.SubElement(m2, "note")
    p3 = ET.SubElement(n3, "pitch")
    ET.SubElement(p3, "step").text = "E"
    ET.SubElement(p3, "octave").text = "4"
    ET.SubElement(n3, "duration").text = "1"
    ET.SubElement(n3, "voice").text = "1"
    ET.SubElement(n3, "type").text = "quarter"
    ET.SubElement(n3, "staff").text = "1"
    d2 = ET.SubElement(m2, "direction", placement="above")
    dt2 = ET.SubElement(d2, "direction-type")
    ET.SubElement(dt2, "wedge", type="stop", spread="15", number="1")
    ET.SubElement(d2, "staff").text = "1"
    ET.SubElement(d2, "voice").text = "1"
    n4 = ET.SubElement(m2, "note")
    p4 = ET.SubElement(n4, "pitch")
    ET.SubElement(p4, "step").text = "F"
    ET.SubElement(p4, "octave").text = "4"
    ET.SubElement(n4, "duration").text = "1"
    ET.SubElement(n4, "voice").text = "1"
    ET.SubElement(n4, "type").text = "quarter"
    ET.SubElement(n4, "staff").text = "1"
    return score


def _wedge_types(measure: ET.Element) -> list[str]:
    out: list[str] = []
    for ch in measure:
        if ch.tag != "direction":
            continue
        w = ch.find("direction-type/wedge")
        if w is not None:
            out.append(w.get("type") or "")
    return out


def main() -> None:
    root = _score_two_measure_crescendo()
    n = split_cross_measure_wedges_at_barlines_in_root(root)
    assert n == 1, f"expected 1 split, got {n}"
    part = root.find("part")
    assert part is not None
    m1, m2 = part.findall("measure")
    assert _wedge_types(m1) == ["crescendo", "stop"], _wedge_types(m1)
    assert _wedge_types(m2) == ["crescendo", "stop"], _wedge_types(m2)
    amplify_wedge_spreads_for_visibility_in_root(root)
    stop1 = m1.find("direction/direction-type/wedge[@type='stop']")
    assert stop1 is not None
    assert int(stop1.get("spread") or "0") >= 20
    print("ok cross_measure_wedge_split")


if __name__ == "__main__":
    main()
