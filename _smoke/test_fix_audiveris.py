#!/usr/bin/env python3
"""fix_audiveris_mxl 회귀 — m6 이음줄, 세잇단 show-number."""
import json
import shutil
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from fix_audiveris_mxl import fix_mxl_path_inplace  # noqa: E402

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "dbgzip" / "masked_input.mvt1_merged.mxl"
WORK = ROOT / "dbgzip" / "test_fix_audiveris.mxl"


def load_root(mxl: Path):
    with zipfile.ZipFile(mxl) as z:
        names = [n for n in z.namelist() if n.endswith(".xml") and not n.startswith("META-INF")]
        return ET.fromstring(z.read(names[0]))


def q(ns, t):
    return f"{{{ns}}}{t}" if ns else t


def rest_beamed_triplet_m28(mxl: Path):
    """PDF 29마디 — 𝄽8 세잇단 + 빔 8분 2개."""
    root = load_root(mxl)
    ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""
    for part in root.findall(q(ns, "part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(q(ns, "measure")):
            if m.get("number") != "28":
                continue
            notes = [
                n
                for n in m.findall(q(ns, "note"))
                if (n.find(q(ns, "staff")) is None or (n.find(q(ns, "staff")).text or "1") == "2")
                and n.find(q(ns, "chord")) is None
            ]
            tail = notes[-3:]
            if len(tail) < 3:
                return False, "short"
            rest, n1, n2 = tail
            if rest.find(q(ns, "rest")) is None:
                return False, "no rest"
            for n in (rest, n1, n2):
                if n.find(q(ns, "time-modification")) is None:
                    return False, "no tm"
            beams = []
            for n in (rest, n1, n2):
                b = n.findall(q(ns, "beam"))
                beams.append(b[0].text if b else None)
            stems = []
            for n in (rest, n1, n2):
                s = n.find(q(ns, "stem"))
                stems.append(s.text if s is not None else None)
            ok = beams[1:] == ["begin", "end"] and beams[0] is None
            return ok, {"beams": beams, "stems": stems}
    return False, "missing"


def slurs_m6(mxl: Path):
    root = load_root(mxl)
    ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""
    for part in root.findall(q(ns, "part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(q(ns, "measure")):
            if m.get("number") != "6":
                continue
            out = []
            for i, note in enumerate(m.findall(q(ns, "note"))):
                for n in note.findall(q(ns, "notations")):
                    for s in n.findall(q(ns, "slur")):
                        out.append((i, s.get("number"), s.get("type")))
            return out
    return []


def tuplet_starts(mxl: Path, measure_no: str):
    root = load_root(mxl)
    ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""
    starts = []
    for part in root.findall(q(ns, "part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(q(ns, "measure")):
            if m.get("number") != measure_no:
                continue
            for note in m.findall(q(ns, "note")):
                for n in note.findall(q(ns, "notations")):
                    for t in n.findall(q(ns, "tuplet")):
                        if t.get("type") == "start":
                            starts.append(t.get("show-number"))
    return starts


def main() -> int:
    if not SRC.is_file():
        print(f"SKIP: {SRC} missing")
        return 0
    shutil.copy(SRC, WORK)
    stats = fix_mxl_path_inplace(WORK)
    print(json.dumps(stats, ensure_ascii=False))

    slurs = slurs_m6(WORK)
    ok_slur = ("4", "1", "start") in [(str(i), n, t) for i, n, t in slurs] and (
        "6",
        "1",
        "stop",
    ) in [(str(i), n, t) for i, n, t in slurs] and ("8", "2", "start") in [
        (str(i), n, t) for i, n, t in slurs
    ] and ("9", "2", "stop") in [(str(i), n, t) for i, n, t in slurs]
    print(f"{'PASS' if ok_slur else 'FAIL'} m6 slurs: {slurs}")

    starts14 = tuplet_starts(WORK, "14")
    ok_tup = len(starts14) >= 4 and all(s == "both" for s in starts14)
    print(f"{'PASS' if ok_tup else 'FAIL'} m14 tuplet show-number: {starts14[:6]}")

    ok_stats = stats.get("slurs_injected", 0) >= 2 and stats.get("tuplet_show_number_fixed", 0) > 0
    print(f"{'PASS' if ok_stats else 'FAIL'} stats slurs={stats.get('slurs_injected')} tupletShow={stats.get('tuplet_show_number_fixed')}")

    ok_m28 = True
    sample = ROOT / "omr-work-b3a37755-full" / "audiveris_raw.mxl"
    if not sample.is_file():
        sample = ROOT / "omr-work-2ffe8bd0-full" / "audiveris_raw.mxl"
    if sample.is_file():
        from fix_audiveris_mxl import fix_mxl_file  # noqa: E402

        out_path = ROOT / "omr-work-2ffe8bd0-full" / "_test_m28.mxl"
        st = fix_mxl_file(sample, out_path)
        ok_m28, detail = rest_beamed_triplet_m28(out_path)
        print(f"{'PASS' if ok_m28 else 'FAIL'} m28 rest triplet beam: {detail} (rest_eighth={st.get('rest_eighth_triplet_fixed')})")

    return 0 if ok_slur and ok_tup and ok_stats and ok_m28 else 1


if __name__ == "__main__":
    raise SystemExit(main())
