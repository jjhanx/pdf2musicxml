#!/usr/bin/env python3
"""P2 1절 가사·음표 정렬 진단 (인쇄 10마디 근처)."""
import io
import json
import re
import shutil
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from inject_ocr import (  # noqa: E402
    build_events_for_items,
    collect_lyric_streams,
    list_attachable_notes,
    load_ocr_items,
    mxl_ns_uri,
    parse_lyric_text_events,
    qname,
)

MXL_ZIP = ROOT / "omr-work-f7b18c9d.zip"
MANIFEST = ROOT / "남촌 D프렛-lyric_manifest.json"
REVIEW = ROOT / "review_backup_남촌 D프렛.pdf.json"
USE_REVIEW_BACKUP = True


def load_score_xml(mxl_path: Path) -> ET.Element:
    with zipfile.ZipFile(mxl_path) as z:
        container = z.read("META-INF/container.xml").decode("utf-8")
        rootfile = re.search(r'full-path="([^"]+)"', container).group(1)
        data = z.read(rootfile)
    return ET.parse(io.BytesIO(data)).getroot()


def part_by_index(root: ET.Element, part_index: int):
    ns = mxl_ns_uri(root)
    parts = root.findall(qname(ns, "part"))
    if part_index < 1 or part_index > len(parts):
        return None, ns
    return parts[part_index - 1], ns


def note_measure_map(part_el, ns):
    rows = []
    for measure in part_el.findall(qname(ns, "measure")):
        mnum = measure.get("number", "?")
        for note in measure.findall(qname(ns, "note")):
            if note.find(qname(ns, "rest")) is not None:
                continue
            if note.find(qname(ns, "grace")) is not None:
                continue
            v = note.find(qname(ns, "voice"))
            voice = v.text if v is not None and v.text else "1"
            rows.append((mnum, note, voice))
    return rows


def lyric_text_on_note(note, ns, verse: int = 1):
    out = []
    for lyric in note.findall(qname(ns, "lyric")):
        num = lyric.get("number")
        if verse == 1 and (num is None or num == "1"):
            t = lyric.find(qname(ns, "text"))
            out.append(t.text if t is not None and t.text else "")
        elif verse > 1 and num == str(verse):
            t = lyric.find(qname(ns, "text"))
            out.append(t.text if t is not None and t.text else "")
    return "".join(out)


def main():
    tmp = Path(tempfile.mkdtemp())
    work_mxl = tmp / "work.mxl"
    shutil.copy(MXL_ZIP, tmp / "src.zip")
    with zipfile.ZipFile(tmp / "src.zip") as z:
        z.extract("review.mxl", tmp)
    shutil.copy(tmp / "review.mxl", work_mxl)

    if USE_REVIEW_BACKUP and REVIEW.is_file():
        data = json.loads(REVIEW.read_text(encoding="utf-8"))
        items = data["items"] if isinstance(data, dict) else data
        inject_src = tmp / "review_items.json"
        inject_src.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    else:
        inject_src = MANIFEST if MANIFEST.is_file() else REVIEW
    ocr_items = load_ocr_items(str(inject_src))
    streams = collect_lyric_streams(ocr_items)

    root = load_score_xml(work_mxl)

    for pi in (1, 2):
        part_el, ns = part_by_index(root, pi)
        notes = list_attachable_notes(part_el, ns)
        print(f"\n=== P{pi}: attachable notes={len(notes)} ===")
        # cumulative index at each measure boundary
        by_measure = {}
        idx = 0
        for measure in part_el.findall(qname(ns, "measure")):
            mnum = measure.get("number", "?")
            start = idx
            for note in measure.findall(qname(ns, "note")):
                if note.find(qname(ns, "rest")) is not None:
                    continue
                if note.find(qname(ns, "grace")) is not None:
                    continue
                v = note.find(qname(ns, "voice"))
                voice = v.text if v is not None and v.text else "1"
                chord = note.find(qname(ns, "chord")) is not None
                if chord:
                    if idx > 0 and notes[idx - 1][2] == voice:
                        continue
                idx += 1
            by_measure[mnum] = (start, idx)
        for m in ("8", "9", "10", "11", "12"):
            if m in by_measure:
                s, e = by_measure[m]
                print(f"  m{m}: attachable idx {s}..{e-1} ({e-s} notes)")

    # P2 stream events
    p2_streams = streams.get(2, [])
    print(f"\n=== P2 lyric streams: {len(p2_streams)} ===")
    for st in p2_streams:
        verse = st["verse"]
        items = st["items"]
        part_el, ns = part_by_index(root, 2)
        events = build_events_for_items(items, part_el, ns)
        syllables = sum(1 for e in events if e["op"] in ("syllable", "empty_note"))
        skips = sum(e["count"] for e in events if e["op"] == "skip_notes")
        print(f" verse {verse}: blocks={len(items)} events={len(events)} syllables={syllables} skip={skips}")
        for bi, it in enumerate(items):
            ev = build_events_for_items([it], part_el, ns)
            sc = sum(1 for e in ev if e["op"] in ("syllable", "empty_note"))
            sk = sum(e["count"] for e in ev if e["op"] == "skip_notes")
            text = (it.get("text") or "").replace("\n", " ")
            print(f"   block {bi}: page={it.get('page')} skip={it.get('lyricSkipNotes')} voice={it.get('lyricVoice')} syl={sc} sk={sk} text={text[:70]!r}")

    # run inject
    import subprocess

    out_mxl = tmp / "out.mxl"
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "inject_ocr.py"), str(work_mxl), str(out_mxl), str(inject_src)],
        check=True,
        capture_output=True,
        text=True,
    )
    root2 = load_score_xml(out_mxl)
    part_el, ns = part_by_index(root2, 2)
    print("\n=== P2 verse1 lyrics by measure (after inject) ===")
    idx = 0
    for measure in part_el.findall(qname(ns, "measure")):
        mnum = measure.get("number", "?")
        texts = []
        for note in measure.findall(qname(ns, "note")):
            if note.find(qname(ns, "rest")) is not None:
                continue
            if note.find(qname(ns, "grace")) is not None:
                continue
            chord = note.find(qname(ns, "chord")) is not None
            v = note.find(qname(ns, "voice"))
            voice = v.text if v is not None and v.text else "1"
            if chord:
                pass
            lt = lyric_text_on_note(note, ns, 1)
            if lt:
                texts.append(f"#{idx}:{lt!r}")
            idx += 1 if not chord or True else 0
        if mnum in ("8", "9", "10", "11", "12") or texts:
            if mnum in ("1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12") or texts:
                if mnum in tuple(str(i) for i in range(1, 16)):
                    line = " ".join(texts) if texts else "(no lyrics)"
                    print(f" m{mnum}: {line}")


if __name__ == "__main__":
    main()
