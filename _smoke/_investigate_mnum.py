#!/usr/bin/env python3
"""Investigate measure-numbering and numeric words in sample MXL files."""
from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def analyze_mxl(path: Path) -> dict:
    with zipfile.ZipFile(path) as z:
        xml_name = next(n for n in z.namelist() if n.endswith('.xml') and 'META' not in n.upper())
        xml = z.read(xml_name).decode('utf-8', errors='replace')
    mn = len(re.findall(r'<measure-numbering>', xml))
    words_dirs: list[tuple[str, str]] = []
    for m in re.finditer(r'<measure number="(\d+)"[^>]*>(.*?)</measure>', xml, re.S):
        num = m.group(1)
        body = m.group(2)
        for w in re.finditer(r'<words[^>]*>([^<]+)</words>', body):
            t = w.group(1).strip()
            if re.match(r'^\d{1,3}$', t):
                words_dirs.append((num, t))
    measure_count = len(re.findall(r'<measure number=', xml))
    return {
        'path': str(path),
        'measure_count': measure_count,
        'measure_numbering': mn,
        'numeric_words': len(words_dirs),
        'sample_words': words_dirs[:12],
    }


def main() -> None:
    samples = [
        ROOT / 'debug_omr' / 'audiveris_raw.mxl',
        ROOT / 'debug_omr' / 'review.mxl',
        ROOT / '_smoke' / '_6cbf_final' / 'audiveris_raw.mxl',
        ROOT / '_smoke' / '_6cbf_final' / 'review.mxl',
        ROOT / '_smoke' / 'x' / 'clean_score_only.xml',
    ]
    for s in samples:
        if s.exists():
            print(json.dumps(analyze_mxl(s) if s.suffix == '.mxl' else analyze_xml(s), ensure_ascii=False))


def analyze_xml(path: Path) -> dict:
    xml = path.read_text(encoding='utf-8', errors='replace')
    mn = len(re.findall(r'<measure-numbering>', xml))
    words_dirs: list[tuple[str, str]] = []
    for m in re.finditer(r'<measure number="(\d+)"[^>]*>(.*?)</measure>', xml, re.S):
        num = m.group(1)
        body = m.group(2)
        for w in re.finditer(r'<words[^>]*>([^<]+)</words>', body):
            t = w.group(1).strip()
            if re.match(r'^\d{1,3}$', t):
                words_dirs.append((num, t))
    return {
        'path': str(path),
        'measure_numbering': mn,
        'numeric_words': len(words_dirs),
        'sample_words': words_dirs[:12],
    }


if __name__ == '__main__':
    main()
