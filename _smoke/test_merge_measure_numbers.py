#!/usr/bin/env python3
"""마디 번호(14, 17 등)가 가사로 병합되지 않는지 회귀."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from merge_lyric_sources import (  # noqa: E402
    is_measure_number_item,
    load_pymupdf_review,
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
    pymupdf_items, manual = load_pymupdf_review(str(BACKUP))
    manifest = merge_sources(extracted, pymupdf_items, manual, min_size=7.0, max_size=17.0)
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


def test_flat_uses_pymupdf_review_not_plumber_merge():
    """flat inject는 pdfplumber IoU 병합이 아니라 PyMuPDF 검토 성부·순서를 그대로 쓴다."""
    if not BACKUP.is_file() or not EXTRACTED.is_file():
        print("SKIP: sample files missing")
        return True
    from collections import Counter

    extracted = json.loads(EXTRACTED.read_text(encoding="utf-8"))
    pymupdf_items, manual = load_pymupdf_review(str(BACKUP))
    manifest = merge_sources(extracted, pymupdf_items, manual, min_size=7.0, max_size=17.0)
    flat = manifest_to_flat_inject_rows(manifest)
    backup_lyrics = [x for x in pymupdf_items if x.get("type") == "lyrics"]
    flat_lyrics = [x for x in flat if x.get("type") == "lyrics"]
    by_part_backup = Counter(int(x.get("lyricPartIndex", 1) or 1) for x in backup_lyrics)
    by_part_flat = Counter(int(x.get("lyricPartIndex", 1) or 1) for x in flat_lyrics)
    if by_part_flat != by_part_backup:
        print("FAIL: part distribution", dict(by_part_flat), "expected", dict(by_part_backup))
        return False
    # page 3 tenor(part 3): 첫 줄 텍스트가 검토 JSON과 동일해야 함
    def first_p3(items):
        rows = [
            x
            for x in items
            if x.get("type") == "lyrics" and int(x.get("lyricPartIndex", 1) or 1) == 3 and x.get("page") == 3
        ]
        rows.sort(key=lambda it: (it.get("y", 0), it.get("x", 0)))
        return rows[0].get("text") if rows else None

    if first_p3(flat_lyrics) != first_p3(backup_lyrics):
        print("FAIL: page3 part3 first line mismatch")
        print(" flat:", first_p3(flat_lyrics))
        print(" backup:", first_p3(backup_lyrics))
        return False
    print("PASS: flat inject matches pymupdf review part distribution and page3 tenor text")
    return True


def main():
    test_classify_unknown_digits()
    test_classify_real_lyrics()
    ok = test_merge_backup_no_digit_lyrics()
    ok = test_flat_uses_pymupdf_review_not_plumber_merge() and ok
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
