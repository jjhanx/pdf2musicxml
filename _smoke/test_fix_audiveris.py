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


def slurs_m6_chord_placement(mxl: Path):
    """인쇄 7·31마디 — E4 below, G4 above (음머리 높이, 깃대 아님)."""
    root = load_root(mxl)
    ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""
    for part in root.findall(q(ns, "part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(q(ns, "measure")):
            if m.get("number") != "6":
                continue
            e4_slurs = []
            g4_slurs = []
            for note in m.findall(q(ns, "note")):
                pitch = note.find(q(ns, "pitch"))
                if pitch is None:
                    continue
                lab = pitch.find(q(ns, "step")).text + pitch.find(q(ns, "octave")).text
                for n in note.findall(q(ns, "notations")):
                    for s in n.findall(q(ns, "slur")):
                        if s.get("type") != "start":
                            continue
                        entry = (s.get("number"), s.get("placement"))
                        if lab == "E4":
                            e4_slurs.append(entry)
                        elif lab == "G4":
                            g4_slurs.append(entry)
            ok = (
                any(p == "below" for _, p in e4_slurs)
                and any(p == "above" for _, p in g4_slurs)
                and not any(p == "above" for _, p in e4_slurs)
                and not any(p == "below" for _, p in g4_slurs)
            )
            return ok, {"E4": e4_slurs, "G4": g4_slurs}
    return False, "missing"


def slurs_m59_no_injected_chord_slur(mxl: Path):
    """인쇄 60마디(XML m59) PR — B4+G4 연속 화음 사이에 후처리 slur 없음."""
    root = load_root(mxl)
    ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""
    for part in root.findall(q(ns, "part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(q(ns, "measure")):
            if m.get("number") != "59":
                continue
            injected = []
            for note in m.findall(q(ns, "note")):
                st = note.find(q(ns, "staff"))
                if st is not None and st.text != "1":
                    continue
                pitch = note.find(q(ns, "pitch"))
                if pitch is None:
                    continue
                lab = pitch.find(q(ns, "step")).text + pitch.find(q(ns, "octave")).text
                for n in note.findall(q(ns, "notations")):
                    for s in n.findall(q(ns, "slur")):
                        num = s.get("number") or "1"
                        try:
                            if int(num) >= 20:
                                injected.append((lab, num, s.get("type")))
                        except ValueError:
                            pass
            ok = len(injected) == 0
            return ok, {"injected_slurs": injected}
    return False, "missing"


def pl_m42_triplet_pitches(mxl: Path):
    """PDF 43마디 PL — 세잇단 1~3 화음 pitch 유지."""
    root = load_root(mxl)
    ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""
    for part in root.findall(q(ns, "part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(q(ns, "measure")):
            if m.get("number") != "42":
                continue
            groups = []
            chord = []
            for n in m.findall(q(ns, "note")):
                st = (n.find(q(ns, "staff")).text if n.find(q(ns, "staff")) is not None else "1")
                if st != "2":
                    continue
                ch = n.find(q(ns, "chord")) is not None
                if not ch:
                    if chord:
                        groups.append(chord)
                    chord = [n]
                else:
                    chord.append(n)
            if chord:
                groups.append(chord)
            if len(groups) < 6:
                return False, "short"

            def sig(g):
                ps = []
                for x in g:
                    p = x.find(q(ns, "pitch"))
                    if p is not None:
                        ps.append(p.find(q(ns, "step")).text + p.find(q(ns, "octave")).text)
                return tuple(sorted(ps))

            ok = (
                sig(groups[0]) == ("C2", "C3")
                and sig(groups[1]) == ("C4", "E3", "G3")
                and sig(groups[1]) == sig(groups[2])
                and groups[3][0].find(q(ns, "time-modification")) is not None
                and (groups[3][0].find(q(ns, "stem")).text if groups[3][0].find(q(ns, "stem")) is not None else None)
                == "down"
            )
            return ok, {
                "g1": sig(groups[0]),
                "g2": sig(groups[1]),
                "g3": sig(groups[2]),
                "g4_stem": groups[3][0].find(q(ns, "stem")).text if groups[3][0].find(q(ns, "stem")) is not None else None,
            }
    return False, "missing"


def pr_m44_staff1_rhythm(mxl: Path):
    """인쇄 45 PR(XML m44 staff1) — ♪♪–♩♩–♩, 마지막 B4/B5 4분 유지."""
    root = load_root(mxl)
    ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""
    for part in root.findall(q(ns, "part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(q(ns, "measure")):
            if m.get("number") != "44":
                continue
            groups = []
            chord = []
            for n in m.findall(q(ns, "note")):
                st = n.find(q(ns, "staff")).text if n.find(q(ns, "staff")) is not None else "1"
                if st != "1":
                    continue
                ch = n.find(q(ns, "chord")) is not None
                if not ch:
                    if chord:
                        groups.append(chord)
                    chord = [n]
                else:
                    chord.append(n)
            if chord:
                groups.append(chord)
            if len(groups) != 5:
                return False, {"groups": len(groups)}

            def sig(g):
                ps = []
                for n in g:
                    p = n.find(q(ns, "pitch"))
                    if p is not None:
                        ps.append(p.find(q(ns, "step")).text + p.find(q(ns, "octave")).text)
                return tuple(sorted(ps))

            def typ(g):
                t = g[0].find(q(ns, "type"))
                return t.text if t is not None else None

            ok = (
                typ(groups[0]) == "eighth"
                and typ(groups[1]) == "eighth"
                and typ(groups[2]) == "quarter"
                and typ(groups[3]) == "quarter"
                and typ(groups[4]) == "quarter"
                and sig(groups[4]) == ("B4", "B5")
            )
            return ok, {
                "g1": (typ(groups[0]), sig(groups[0])),
                "g5": (typ(groups[4]), sig(groups[4])),
            }
    return False, "missing"


def pl_m44_twelve_triplet_slices(mxl: Path):
    """인쇄 45 PL(XML m44 staff2) — 4×세잇단 12slice 복구(B1,B2,D3G3B3 + …)."""
    root = load_root(mxl)
    ns = root.tag[1 : root.tag.index("}")] if root.tag.startswith("{") else ""
    for part in root.findall(q(ns, "part")):
        if part.get("id") != "P5":
            continue
        for m in part.findall(q(ns, "measure")):
            if m.get("number") != "44":
                continue
            groups = []
            chord = []
            for n in m.findall(q(ns, "note")):
                st = n.find(q(ns, "staff")).text if n.find(q(ns, "staff")) is not None else "1"
                if st != "2":
                    continue
                ch = n.find(q(ns, "chord")) is not None
                if not ch:
                    if chord:
                        groups.append(chord)
                    chord = [n]
                else:
                    chord.append(n)
            if chord:
                groups.append(chord)
            if len(groups) != 12:
                return False, {"groups": len(groups)}

            def sig(g):
                ps = []
                for n in g:
                    p = n.find(q(ns, "pitch"))
                    if p is not None:
                        ps.append(p.find(q(ns, "step")).text + p.find(q(ns, "octave")).text)
                return tuple(sorted(ps))

            def typ(g):
                t = g[0].find(q(ns, "type"))
                return t.text if t is not None else None

            def stem(g):
                s = g[0].find(q(ns, "stem"))
                return s.text if s is not None else None

            ok = (
                sig(groups[0]) == ("B1",)
                and sig(groups[1]) == ("B2",)
                and sig(groups[2]) == ("B3", "D3", "G3")
                and typ(groups[0]) == "eighth"
                and typ(groups[1]) == "eighth"
                and groups[0][0].find(q(ns, "time-modification")) is not None
                and stem(groups[0]) == "up"
                and stem(groups[1]) == "up"
                and stem(groups[2]) == "down"
                and groups[-1][0].find(q(ns, "time-modification")) is not None
            )
            return ok, {"g1": sig(groups[0]), "g2": sig(groups[1]), "g3": sig(groups[2])}
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
    ok_tup = len(starts14) >= 4 and all(s == "actual" for s in starts14)
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

    ok_a26 = True
    a26 = ROOT / "omr-work-a26ecec0-full" / "audiveris_raw.mxl"
    if not a26.is_file():
        a26 = ROOT / "omr-work-6855d546-full" / "audiveris_raw.mxl"
    if a26.is_file():
        from fix_audiveris_mxl import fix_mxl_file  # noqa: E402

        a26_out = a26.parent / "_test_regression.mxl"
        fix_mxl_file(a26, a26_out)
        ok_slur_plc, detail = slurs_m6_chord_placement(a26_out)
        print(f"{'PASS' if ok_slur_plc else 'FAIL'} a26 m6 chord slur placement: {detail}")
        ok_m44, detail44 = pl_m44_twelve_triplet_slices(a26_out)
        print(f"{'PASS' if ok_m44 else 'FAIL'} a26 m44 PL 12 triplet slices: {detail44}")
        ok_pr44, detail_pr = pr_m44_staff1_rhythm(a26_out)
        print(f"{'PASS' if ok_pr44 else 'FAIL'} a26 m44 PR rhythm: {detail_pr}")
        ok_m42, detail42 = pl_m42_triplet_pitches(a26_out)
        print(f"{'PASS' if ok_m42 else 'FAIL'} a26 m42 PL triplet pitches: {detail42}")
        ok_m59, detail59 = slurs_m59_no_injected_chord_slur(a26_out)
        print(f"{'PASS' if ok_m59 else 'FAIL'} a26 m59 no false B4+G4 slur: {detail59}")
        ok_a26 = ok_slur_plc and ok_m44 and ok_pr44 and ok_m42 and ok_m59

    return 0 if ok_slur and ok_tup and ok_stats and ok_m28 and ok_a26 else 1


if __name__ == "__main__":
    raise SystemExit(main())
