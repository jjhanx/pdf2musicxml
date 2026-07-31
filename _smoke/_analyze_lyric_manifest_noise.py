#!/usr/bin/env python3
"""Summarize noise in cheongsan lyric_manifest."""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path


def load() -> dict:
    for p in [
        Path("청산에 살리라 F장조(이현철 곡)-lyric_manifest.json"),
        Path("청산에 살리라 F/청산에 살리라 F장조(이현철 곡)-lyric_manifest.json"),
    ]:
        if p.exists():
            print("file:", p)
            return json.loads(p.read_text(encoding="utf-8"))
    raise SystemExit("manifest not found")


def main() -> None:
    import sys

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    data = load()
    print("matchStats:", data.get("matchStats"))
    ranges = data.get("fontStrip", {}).get("ranges")
    print("fontStrip ranges:", json.dumps(ranges, ensure_ascii=False)[:200] if ranges else None)
    items = data.get("items") or []
    types = Counter(str(i.get("type") or "?") for i in items)
    print("items by type:", dict(types))
    print("total items:", len(items))

    # classify text-ish noise
    buckets: Counter[str] = Counter()
    samples: dict[str, list[str]] = {}

    def add(bucket: str, text: str) -> None:
        buckets[bucket] += 1
        samples.setdefault(bucket, [])
        if len(samples[bucket]) < 8:
            samples[bucket].append(text[:60])

    hangul = re.compile(r"[가-힣]")
    latin = re.compile(r"[A-Za-z]")
    for it in items:
        t = str(it.get("type") or "?")
        text = str(it.get("text") or "").strip()
        if not text:
            add("empty", "")
            continue
        if t in ("lyrics", "title", "composer", "copyright", "tempo", "measure_number", "page_number"):
            add(f"typed:{t}", f"[{t}] {text}")
            continue
        # unknown / other
        if hangul.search(text) and not latin.search(text) and len(text) <= 20:
            add("hangul_short_maybe_lyric", text)
        elif hangul.search(text):
            add("hangul_other", text)
        elif re.fullmatch(r"\d+", text):
            add("digits_alone", text)
        elif re.fullmatch(r"[=]?\d+", text) or "♩" in text or "=" in text:
            add("tempoish", text)
        elif re.fullmatch(r"[A-Za-z .]+", text) and len(text) <= 40:
            add("latin_words_expr", text)
        elif any(ord(c) > 0xE000 for c in text) or any("\uf000" <= c <= "\uf8ff" for c in text):
            add("pua_smufl_glyph", repr(text))
        elif re.search(r"[♪♫♯♭♮]|\\u", text) or len(text) == 1:
            add("symbolish", repr(text))
        else:
            add(f"other_type={t}", repr(text)[:50])

    print("\n--- buckets ---")
    for k, n in buckets.most_common():
        print(f"{n:4d}  {k}")
        for s in samples.get(k, []):
            print(f"       · {s}")

    # unknown only deep dive
    unk = [i for i in items if str(i.get("type")) in ("unknown", "?", "")]
    print(f"\nunknown count: {len(unk)}")
    unk_text = Counter(str(i.get("text") or "").strip() for i in unk)
    print("top unknown texts:")
    for text, n in unk_text.most_common(40):
        print(f"  {n:3d}  {text!r}")

    # font size distribution for unknown
    pts = Counter()
    for i in unk:
        fs = i.get("fontSize") or i.get("size") or i.get("pt")
        if fs is not None:
            try:
                pts[round(float(fs), 1)] += 1
            except (TypeError, ValueError):
                pass
    if pts:
        print("\nunknown fontSize top:", pts.most_common(15))

    # provenance
    prov = Counter(str(i.get("provenance") or i.get("source") or "?") for i in items)
    print("provenance:", dict(prov))


if __name__ == "__main__":
    main()
