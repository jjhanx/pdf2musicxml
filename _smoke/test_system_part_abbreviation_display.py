#!/usr/bin/env python3
"""시스템 시작·성부 구성 변경 시 S/A/T/B/P 약어 display."""
from __future__ import annotations

import io
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from apply_part_labels import (  # noqa: E402
    apply_part_labels_to_root,
    ensure_system_part_abbreviation_displays,
    label_to_part_abbrev,
)


SAMPLE = """<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>S</part-name><part-abbreviation>S</part-abbreviation></score-part>
    <score-part id="P2"><part-name>A</part-name><part-abbreviation>A</part-abbreviation></score-part>
    <score-part id="P3"><part-name>T</part-name><part-abbreviation>T</part-abbreviation></score-part>
    <score-part id="P4"><part-name>B</part-name><part-abbreviation>B</part-abbreviation></score-part>
    <score-part id="P5"><part-name>Piano</part-name><part-abbreviation>Pno.</part-abbreviation></score-part>
  </part-list>
  <part id="P1">
    <measure number="1"><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
    <measure number="2"><note><rest/><duration>4</duration><voice>1</voice></note></measure>
    <measure number="3"><print new-system="yes"/><note><rest/><duration>4</duration><voice>1</voice></note></measure>
  </part>
  <part id="P2">
    <measure number="1"><note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
    <measure number="2"><note><rest/><duration>4</duration><voice>1</voice></note></measure>
    <measure number="3"><note><rest/><duration>4</duration><voice>1</voice></note></measure>
  </part>
  <part id="P3">
    <measure number="1"><note><rest/><duration>4</duration><voice>1</voice></note></measure>
    <measure number="2"><note><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
    <measure number="3"><note><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
  </part>
  <part id="P4">
    <measure number="1"><note><rest/><duration>4</duration><voice>1</voice></note></measure>
    <measure number="2"><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
    <measure number="3"><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice></note></measure>
  </part>
  <part id="P5">
    <measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note></measure>
    <measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note></measure>
    <measure number="3"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note></measure>
  </part>
</score-partwise>
"""


def _abbrev_at(root: ET.Element, pid: str, mn: str) -> str | None:
    for part in root:
        if part.tag.rsplit("}", 1)[-1] != "part" or part.get("id") != pid:
            continue
        for m in part:
            if m.tag.rsplit("}", 1)[-1] != "measure" or m.get("number") != mn:
                continue
            for el in m:
                if el.tag.rsplit("}", 1)[-1] != "print":
                    continue
                for pad in el:
                    if pad.tag.rsplit("}", 1)[-1] != "part-abbreviation-display":
                        continue
                    for dt in pad:
                        if dt.tag.rsplit("}", 1)[-1] == "display-text":
                            return (dt.text or "").strip()
    return None


def main() -> None:
    assert label_to_part_abbrev("PR", "Piano") == "P"
    root = ET.parse(io.BytesIO(SAMPLE.encode())).getroot()
    n = ensure_system_part_abbreviation_displays(root)
    assert n > 0, n
    assert _abbrev_at(root, "P1", "1") == "S"
    assert _abbrev_at(root, "P3", "1") == "T"
    assert _abbrev_at(root, "P5", "1") == "Pno." or _abbrev_at(root, "P5", "1") == "P"
    # m2: active set S+A → T+B change
    assert _abbrev_at(root, "P3", "2") == "T"
    assert _abbrev_at(root, "P1", "2") == "S"
    # m3 new-system
    assert _abbrev_at(root, "P1", "3") == "S"

    root2 = ET.parse(io.BytesIO(SAMPLE.encode())).getroot()
    apply_part_labels_to_root(root2, ["S", "A", "T", "B", "PR"])
    assert _abbrev_at(root2, "P5", "1") == "P"
    print("ok part abbrev displays", n)


if __name__ == "__main__":
    main()
