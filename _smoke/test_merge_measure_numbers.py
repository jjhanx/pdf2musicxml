#!/usr/bin/env python3
"""마디 번호(14, 17 등)가 가사로 병합되지 않는지 회귀."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from merge_lyric_sources import (  # noqa: E402
    is_measure_number_item,
    merge_sources,
    manifest_to_flat_inject_rows,
    resolve_inject_type,
)

BACKUP = ROOT / "review_backup_눈\u00a0김효근\u00a04부\u00a010쪽.pdf.json"
EXTRACTED = ROOT / "extracted_music_text.json"


def test_classify_unknown_digits():
    item = {
        "type": "unknown",
        "text": "14",
        "bbox": [42.0, 60.0, 51.0, 70.0],
        "lyricPartIndex": 1,
    }
    assert is_measure_number_item(item)
    assert resolve_inject_type(item) == "measure_number"


def test_classify_real_lyrics():
    item = {
        "type": "lyrics",
        "text": "작 은 마 - 음 - 이",
        "bbox": [76.0, 231.0, 561.0, 244.0],
    }
    assert not is_measure_number_item(item)
    assert resolve_inject_type(item) == "lyrics"


def test_merge_backup_no_digit_lyrics():
    if not BACKUP.is_file() or not EXTRACTED.is_file():
        print("SKIP: sample files missing")
        return True
    extracted = json.loads(EXTRACTED.read_text(encoding="utf-8"))
    backup = json.loads(BACKUP.read_text(encoding="utf-8"))
    manifest = merge_sources(extracted, backup, [], min_size=7.0, max_size=17.0)
    flat = manifest_to_flat_inject_rows(manifest)
    bad = [
        r
        for r in flat
        if r.get("type") == "lyrics" and str(r.get("text", "")).strip().isdigit()
    ]
    if bad:
        print("FAIL: digit lyrics still present:", [(r.get("page"), r.get("text")) for r in bad[:5]])
        return False
    mn = [r for r in manifest["items"] if r.get("type") == "measure_number"]
    print(f"PASS: measure_number={len(mn)}, flat rows={len(flat)}, digit_lyrics=0")
    return True


def main():
    test_classify_unknown_digits()
    test_classify_real_lyrics()
    ok = test_merge_backup_no_digit_lyrics()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
