#!/usr/bin/env python3
"""제목 후보 감지·scoreTitle manifest 반영 스모크."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from merge_lyric_sources import apply_score_title_to_manifest, manifest_to_flat_inject_rows

MANIFEST = ROOT / "청산에 살리라 F장조(이현철 곡)-lyric_manifest.json"


def test_manifest_score_title() -> None:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    data["fontStrip"] = {
        "ranges": [{"minPt": 7, "maxPt": 17}],
        "scoreTitle": {
            "text": "청산에 살리라",
            "page": 1,
            "bbox": [231.83, 77.65, 363.16, 98.51],
        },
    }
    apply_score_title_to_manifest(data)
    p1 = data["pymupdfReviewItems"][0]
    assert p1["type"] == "title", p1
    assert p1["text"] == "청산에 살리라"
    flat = manifest_to_flat_inject_rows(data)
    titles = [x for x in flat if x.get("type") == "title"]
    assert titles and titles[0]["text"] == "청산에 살리라", flat[:3]
    print("manifest scoreTitle OK")


def test_user_title_overrides_score_title() -> None:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    data["fontStrip"] = {
        "scoreTitle": {"text": "청산에 살리라", "page": 1, "bbox": [231.83, 77.65, 363.16, 98.51]},
    }
    data["pymupdfReviewItems"][0]["type"] = "title"
    data["pymupdfReviewItems"][0]["text"] = "사용자 제목"
    data["pymupdfReviewItems"][0]["reviewTypeUserSet"] = True
    flat = manifest_to_flat_inject_rows(data)
    titles = [x for x in flat if x.get("type") == "title"]
    assert titles[0]["text"] == "사용자 제목", titles
    print("user title priority OK")


def test_detect_from_manifest_bbox() -> None:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    item = data["items"][0]
    assert "청산" in item["text"]
    assert item["bbox"][1] < 120
    print("title bbox sanity OK", item["text"], item["bbox"])


if __name__ == "__main__":
    test_detect_from_manifest_bbox()
    test_manifest_score_title()
    test_user_title_overrides_score_title()
