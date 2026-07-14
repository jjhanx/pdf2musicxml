#!/usr/bin/env python3
"""가사 읽기 순서 — 페이지 넘김 픽업이 다음 페이지 상단 가사보다 뒤에 오는지 검증."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from merge_lyric_sources import lyric_reading_sort_key, sort_lyric_items_reading_order


def _lyrics_only(items: list[dict]) -> list[dict]:
    return [
        it
        for it in items
        if isinstance(it, dict)
        and it.get("type") == "lyrics"
        and int(it.get("lyricPartIndex", 1) or 1) == 1
        and int(it.get("lyricVerseIndex", 1) or 1) == 1
    ]


def test_namchon_pickup_after_page2_head() -> None:
    backup = ROOT / "review_backup_남촌 D프렛.pdf.json"
    if not backup.exists():
        print("skip: no review backup")
        return
    items = json.loads(backup.read_text(encoding="utf-8"))["items"]
    lyrics = _lyrics_only(items)
    sort_lyric_items_reading_order(lyrics)
    texts = [str(it.get("text") or "").strip() for it in lyrics]
    assert texts[0].startswith("넘"), f"first block should be page-2 head, got {texts[0]!r}"
    pickup_idx = next(i for i, t in enumerate(texts) if t == "산")
    head_idx = 0
    assert pickup_idx > head_idx, f"pickup 산 at {pickup_idx} should follow head at {head_idx}"
    print("ok: namchon P1 v1 page-2 head before page-1 pickup")


def test_wave_ordering() -> None:
    pickup = {
        "page": 1,
        "text": "산",
        "bbox": [526.0, 496.0, 538.0, 508.0],
        "type": "lyrics",
    }
    head = {
        "page": 2,
        "text": "넘 어",
        "bbox": [97.0, 94.0, 543.0, 106.0],
        "type": "lyrics",
    }
    assert lyric_reading_sort_key(head) < lyric_reading_sort_key(pickup)
    print("ok: synthetic wave keys")


if __name__ == "__main__":
    test_wave_ordering()
    test_namchon_pickup_after_page2_head()
    print("all passed")
