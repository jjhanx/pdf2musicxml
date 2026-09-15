#!/usr/bin/env python3
"""최종 MXL에 제목·작곡가 work/identification + page credit 반영."""
from __future__ import annotations

import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from inject_ocr import inject_ocr  # noqa: E402
from merge_lyric_sources import manifest_to_flat_inject_rows  # noqa: E402

OUT = ROOT / "_smoke" / "_score_meta_credits"
OUT.mkdir(parents=True, exist_ok=True)

SHELL = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>S</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>
"""


def write_mxl(path: Path, xml: str) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0"?><container><rootfiles>
            <rootfile full-path="score.xml"/></rootfiles></container>""",
        )
        z.writestr("score.xml", xml.encode("utf-8"))


def read_score(path: Path) -> ET.Element:
    with zipfile.ZipFile(path) as z:
        return ET.fromstring(z.read("score.xml"))


def test_merge_meta_from_items() -> None:
    """pymupdfReviewItems에 가사만 있고 items에 작곡가가 있으면 flat에 합쳐짐."""
    manifest = {
        "v": 3,
        "sources": {"pymupdfReview": True},
        "scoreTitle": {"text": "테스트곡", "page": 1},
        "fontStrip": {"scoreTitle": {"text": "테스트곡", "page": 1}},
        "pymupdfReviewItems": [
            {"id": "1", "type": "lyrics", "text": "라라", "page": 1, "bbox": [0, 0, 1, 1]},
        ],
        "items": [
            {"id": "1", "type": "lyrics", "text": "라라", "page": 1, "bbox": [0, 0, 1, 1]},
            {"id": "c1", "type": "composer", "text": "이현철", "page": 1, "bbox": [0, 0, 1, 1]},
            {"id": "t1", "type": "title", "text": "옛제목", "page": 1, "bbox": [0, 0, 1, 1]},
        ],
    }
    flat = manifest_to_flat_inject_rows(manifest)
    types = {r.get("type"): r.get("text") for r in flat if r.get("type") in ("title", "composer")}
    assert types.get("composer") == "이현철", types
    assert types.get("title") == "테스트곡", types  # scoreTitle 우선
    print("merge meta from items OK")


def test_inject_writes_work_and_credits() -> None:
    mxl_in = OUT / "in.mxl"
    mxl_out = OUT / "out.mxl"
    write_mxl(mxl_in, SHELL)
    manifest = {
        "v": 3,
        "items": [
            {"type": "title", "text": "청산에 살리라", "page": 1},
            {"type": "composer", "text": "이현철", "page": 1},
            {"type": "lyricist", "text": "작사A", "page": 1},
        ],
    }
    man_path = OUT / "lyric_manifest.json"
    man_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    inject_ocr(str(mxl_in), str(mxl_out), str(man_path))
    root = read_score(mxl_out)
    wt = root.find("work/work-title")
    assert wt is not None and wt.text == "청산에 살리라", wt
    creators = {c.get("type"): c.text for c in root.findall("identification/creator")}
    assert creators.get("composer") == "이현철", creators
    assert creators.get("lyricist") == "작사A", creators
    credit_types = []
    for cr in root.findall("credit"):
        ct = cr.find("credit-type")
        cw = cr.find("credit-words")
        credit_types.append((ct.text if ct is not None else None, cw.text if cw is not None else None))
    assert any(t == "title" and "청산" in (w or "") for t, w in credit_types), credit_types
    assert any(t == "composer" and "이현철" in (w or "") for t, w in credit_types), credit_types
    print("inject work+credits OK", credit_types)


if __name__ == "__main__":
    test_merge_meta_from_items()
    test_inject_writes_work_and_credits()
    print("ok score meta credits")
