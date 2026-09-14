#!/usr/bin/env python3
"""Build minimal m50 PL MusicXML after addSlur C3→A3 for OSMD probing."""
from __future__ import annotations

import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from omr_hitl_lib import _ns, _q, apply_fix, list_note_elements

OUT = Path("_smoke/_014f_m50_slur")
OUT.mkdir(parents=True, exist_ok=True)


def main() -> None:
    with zipfile.ZipFile("omr-work-014f2b6c.zip") as z:
        raw = z.read("review.mxl")
    with zipfile.ZipFile(io.BytesIO(raw)) as mz:
        name = next(n for n in mz.namelist() if n.endswith(".xml") and "META" not in n.upper())
        root = ET.fromstring(mz.read(name))
    ns = _ns(root)
    apply_fix(
        root,
        ns,
        {
            "kind": "addSlur",
            "partId": "P5",
            "measureMxl": "50",
            "fromNoteIndex": 17,
            "toNoteIndex": 19,
            "placement": "above",
        },
    )
    part = next(p for p in root.findall(_q(ns, "part")) if p.get("id") == "P5")
    m = next(x for x in part.findall(_q(ns, "measure")) if x.get("number") == "50")

    body: list[str] = []
    seen = False
    for c in list(m):
        tag = c.tag.split("}")[-1]
        if tag == "note":
            if (c.findtext(_q(ns, "staff")) or "1") != "2":
                continue
            n2 = ET.fromstring(ET.tostring(c))
            # drop namespace for simpler OSMD load
            def strip_ns(el: ET.Element) -> None:
                if "}" in el.tag:
                    el.tag = el.tag.split("}", 1)[1]
                for ch in el:
                    strip_ns(ch)

            strip_ns(n2)
            st = n2.find("staff")
            if st is not None:
                n2.remove(st)
            stem = n2.find("stem")
            if stem is not None:
                stem.attrib.pop("default-y", None)
                stem.attrib.pop("default-x", None)
            body.append(ET.tostring(n2, encoding="unicode"))
            seen = True
        elif tag in ("backup", "forward") and seen:
            el = ET.fromstring(ET.tostring(c))
            if "}" in el.tag:
                el.tag = el.tag.split("}", 1)[1]
            for ch in el:
                if "}" in ch.tag:
                    ch.tag = ch.tag.split("}", 1)[1]
            body.append(ET.tostring(el, encoding="unicode"))

    score = f"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>PL</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      {"".join(body)}
    </measure>
  </part>
</score-partwise>
"""
    (OUT / "minimal.xml").write_text(score, encoding="utf-8")
    print("slurs", score.count("<slur"))
    for line in score.split("slur"):
        if "type=" in line[:80]:
            print("...", line[:120])


if __name__ == "__main__":
    main()
